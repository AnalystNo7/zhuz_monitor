import { isBlank, norm, parseReportingDate, str } from './text.ts';
import type { Cell, Expertise, Issue, Registry, RegistryRow, SheetData } from './types.ts';

type Column =
  | 'project' | 'manager' | 'developer' | 'document' | 'status' | 'channel' | 'folderLink'
  | 'internal' | 'external' | 'cycles' | 'pages' | 'journalFile';

/**
 * Колонки расширенного Шаблона_1. Первые девять — из исходного шаблона,
 * последние три добавлены для автоматического расчёта.
 */
const COLUMN_MATCHERS: Record<Column, (header: string) => boolean> = {
  project: (h) => h === 'проект',
  manager: (h) => h === 'рп' || h.startsWith('руководитель проекта'),
  developer: (h) => h.startsWith('отв'),
  document: (h) => h.startsWith('проектный документ'),
  status: (h) => h.startsWith('статус документа'),
  channel: (h) => h.includes('сэд') || h.includes('tessa') || h.includes('пспд'),
  folderLink: (h) => h.startsWith('ссылка'),
  internal: (h) => h.startsWith('внутр'),
  external: (h) => h.startsWith('внеш'),
  cycles: (h) => h.includes('цикл'),
  pages: (h) => h.includes('лист'),
  journalFile: (h) => h.includes('файл') && h.includes('жуз'),
};

const REQUIRED: Column[] = ['project', 'manager', 'document'];
const HEADER_SEARCH_ROWS = 15;
/** Подписи над таблицей, после которых указана дата или отчётный период. */
const DATE_LABELS = ['отчетный период', 'данные на', 'дата выгрузки'];

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

function yesNo(v: Cell): boolean | null {
  const s = norm(v);
  if (s === 'да') return true;
  if (s === 'нет') return false;
  return null;
}

function count(v: Cell): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null;
  const s = str(v).replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/** Ищет над шапкой подпись вида «Отчетный период: …»; значение — после подписи или в соседней ячейке. */
function findAsOf(rows: Cell[][], headerIndex: number): string | null {
  for (let i = 0; i < headerIndex; i++) {
    const row = rows[i] ?? [];
    for (let j = 0; j < row.length; j++) {
      const text = norm(row[j]);
      const label = DATE_LABELS.find((l) => text.startsWith(l));
      if (!label) continue;
      const inline = parseReportingDate(text.slice(label.length));
      if (inline) return inline;
      for (let k = j + 1; k < row.length; k++) {
        if (!isBlank(row[k])) return parseReportingDate(row[k]);
      }
    }
  }
  return null;
}

export type RegistryParse =
  | { kind: 'registry'; registry: Registry }
  /** Лист похож на Шаблон_1, но в нём нет колонки «Файл ЖУЗ». */
  | { kind: 'incomplete' }
  | { kind: 'none' };

/** Разбирает лист как расширенный Шаблон_1 (перечень документов от руководителя проекта). */
export function parseRegistry(sheet: SheetData, path: string): RegistryParse {
  let headerIndex = -1;
  let columns: ColumnMap = {};
  for (let i = 0; i < Math.min(sheet.rows.length, HEADER_SEARCH_ROWS); i++) {
    const candidate = mapColumns(sheet.rows[i] ?? []);
    if (REQUIRED.every((c) => candidate[c] !== undefined)) {
      headerIndex = i;
      columns = candidate;
      break;
    }
  }
  if (headerIndex < 0) return { kind: 'none' };
  if (columns.journalFile === undefined) return { kind: 'incomplete' };

  const cell = (row: Cell[], column: Column): Cell => {
    const index = columns[column];
    return index === undefined ? null : (row[index] ?? null);
  };

  const issues: Issue[] = [];
  const asOf = findAsOf(sheet.rows, headerIndex);

  const rows: RegistryRow[] = [];
  for (let i = headerIndex + 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i] ?? [];
    const document = str(cell(row, 'document'));
    if (!document) continue;
    const rowNumber = i + 1;

    const cyclesCell = cell(row, 'cycles');
    const cycles = count(cyclesCell);
    if (cycles === null && !isBlank(cyclesCell)) {
      issues.push({ level: 'warning', file: path, row: rowNumber, message: `Число циклов «${str(cyclesCell)}» не распознано.` });
    }

    // Внутренняя и внешняя экспертиза оцениваются отдельно: на каждую — своя строка и свой ЖУЗ.
    const internal = yesNo(cell(row, 'internal'));
    const external = yesNo(cell(row, 'external'));
    let expertise: Expertise | null = null;
    if (internal && external) {
      issues.push({
        level: 'warning',
        file: path,
        row: rowNumber,
        message: `«${document}»: отмечены и внутреннее, и внешнее согласование. На каждую экспертизу нужна отдельная строка со своим ЖУЗ.`,
      });
    } else if (internal) {
      expertise = 'internal';
    } else if (external) {
      expertise = 'external';
    }

    rows.push({
      row: rowNumber,
      project: str(cell(row, 'project')),
      manager: str(cell(row, 'manager')),
      developer: str(cell(row, 'developer')),
      document,
      status: str(cell(row, 'status')),
      channel: str(cell(row, 'channel')),
      folderLink: str(cell(row, 'folderLink')),
      internal,
      external,
      expertise,
      cycles,
      pages: count(cell(row, 'pages')),
      journalFile: str(cell(row, 'journalFile')),
    });
  }
  return { kind: 'registry', registry: { path, sheet: sheet.name, asOf, rows, issues } };
}
