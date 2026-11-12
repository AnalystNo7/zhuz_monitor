import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { byManager, summarize, trend, type GroupSummary, type TrendPoint } from '../core/aggregate.ts';
import { DEFAULT_CONFIG, INDICATOR_IDS } from '../core/config.ts';
import { applyManual, emptyManualData, MANUAL_FILE_NAME, manualSheets } from '../core/manual.ts';
import { round2, zoneOf } from '../core/score.ts';
import { dateFromTimestamp, formatDate, norm } from '../core/text.ts';
import { history, listPeriods, stateAt, statesAt } from '../core/timeline.ts';
import type { DocumentState, Evaluation, Granularity, IndicatorId, ManualData, MissingPart, Zone } from '../core/types.ts';
import { canPickFolder, downloadFile, folderFromFileList, pickFolder, type SourceFolder } from '../io/folder.ts';
import { writeWorkbook } from '../io/xlsx-write.ts';
import { loadFolder } from './load.ts';
import { ManualForm, manualRows, type DocumentRow, type ProjectGroup } from './ManualForm.tsx';

const cfg = DEFAULT_CONFIG;
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const ZONE_LABEL: Record<Zone, string> = { green: 'Зелёная зона', yellow: 'Жёлтая зона', red: 'Красная зона' };
const MISSING_LABEL: Record<MissingPart, string> = {
  journal: 'ЖУЗ не найден',
  categories: 'у принятых замечаний нет категории',
  date: 'дата начала не определена',
};
const LEVEL_LABEL = { error: 'Ошибка', warning: 'Внимание', info: 'К сведению' } as const;
const CYCLES_SOURCE: Record<DocumentState['cyclesSource'], string> = {
  form: 'Задано вручную',
  registry: 'Из перечня документов',
  journal: 'Оценено по датам замечаний в журнале',
};
/** Значение фильтра для документов, у которых статус не указан. */
const NO_STATUS = '—';

function fmt(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

function percent(part: number, total: number): string {
  return total === 0 ? '—' : `${Math.round((part / total) * 100)}%`;
}

function statusKey(state: DocumentState): string {
  return norm(state.status) || NO_STATUS;
}

/** Снимок ручного ввода для сравнения: есть ли несохранённые изменения. */
function snapshot(data: ManualData): string {
  return JSON.stringify(manualSheets(data));
}

function cloneManual(data: ManualData): ManualData {
  return { managers: new Map(data.managers), documents: new Map(data.documents) };
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
  const [status, setStatus] = useState('');
  const [manual, setManual] = useState<ManualData>(emptyManualData());
  const [savedSnapshot, setSavedSnapshot] = useState(snapshot(emptyManualData()));
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const dirty = snapshot(manual) !== savedSnapshot;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function load(source: SourceFolder) {
    if (dirty && !window.confirm('Ручной ввод не сохранён. Загрузить данные заново и потерять изменения?')) return;
    setLoading(true);
    setError(null);
    try {
      const result = await loadFolder(source, cfg);
      setEvaluation(result);
      setFolder(source);
      setPeriodKey('');
      setStatus('');
      setManual(cloneManual(result.manual));
      setSavedSnapshot(snapshot(result.manual));
      setSaveMessage(null);
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

  function setManager(group: ProjectGroup, manager: string) {
    const next = cloneManual(manual);
    if (manager.trim()) next.managers.set(group.key, { project: group.project, manager });
    else next.managers.delete(group.key);
    setManual(next);
    setSaveMessage(null);
  }

  /** Меняет статус или циклы документа; дата изменения — сегодняшняя. */
  function setOverride(row: DocumentRow, change: { status?: string; cycles?: number | null }) {
    const next = cloneManual(manual);
    const current = next.documents.get(row.key) ?? { project: row.project, document: row.document, status: '', cycles: null, updated: null };
    const updated = { ...current, ...change, updated: dateFromTimestamp(Date.now()) };
    if (updated.status || updated.cycles !== null) next.documents.set(row.key, updated);
    else next.documents.delete(row.key);
    setManual(next);
    setSaveMessage(null);
  }

  async function saveManual() {
    const data = writeWorkbook(manualSheets(manual));
    // Если файл ручного ввода уже лежит в корне папки, перезаписываем его, а не создаём второй.
    const existing = evaluation?.manualPath;
    const name = existing && !existing.includes('/') ? existing : MANUAL_FILE_NAME;
    setSaving(true);
    try {
      if (folder?.save) {
        await folder.save(name, data);
        setSaveMessage(`Сохранено в папку: ${name}`);
      } else {
        downloadFile(name, data, XLSX_TYPE);
        setSaveMessage('Файл скачан. Положите его в папку с журналами, чтобы введённое видели все.');
      }
      setSavedSnapshot(snapshot(manual));
    } catch (e) {
      setSaveMessage(`Не удалось сохранить: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  const documents = useMemo(() => applyManual(evaluation?.documents ?? [], manual), [evaluation, manual]);
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

  const matches = (state: DocumentState) => !status || statusKey(state) === status;
  const states = useMemo(() => statesAt(documents, asOf, cfg).filter(matches), [documents, asOf, status]);
  const points = useMemo(() => trend(documents, granularity, cfg, matches), [documents, granularity, status]);
  // Подсказки в форме — значения без ручного ввода: из перечня и по журналу.
  const formGroups = useMemo(() => manualRows(statesAt(evaluation?.documents ?? [], null, cfg)), [evaluation]);

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
            Инструмент прочитает все книги Excel в папке и её подпапках: журналы учёта замечаний, перечни документов
            и назначения руководителей проектов. Файлы никуда не передаются — расчёт идёт на этом компьютере.
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
          </div>
          <SummaryCards states={states} />
          <TrendTable points={points} granularity={granularity} selected={periodKey} onSelect={setPeriodKey} />
          <DocumentsTable states={states} previousEnd={previousEnd} />
          <ManagersTable groups={byManager(states.filter((s) => s.manager))} unassigned={states.filter((s) => !s.manager).length} />
          <ManualForm
            groups={formGroups}
            data={manual}
            statuses={cfg.documentStatuses}
            onManager={setManager}
            onStatus={(row, status) => setOverride(row, { status })}
            onCycles={(row, value) => {
              const cycles = Number(value);
              setOverride(row, { cycles: value.trim() && Number.isInteger(cycles) && cycles >= 1 ? cycles : null });
            }}
            dirty={dirty}
            canSave={Boolean(folder?.save)}
            saving={saving}
            message={saveMessage}
            onSave={saveManual}
          />
          <LoadLog evaluation={evaluation} />
        </>
      )}
    </div>
  );
}

function SummaryCards({ states }: { states: DocumentState[] }) {
  const s = summarize(states);
  const zone = s.average === null ? null : zoneOf(s.average, cfg);
  const notScored = s.total - s.scored;
  return (
    <section class="cards">
      <div class={`card kpi ${zone ? `zone-${zone}` : ''}`}>
        <span class="label">Средний ИИКД</span>
        <strong>{fmt(s.average)}</strong>
        <span class="label">{zone ? ZONE_LABEL[zone] : 'нет рассчитанных документов'}</span>
      </div>
      <div class="card">
        <span class="label">Документов рассчитано</span>
        <strong>{s.scored}</strong>
        <span class={`label ${notScored > 0 ? 'over' : ''}`}>из {s.total}{notScored > 0 && `; не рассчитано: ${notScored}`}</span>
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
                  <td class="num">{g.scored}{g.total > g.scored && <span class="muted"> из {g.total}</span>}</td>
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
  const indicator = state.score.indicators[id];
  const source = id === 'cycles' ? ` ${CYCLES_SOURCE[state.cyclesSource]}.` : '';
  return (
    <td class={`num ${indicator.over > 0 ? 'over' : ''}`} title={`Норматив ${fmt(indicator.norm)}, сверх нормы ${fmt(indicator.over)}.${source}`}>
      {fmt(indicator.fact)} <span class="muted">→ {fmt(indicator.score)}</span>
    </td>
  );
}

function Score({ state }: { state: DocumentState }) {
  if (!state.score) return <span class="over">не рассчитан</span>;
  return <span class={`badge zone-${state.score.zone}`} title={ZONE_LABEL[state.score.zone]}>{fmt(state.score.iikd)}</span>;
}

function notesOf(state: DocumentState): string[] {
  return state.missing.map((m) =>
    m === 'categories' ? `${MISSING_LABEL[m]}, строки ${state.doc.uncategorizedRows.join(', ')}` : MISSING_LABEL[m],
  );
}

function DocumentsTable({ states, previousEnd }: { states: DocumentState[]; previousEnd: string | null }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <section>
      <h2>Документы</h2>
      <p class="muted">
        В колонках показателей: фактическое количество → балл показателя. Циклы, не заданные вручную или в перечне, оцениваются по датам замечаний.
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
              const details = [doc.startDate ? `с ${formatDate(doc.startDate)}` : '', state.status].filter(Boolean).join(' · ');
              return (
                <>
                  <tr key={doc.key}>
                    <td>{doc.project || '—'}</td>
                    <td>{state.manager || <span class="muted">не назначен</span>}</td>
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
                      {!previousEnd || !state.score ? <span class="muted">—</span> : previous ? <Delta value={change} /> : <span class="muted">новый</span>}
                    </td>
                    <td class={state.score ? 'muted' : 'over'}>{notesOf(state).join('; ')}</td>
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

function ManagersTable({ groups, unassigned }: { groups: GroupSummary[]; unassigned: number }) {
  return (
    <section>
      <h2>Рейтинг руководителей проектов</h2>
      <p class="muted">
        Средний ИИКД и средний балл по каждому показателю: видно, на чём теряется качество.
        {unassigned > 0 && ` Документов без РП: ${unassigned} — назначьте РП проектам в разделе «Ручной ввод».`}
      </p>
      {groups.length > 0 && (
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
                  <td class="num">{g.scored}{g.total > g.scored && <span class="muted"> из {g.total}</span>}</td>
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
      )}
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
