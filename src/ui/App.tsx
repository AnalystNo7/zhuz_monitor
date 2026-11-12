import { useMemo, useRef, useState } from 'preact/hooks';
import { byManager, summarize, trend, type GroupSummary, type TrendPoint } from '../core/aggregate.ts';
import { DEFAULT_CONFIG, INDICATOR_IDS } from '../core/config.ts';
import { round2, zoneOf } from '../core/score.ts';
import { formatDate, norm } from '../core/text.ts';
import { history, listPeriods, stateAt, statesAt } from '../core/timeline.ts';
import type { DocumentState, Evaluation, Expertise, Granularity, IndicatorId, MissingPart, Zone } from '../core/types.ts';
import { canPickFolder, folderFromFileList, pickFolder, type SourceFolder } from '../io/folder.ts';
import { loadFolder } from './load.ts';

const cfg = DEFAULT_CONFIG;

const ZONE_LABEL: Record<Zone, string> = { green: 'Зелёная зона', yellow: 'Жёлтая зона', red: 'Красная зона' };
const EXPERTISE_LABEL: Record<Expertise, string> = { internal: 'внутренняя экспертиза', external: 'внешняя экспертиза' };
const MISSING_LABEL: Record<MissingPart, string> = {
  registry: 'нет в перечне документов',
  journal: 'нет ЖУЗ',
  cycles: 'циклы не указаны',
  date: 'дата начала не определена',
};
const LEVEL_LABEL = { error: 'Ошибка', warning: 'Внимание', info: 'К сведению' } as const;
/** Значение фильтра для документов, у которых статус не указан. */
const NO_STATUS = '—';

type ExpertiseFilter = '' | Expertise;

function fmt(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

function percent(part: number, total: number): string {
  return total === 0 ? '—' : `${Math.round((part / total) * 100)}%`;
}

function statusKey(state: DocumentState): string {
  return norm(state.status) || NO_STATUS;
}

/** Изменение показателя: стрелка и величина; рост — к лучшему. */
function Delta({ value }: { value: number | null }) {
  if (value === null) return <span class="muted">—</span>;
  if (value === 0) return <span class="muted">без изменений</span>;
  return <span class={value > 0 ? 'up' : 'down'}>{value > 0 ? '▲' : '▼'} {fmt(Math.abs(value))}</span>;
}

export function App() {
  const [folder, setFolder] = useState<SourceFolder | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<Granularity>('quarter');
  const [periodKey, setPeriodKey] = useState('');
  const [expertise, setExpertise] = useState<ExpertiseFilter>('');
  const [status, setStatus] = useState('');
  const input = useRef<HTMLInputElement>(null);

  async function load(source: SourceFolder) {
    setLoading(true);
    setError(null);
    try {
      setEvaluation(await loadFolder(source, cfg));
      setFolder(source);
      setPeriodKey('');
      setStatus('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function open() {
    if (!canPickFolder()) {
      input.current?.click();
      return;
    }
    try {
      await load(await pickFolder());
    } catch (e) {
      // Отмена выбора папки — не ошибка.
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(e instanceof Error ? e.message : String(e));
    }
  }

  const documents = evaluation?.documents ?? [];
  const periods = useMemo(() => listPeriods(documents, granularity), [documents, granularity]);
  const selected = periods.find((p) => p.key === periodKey) ?? null;
  // Без выбранного периода — текущее состояние по всем данным.
  const asOf = selected?.end ?? null;
  // Изменение считается к концу предыдущего периода; для текущего состояния — к концу предпоследнего.
  const previousEnd = (selected ? periods[periods.indexOf(selected) - 1] : periods[periods.length - 2])?.end ?? null;

  const current = useMemo(() => statesAt(documents, null, cfg), [documents]);
  const statuses = useMemo(() => {
    const labels = new Map<string, string>();
    for (const state of current) if (!labels.has(statusKey(state))) labels.set(statusKey(state), state.status.trim() || 'Статус не указан');
    return [...labels].sort((a, b) => a[1].localeCompare(b[1], 'ru'));
  }, [current]);

  const matches = (state: DocumentState) => (!expertise || state.expertise === expertise) && (!status || statusKey(state) === status);
  const states = useMemo(() => statesAt(documents, asOf, cfg).filter(matches), [documents, asOf, expertise, status]);
  const points = useMemo(() => trend(documents, granularity, cfg, matches), [documents, granularity, expertise, status]);
  const hasExpertise = current.some((s) => s.expertise);

  return (
    <div class="page">
      <header class="top">
        <div>
          <h1>Мониторинг качества проектной документации</h1>
          <p class="muted">
            {folder ? `Папка: ${folder.name} · книг Excel: ${folder.files.length}` : 'Расчёт интегрального индекса качества документа (ИИКД) по журналам учёта замечаний'}
          </p>
        </div>
        <div class="actions">
          {folder?.reload && (
            <button type="button" disabled={loading} onClick={() => folder.reload!().then(load)}>
              Обновить
            </button>
          )}
          <button type="button" class="primary" disabled={loading} onClick={open}>
            {loading ? 'Чтение…' : 'Открыть папку'}
          </button>
          <input
            ref={(el) => {
              input.current = el;
              el?.setAttribute('webkitdirectory', '');
            }}
            id="folder-input"
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const element = e.currentTarget;
              if (!element.files || element.files.length === 0) return;
              // Поле очищается только после чтения: иначе браузер отзывает доступ к файлам.
              void load(folderFromFileList(element.files)).finally(() => {
                element.value = '';
              });
            }}
          />
        </div>
      </header>

      {error && <p class="alert">{error}</p>}

      {!evaluation && !loading && (
        <section class="empty">
          <h2>Выберите папку с журналами</h2>
          <p>
            Инструмент прочитает все книги Excel в папке и её подпапках: журналы учёта замечаний и перечни документов
            от руководителей проектов. Файлы никуда не передаются — расчёт идёт на этом компьютере.
          </p>
        </section>
      )}

      {evaluation && (
        <>
          <div class="filters">
            <div class="segmented" role="group" aria-label="Детализация периодов">
              {(['quarter', 'month'] as Granularity[]).map((g) => (
                <button
                  key={g}
                  type="button"
                  class={granularity === g ? 'active' : ''}
                  aria-pressed={granularity === g}
                  onClick={() => {
                    setGranularity(g);
                    setPeriodKey('');
                  }}
                >
                  {g === 'quarter' ? 'Кварталы' : 'Месяцы'}
                </button>
              ))}
            </div>
            <label>
              Состояние
              <select id="period" value={periodKey} onChange={(e) => setPeriodKey(e.currentTarget.value)}>
                <option value="">Текущее</option>
                {[...periods].reverse().map((p) => (
                  <option key={p.key} value={p.key}>на конец периода: {p.label}</option>
                ))}
              </select>
            </label>
            {statuses.length > 1 && (
              <label>
                Статус документа
                <select id="status" value={status} onChange={(e) => setStatus(e.currentTarget.value)}>
                  <option value="">Все</option>
                  {statuses.map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </label>
            )}
            {hasExpertise && (
              <label>
                Экспертиза
                <select id="expertise" value={expertise} onChange={(e) => setExpertise(e.currentTarget.value as ExpertiseFilter)}>
                  <option value="">Все</option>
                  <option value="internal">Внутренняя</option>
                  <option value="external">Внешняя</option>
                </select>
              </label>
            )}
          </div>
          <SummaryCards states={states} />
          <TrendTable points={points} granularity={granularity} selected={periodKey} onSelect={setPeriodKey} />
          <DocumentsTable states={states} previousEnd={previousEnd} />
          <ManagersTable groups={byManager(states.filter((s) => s.manager))} />
          <LoadLog evaluation={evaluation} />
        </>
      )}
    </div>
  );
}

function SummaryCards({ states }: { states: DocumentState[] }) {
  const s = summarize(states);
  const zone = s.average === null ? null : zoneOf(s.average, cfg);
  return (
    <section class="cards">
      <div class={`card kpi ${zone ? `zone-${zone}` : ''}`}>
        <span class="label">Средний ИИКД</span>
        <strong>{fmt(s.average)}</strong>
        <span class="label">{zone ? ZONE_LABEL[zone] : 'нет оценённых документов'}</span>
      </div>
      <div class="card">
        <span class="label">Документов оценено</span>
        <strong>{s.scored}</strong>
        <span class="label">из {s.total}; с неполными данными: {s.incomplete}</span>
      </div>
      {(['green', 'yellow', 'red'] as Zone[]).map((z) => (
        <div class="card" key={z}>
          <span class="label"><i class={`dot zone-${z}`} /> {ZONE_LABEL[z]}</span>
          <strong>{s.zones[z]}</strong>
          <span class="label">{percent(s.zones[z], s.scored)} документов</span>
        </div>
      ))}
    </section>
  );
}

function TrendTable(props: { points: TrendPoint[]; granularity: Granularity; selected: string; onSelect: (key: string) => void }) {
  const { points } = props;
  if (points.length === 0) return null;
  return (
    <section>
      <h2>Динамика по {props.granularity === 'quarter' ? 'кварталам' : 'месяцам'}</h2>
      <p class="muted">Нарастающим итогом: на конец периода учтены все документы, начатые к этому времени, и все выданные к нему замечания.</p>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>Период</th>
              <th class="num">Документов</th>
              <th class="num">Средний ИИКД</th>
              <th class="num">К предыдущему периоду</th>
              <th class="num">Зелёная / жёлтая / красная</th>
            </tr>
          </thead>
          <tbody>
            {points.map((g, index) => {
              const previous = index > 0 ? points[index - 1]!.average : null;
              const change = g.average !== null && previous !== null ? round2(g.average - previous) : null;
              return (
                <tr key={g.key} class={g.key === props.selected ? 'selected' : ''}>
                  <td>
                    <button type="button" class="link" onClick={() => props.onSelect(g.key === props.selected ? '' : g.key)}>{g.label}</button>
                  </td>
                  <td class="num">{g.scored}</td>
                  <td class="num">
                    {g.average === null ? '—' : <span class={`badge zone-${zoneOf(g.average, cfg)}`}>{fmt(g.average)}</span>}
                  </td>
                  <td class="num"><Delta value={change} /></td>
                  <td class="num">{g.zones.green} / {g.zones.yellow} / {g.zones.red}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function IndicatorCell({ state, id }: { state: DocumentState; id: IndicatorId }) {
  if (!state.score || !state.facts) return <td class="num muted">—</td>;
  if (id === 'cycles' && state.facts.cycles === null) return <td class="num muted" title="Число циклов не указано">?</td>;
  const indicator = state.score.indicators[id];
  return (
    <td class={`num ${indicator.over > 0 ? 'over' : ''}`} title={`Норматив ${fmt(indicator.norm)}, сверх нормы ${fmt(indicator.over)}`}>
      {fmt(indicator.fact)} <span class="muted">→ {fmt(indicator.score)}</span>
    </td>
  );
}

function Score({ state }: { state: DocumentState }) {
  if (!state.score) return <span class="muted">нет оценки</span>;
  return <span class={`badge zone-${state.score.zone}`} title={ZONE_LABEL[state.score.zone]}>{fmt(state.score.iikd)}</span>;
}

function DocumentsTable({ states, previousEnd }: { states: DocumentState[]; previousEnd: string | null }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <section>
      <h2>Документы</h2>
      <p class="muted">
        В колонках показателей: фактическое количество → балл показателя.
        {previousEnd && ` «Изменение» — к состоянию на ${formatDate(previousEnd)}.`}
      </p>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>Проект</th>
              <th>РП</th>
              <th>Документ</th>
              <th class="num">Замечаний</th>
              {INDICATOR_IDS.map((id) => (
                <th key={id} class="num">{cfg.indicators[id].short}</th>
              ))}
              <th class="num">ИИКД</th>
              <th class="num">Изменение</th>
              <th>Примечание</th>
            </tr>
          </thead>
          <tbody>
            {states.map((state) => {
              const { doc } = state;
              const previous = previousEnd ? stateAt(doc, previousEnd, cfg) : null;
              const change = state.score && previous?.score ? round2(state.score.iikd - previous.score.iikd) : null;
              const versions = expanded === doc.key ? history(doc, cfg) : [];
              const details = [
                doc.startDate ? `с ${formatDate(doc.startDate)}` : '',
                state.expertise ? EXPERTISE_LABEL[state.expertise] : '',
                state.status,
              ].filter(Boolean).join(' · ');
              // Замечания, отнесённые к показателю по умолчанию: категория в журнале не указана.
              const uncategorized = doc.remarks.filter(
                (r) => r.uncategorized && r.indicator && (state.asOf === null || (r.date ?? doc.startDate ?? '') <= state.asOf),
              ).length;
              const notes = [...state.missing.map((m) => MISSING_LABEL[m]), uncategorized > 0 ? `без категории: ${uncategorized}` : ''].filter(Boolean);
              return (
                <>
                  <tr key={doc.key}>
                    <td>{doc.project || '—'}</td>
                    <td>{state.manager || '—'}</td>
                    <td class="wide">
                      {doc.name}
                      {details && <div class="muted small">{details}</div>}
                      {doc.remarks.length > 0 && (
                        <button type="button" class="link small" onClick={() => setExpanded(expanded === doc.key ? null : doc.key)}>
                          {expanded === doc.key ? 'Скрыть историю' : 'История'}
                        </button>
                      )}
                    </td>
                    <td class="num">{state.remarkCount}</td>
                    {INDICATOR_IDS.map((id) => (
                      <IndicatorCell key={id} state={state} id={id} />
                    ))}
                    <td class="num"><Score state={state} /></td>
                    <td class="num">
                      {!previousEnd ? <span class="muted">—</span> : previous ? <Delta value={change} /> : <span class="muted">новый</span>}
                    </td>
                    <td class="muted">{notes.join('; ')}</td>
                  </tr>
                  {versions.map((version, index) => {
                    const added = version.remarkCount - (versions[index - 1]?.remarkCount ?? 0);
                    return (
                      <tr key={`${doc.key}:${version.asOf}`} class="history">
                        <td colSpan={2} class="nowrap">на {formatDate(version.asOf!)}</td>
                        <td class="muted small">{version.status || '—'}</td>
                        <td class="num">{version.remarkCount}{added > 0 && <span class="muted"> (+{added})</span>}</td>
                        {INDICATOR_IDS.map((id) => (
                          <IndicatorCell key={id} state={version} id={id} />
                        ))}
                        <td class="num"><Score state={version} /></td>
                        <td colSpan={2} />
                      </tr>
                    );
                  })}
                </>
              );
            })}
            {states.length === 0 && (
              <tr><td colSpan={11} class="muted">Нет документов для выбранных условий.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ManagersTable({ groups }: { groups: GroupSummary[] }) {
  if (groups.length === 0) return null;
  return (
    <section>
      <h2>Руководители проектов</h2>
      <p class="muted">Средний ИИКД и средний балл по каждому показателю: видно, на чём теряется качество.</p>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>РП</th>
              <th class="num">Документов</th>
              <th class="num">Средний ИИКД</th>
              <th class="num">Зелёная / жёлтая / красная</th>
              {INDICATOR_IDS.map((id) => (
                <th key={id} class="num">{cfg.indicators[id].short}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.key}>
                <td>{g.label}</td>
                <td class="num">{g.scored}</td>
                <td class="num">
                  {g.average === null ? '—' : <span class={`badge zone-${zoneOf(g.average, cfg)}`}>{fmt(g.average)}</span>}
                </td>
                <td class="num">{g.zones.green} / {g.zones.yellow} / {g.zones.red}</td>
                {INDICATOR_IDS.map((id) => {
                  const average = g.indicators[id].average;
                  return (
                    <td key={id} class={`num ${average === null ? 'muted' : `heat-${zoneOf(average, cfg)}`}`}>{fmt(average)}</td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LoadLog({ evaluation }: { evaluation: Evaluation }) {
  const problems = evaluation.issues.filter((i) => i.level !== 'info').length;
  return (
    <section>
      <h2>Журнал загрузки</h2>
      <details open={problems > 0}>
        <summary>Файлы: {evaluation.files.length}; замечаний к данным: {problems}</summary>
        <div class="scroll">
          <table>
            <thead><tr><th>Файл</th><th>Результат</th></tr></thead>
            <tbody>
              {evaluation.files.map((f) => (
                <tr key={f.path}>
                  <td>{f.path}</td>
                  <td class={f.kind === 'skipped' ? 'over' : ''}>{f.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {evaluation.issues.length > 0 && (
          <div class="scroll">
            <table>
              <thead><tr><th>Уровень</th><th>Файл</th><th class="num">Строка</th><th>Сообщение</th></tr></thead>
              <tbody>
                {evaluation.issues.map((issue, index) => (
                  <tr key={index}>
                    <td class={issue.level === 'info' ? 'muted' : 'over'}>{LEVEL_LABEL[issue.level]}</td>
                    <td>{issue.file}</td>
                    <td class="num">{issue.row ?? ''}</td>
                    <td class="wide">{issue.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </section>
  );
}
