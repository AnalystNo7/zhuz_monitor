import { useMemo, useRef, useState } from 'preact/hooks';
import { byManager, listPeriods, summarize, type GroupSummary } from '../core/aggregate.ts';
import { DEFAULT_CONFIG, INDICATOR_IDS } from '../core/config.ts';
import { zoneOf } from '../core/score.ts';
import type { DocumentEval, Evaluation, IndicatorId, MissingPart, Zone } from '../core/types.ts';
import { canPickFolder, folderFromFileList, pickFolder, type SourceFolder } from '../io/folder.ts';
import { loadFolder } from './load.ts';

const cfg = DEFAULT_CONFIG;

const ZONE_LABEL: Record<Zone, string> = { green: 'Зелёная зона', yellow: 'Жёлтая зона', red: 'Красная зона' };
const MISSING_LABEL: Record<MissingPart, string> = {
  registry: 'нет в перечне документов',
  journal: 'нет ЖУЗ',
  cycles: 'циклы не указаны',
  period: 'период не указан',
};
const LEVEL_LABEL = { error: 'Ошибка', warning: 'Внимание', info: 'К сведению' } as const;

function fmt(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

function percent(part: number, total: number): string {
  return total === 0 ? '—' : `${Math.round((part / total) * 100)}%`;
}

export function App() {
  const [folder, setFolder] = useState<SourceFolder | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [periodKey, setPeriodKey] = useState('');
  const input = useRef<HTMLInputElement>(null);

  async function load(source: SourceFolder) {
    setLoading(true);
    setError(null);
    try {
      setEvaluation(await loadFolder(source, cfg));
      setFolder(source);
      setPeriodKey('');
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

  const periods = useMemo(() => listPeriods(evaluation?.documents ?? []), [evaluation]);
  const documents = useMemo(
    () => (evaluation?.documents ?? []).filter((d) => !periodKey || d.period?.key === periodKey),
    [evaluation, periodKey],
  );

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
          {periods.length > 1 && (
            <label class="filter">
              Отчётный период
              <select value={periodKey} onChange={(e) => setPeriodKey(e.currentTarget.value)}>
                <option value="">Все периоды</option>
                {periods.map((p) => (
                  <option key={p.key} value={p.key}>{p.label}</option>
                ))}
              </select>
            </label>
          )}
          <SummaryCards documents={documents} />
          <DocumentsTable documents={documents} />
          <ManagersTable groups={byManager(documents.filter((d) => d.manager))} />
          <LoadLog evaluation={evaluation} />
        </>
      )}
    </div>
  );
}

function SummaryCards({ documents }: { documents: DocumentEval[] }) {
  const s = summarize(documents);
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

function IndicatorCell({ doc, id }: { doc: DocumentEval; id: IndicatorId }) {
  if (!doc.score || !doc.facts) return <td class="num muted">—</td>;
  if (id === 'cycles' && doc.facts.cycles === null) return <td class="num muted" title="Число циклов не указано">?</td>;
  const indicator = doc.score.indicators[id];
  return (
    <td class={`num ${indicator.over > 0 ? 'over' : ''}`} title={`Норматив ${fmt(indicator.norm)}, сверх нормы ${fmt(indicator.over)}`}>
      {fmt(indicator.fact)} <span class="muted">→ {fmt(indicator.score)}</span>
    </td>
  );
}

function DocumentsTable({ documents }: { documents: DocumentEval[] }) {
  return (
    <section>
      <h2>Документы</h2>
      <p class="muted">В колонках показателей: фактическое количество → балл показателя.</p>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>Период</th>
              <th>Проект</th>
              <th>РП</th>
              <th>Документ</th>
              {INDICATOR_IDS.map((id) => (
                <th key={id} class="num">{cfg.indicators[id].short}</th>
              ))}
              <th class="num">ИИКД</th>
              <th>Примечание</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.id}>
                <td>{doc.period?.label ?? '—'}</td>
                <td>{doc.project || '—'}</td>
                <td>{doc.manager || '—'}</td>
                <td class="wide">{doc.document}</td>
                {INDICATOR_IDS.map((id) => (
                  <IndicatorCell key={id} doc={doc} id={id} />
                ))}
                <td class="num">
                  {doc.score ? (
                    <span class={`badge zone-${doc.score.zone}`} title={ZONE_LABEL[doc.score.zone]}>{fmt(doc.score.iikd)}</span>
                  ) : (
                    <span class="muted">нет оценки</span>
                  )}
                </td>
                <td class="muted">{doc.missing.map((m) => MISSING_LABEL[m]).join('; ')}</td>
              </tr>
            ))}
            {documents.length === 0 && (
              <tr><td colSpan={10} class="muted">В папке не найдено ни одного журнала учёта замечаний.</td></tr>
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
