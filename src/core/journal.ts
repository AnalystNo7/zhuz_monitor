import { classifyCategories, classifyStatus, pickIndicator } from './classify.ts';
import type { Config } from './config.ts';
import { isBlank, norm, parseDate, str } from './text.ts';
import type { Cell, Issue, Journal, Remark, RemarkIndicator, RemarkStatus, SheetData } from './types.ts';

type Column =
  | 'project' | 'number' | 'date' | 'organization' | 'department' | 'author' | 'document'
  | 'section' | 'object' | 'context' | 'text' | 'category' | 'status' | 'resolution' | 'fileVersion';

/** Колонки ищутся по названиям, а не по позициям: в журналах бывают скрытые, лишние и переставленные колонки. */
const COLUMN_MATCHERS: Record<Column, (header: string) => boolean> = {
  project: (h) => h === 'проект',
  number: (h) => h.startsWith('номер замечания') || h === '№' || h === '№ п/п',
  date: (h) => h.startsWith('дата замечания'),
  organization: (h) => h.startsWith('организация'),
  department: (h) => h.startsWith('подразделение'),
  author: (h) => h.startsWith('фио автора замечания') || h === 'фио',
  document: (h) => h === 'документ',
  section: (h) => h.startsWith('раздел'),
  object: (h) => h.startsWith('объект'),
  context: (h) => h === 'контекст',
  text: (h) => h.startsWith('состав замечания'),
  category: (h) => h.startsWith('категория'),
  status: (h) => h.startsWith('статус замечания') || h === 'статус',
  resolution: (h) => h.startsWith('отработка'),
  fileVersion: (h) => h.startsWith('наименование файла'),
};

const REQUIRED: Column[] = ['text', 'category', 'status'];
const HEADER_SEARCH_ROWS = 20;
/** Сколько номеров строк перечислять в одном сообщении журнала загрузки. */
const ROWS_IN_MESSAGE = 12;

type ColumnMap = Partial<Record<Column, number>>;

function mapColumns(row: Cell[]): ColumnMap {
  const map: ColumnMap = {};
  row.forEach((cell, index) => {
    const header = norm(cell);
    if (!header) return;
    for (const column of Object.keys(COLUMN_MATCHERS) as Column[]) {
      if (map[column] === undefined && COLUMN_MATCHERS[column](header)) {
        map[column] = index;
        return;
      }
    }
  });
  return map;
}

function findHeader(rows: Cell[][]): { index: number; columns: ColumnMap } | null {
  for (let index = 0; index < Math.min(rows.length, HEADER_SEARCH_ROWS); index++) {
    const columns = mapColumns(rows[index] ?? []);
    if (REQUIRED.every((c) => columns[c] !== undefined)) return { index, columns };
  }
  return null;
}

/** Строка-подсказка под шапкой шаблона: описание правил заполнения каждой колонки. */
function isHintRow(row: Cell[]): boolean {
  return row.filter((cell) => norm(cell).includes('устанавливается')).length >= 2;
}

function rowList(rows: number[]): string {
  const shown = rows.slice(0, ROWS_IN_MESSAGE).join(', ');
  return rows.length > ROWS_IN_MESSAGE ? `${shown} и ещё ${rows.length - ROWS_IN_MESSAGE}` : shown;
}

/** Строка журнала до объединения повторов и назначения показателя. */
interface Draft extends Remark {
  indicators: RemarkIndicator[];
  unknownCategories: string[];
  /** Номера всех строк, объединённых в замечание. */
  rows: number[];
}

/** При объединении повторов побеждает более «сильный» статус: принятое замечание остаётся принятым. */
const STATUS_RANK: Record<RemarkStatus, number> = { accepted: 4, pending: 3, unknown: 2, empty: 1, rejected: 0 };

function mergeDuplicates(drafts: Draft[]): Draft[] {
  const unique: Draft[] = [];
  const byText = new Map<string, Draft>();
  for (const draft of drafts) {
    const key = norm(draft.text);
    const first = key ? byText.get(key) : undefined;
    if (!first) {
      if (key) byText.set(key, draft);
      unique.push(draft);
      continue;
    }
    first.copies += 1;
    first.rows.push(draft.row);
    if (STATUS_RANK[draft.status] > STATUS_RANK[first.status]) {
      first.status = draft.status;
      first.statusRaw = draft.statusRaw;
    }
    if (draft.date && (!first.date || draft.date < first.date)) first.date = draft.date;
    for (const id of draft.categories) if (!first.categories.includes(id)) first.categories.push(id);
    first.indicators.push(...draft.indicators);
    first.unknownCategories.push(...draft.unknownCategories);
    first.categoryRaw ||= draft.categoryRaw;
  }
  return unique;
}

/**
 * Разбирает лист как журнал учёта замечаний.
 * Возвращает `null`, если на листе нет шапки ЖУЗ.
 */
export function parseJournal(sheet: SheetData, path: string, cfg: Config): Journal | null {
  const header = findHeader(sheet.rows);
  if (!header) return null;
  const { columns } = header;
  const cell = (row: Cell[], column: Column): Cell => {
    const index = columns[column];
    return index === undefined ? null : (row[index] ?? null);
  };

  const drafts: Draft[] = [];
  let lastProject = '';
  for (let index = header.index + 1; index < sheet.rows.length; index++) {
    const row = sheet.rows[index] ?? [];
    if (isHintRow(row)) continue;
    // Замечанием считается строка, где заполнено хотя бы что-то по существу.
    // Пустые строки и разделители вроде «Цикл согласования 1» сюда не попадают.
    if (isBlank(cell(row, 'text')) && isBlank(cell(row, 'category')) && isBlank(cell(row, 'status'))) continue;

    const project = str(cell(row, 'project')) || lastProject;
    lastProject = project;
    const statusRaw = str(cell(row, 'status'));
    const classified = classifyCategories(cell(row, 'category'), cfg);
    drafts.push({
      row: index + 1,
      project,
      number: str(cell(row, 'number')),
      date: parseDate(cell(row, 'date')),
      organization: str(cell(row, 'organization')),
      department: str(cell(row, 'department')),
      author: str(cell(row, 'author')),
      document: str(cell(row, 'document')),
      section: str(cell(row, 'section')),
      object: str(cell(row, 'object')),
      context: str(cell(row, 'context')),
      text: str(cell(row, 'text')),
      categoryRaw: str(cell(row, 'category')),
      categories: classified.categories,
      statusRaw,
      status: classifyStatus(statusRaw, cfg),
      indicator: null,
      uncategorized: false,
      copies: 1,
      resolution: str(cell(row, 'resolution')),
      fileVersion: str(cell(row, 'fileVersion')),
      indicators: classified.indicators,
      unknownCategories: classified.unknown,
      rows: [index + 1],
    });
  }

  const issues: Issue[] = [];
  const note = (level: Issue['level'], message: string) => issues.push({ level, file: path, message });

  const merged = cfg.mergeDuplicateRemarks ? mergeDuplicates(drafts) : drafts;
  if (merged.length < drafts.length) {
    note('info', `Повторяющиеся по тексту замечания учтены один раз: строк ${drafts.length}, уникальных замечаний ${merged.length}.`);
  }

  // Показатель назначается после объединения: у повтора категория может быть указана только в одной из строк.
  const fallback = cfg.uncategorizedIndicator;
  const fallbackNote = fallback ? `учтены как «${cfg.indicators[fallback].short.toLowerCase()}»` : 'не учтены';
  const noCategory: number[] = [];
  const unknownCategory = new Map<string, number[]>();
  const unknownStatus = new Map<string, number[]>();
  const noStatus: number[] = [];
  let pending = 0;
  let undated = 0;

  for (const draft of merged) {
    if (!draft.date) undated += 1;
    if (draft.status === 'pending') pending += 1;
    if (draft.status === 'empty') noStatus.push(...draft.rows);
    if (draft.status === 'unknown') unknownStatus.set(draft.statusRaw, [...(unknownStatus.get(draft.statusRaw) ?? []), ...draft.rows]);
    if (draft.status !== 'accepted') continue;

    if (draft.categories.length > 0) {
      draft.indicator = pickIndicator(draft.indicators, cfg);
    } else {
      draft.indicator = fallback;
      draft.uncategorized = true;
      if (draft.unknownCategories.length === 0) noCategory.push(...draft.rows);
    }
    for (const fragment of new Set(draft.unknownCategories)) {
      unknownCategory.set(fragment, [...(unknownCategory.get(fragment) ?? []), ...draft.rows]);
    }
  }

  if (noCategory.length > 0) {
    note('warning', `У принятых замечаний не указана категория — ${fallbackNote}. Строки: ${rowList(noCategory)}.`);
  }
  for (const [fragment, rows] of unknownCategory) {
    note('warning', `Категория «${fragment}» отсутствует в справочнике. Строки: ${rowList(rows)}.`);
  }
  for (const [status, rows] of unknownStatus) {
    note('warning', `Статус «${status}» отсутствует в справочнике — замечания не учтены. Строки: ${rowList(rows)}.`);
  }
  if (noStatus.length > 0) {
    note('warning', `Статус замечания не указан — замечания не учтены. Строки: ${rowList(noStatus)}.`);
  }
  if (pending > 0) {
    note('info', `Замечаний, по которым решение ещё не принято: ${pending}. В расчёт они не входят.`);
  }
  if (undated > 0 && undated < merged.length) {
    note('warning', `У ${undated} замечаний не указана дата — они отнесены к дате первого замечания.`);
  }
  const documents = new Set(drafts.map((r) => norm(r.document)).filter(Boolean));
  if (documents.size > 1) {
    note('info', `В журнале ${documents.size} разных наименования документа — все замечания отнесены к одному документу.`);
  }

  const remarks: Remark[] = merged.map(({ indicators: _i, unknownCategories: _u, rows: _r, ...remark }) => remark);
  return {
    path,
    sheet: sheet.name,
    project: drafts.find((d) => d.project)?.project ?? '',
    document: drafts.find((d) => d.document)?.document ?? '',
    remarks,
    rowCount: drafts.length,
    issues,
  };
}
