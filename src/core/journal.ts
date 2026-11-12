import { classifyCategories, classifyStatus } from './classify.ts';
import type { Config } from './config.ts';
import { isBlank, norm, parseDate, str } from './text.ts';
import type { Cell, Issue, Journal, Remark, SheetData } from './types.ts';

type Column =
  | 'project' | 'number' | 'date' | 'organization' | 'department' | 'author' | 'document'
  | 'section' | 'object' | 'context' | 'text' | 'category' | 'status' | 'resolution' | 'fileVersion';

/** Колонки ищутся по названиям, а не по позициям: в журналах бывают скрытые и переставленные колонки. */
const COLUMN_MATCHERS: Record<Column, (header: string) => boolean> = {
  project: (h) => h === 'проект',
  number: (h) => h.startsWith('номер замечания') || h === '№' || h === '№ п/п',
  date: (h) => h.startsWith('дата замечания'),
  organization: (h) => h.startsWith('организация'),
  department: (h) => h.startsWith('подразделение'),
  author: (h) => h.startsWith('фио'),
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

  const remarks: Remark[] = [];
  const issues: Issue[] = [];
  let lastProject = '';

  for (let index = header.index + 1; index < sheet.rows.length; index++) {
    const row = sheet.rows[index] ?? [];
    const rowNumber = index + 1;
    if (isHintRow(row)) continue;
    // Замечанием считается строка, где заполнено хотя бы что-то по существу.
    if (isBlank(cell(row, 'text')) && isBlank(cell(row, 'category')) && isBlank(cell(row, 'status'))) continue;

    const project = str(cell(row, 'project')) || lastProject;
    lastProject = project;

    const statusRaw = str(cell(row, 'status'));
    const status = classifyStatus(statusRaw, cfg);
    const categoryRaw = str(cell(row, 'category'));
    const classified = classifyCategories(cell(row, 'category'), cfg);

    if (status === 'empty') {
      issues.push({ level: 'warning', file: path, row: rowNumber, message: 'Статус замечания не указан — замечание не учтено.' });
    } else if (status === 'unknown') {
      issues.push({ level: 'warning', file: path, row: rowNumber, message: `Статус «${statusRaw}» отсутствует в справочнике — замечание не учтено.` });
    }
    if (status === 'accepted') {
      if (!categoryRaw) {
        issues.push({ level: 'warning', file: path, row: rowNumber, message: 'Категория замечания не указана — замечание не учтено.' });
      }
      for (const fragment of classified.unknown) {
        issues.push({ level: 'warning', file: path, row: rowNumber, message: `Категория «${fragment}» отсутствует в справочнике.` });
      }
    }

    remarks.push({
      row: rowNumber,
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
      categoryRaw,
      categories: classified.categories,
      statusRaw,
      status,
      indicator: status === 'accepted' ? classified.indicator : null,
      resolution: str(cell(row, 'resolution')),
      fileVersion: str(cell(row, 'fileVersion')),
    });
  }

  const documents = new Set(remarks.map((r) => norm(r.document)).filter(Boolean));
  if (documents.size > 1) {
    issues.push({
      level: 'info',
      file: path,
      message: `В журнале замечания к ${documents.size} разным наименованиям документа — все отнесены к одной оценке.`,
    });
  }
  return { path, sheet: sheet.name, remarks, issues };
}
