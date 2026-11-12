/** Значение ячейки после чтения книги. Даты приходят как порядковый номер дня Excel. */
export type Cell = string | number | boolean | null;

export interface SheetData {
  name: string;
  rows: Cell[][];
}

/** Четыре показателя методики. */
export type IndicatorId = 'design' | 'content' | 'repeats' | 'cycles';
/** Показатели, которые считаются по замечаниям ЖУЗ. */
export type RemarkIndicator = Exclude<IndicatorId, 'cycles'>;

export type Zone = 'green' | 'yellow' | 'red';
export type RemarkStatus = 'accepted' | 'rejected' | 'unknown' | 'empty';

export type Granularity = 'month' | 'quarter';

/** Отчётный период выбранной детализации: месяц или квартал. */
export interface Period {
  /** Ключ для сортировки и группировки: `2026-Q3` или `2026-09`. */
  key: string;
  label: string;
}

/** Вид экспертизы, по итогам которой заведён журнал. */
export type Expertise = 'internal' | 'external';

export interface Issue {
  level: 'error' | 'warning' | 'info';
  file: string;
  /** Номер строки на листе, как его видит пользователь в Excel. */
  row?: number;
  message: string;
}

export interface Remark {
  /** Номер строки на листе Excel. */
  row: number;
  project: string;
  number: string;
  date: string | null;
  organization: string;
  department: string;
  author: string;
  document: string;
  section: string;
  object: string;
  context: string;
  text: string;
  categoryRaw: string;
  /** Идентификаторы распознанных категорий из справочника. */
  categories: string[];
  statusRaw: string;
  status: RemarkStatus;
  /** Показатель, в который пошло замечание; `null` — в расчёте не участвует. */
  indicator: RemarkIndicator | null;
  resolution: string;
  fileVersion: string;
}

export interface Journal {
  path: string;
  sheet: string;
  remarks: Remark[];
  issues: Issue[];
}

/** Строка расширенного Шаблона_1: паспорт документа от руководителя проекта. */
export interface RegistryRow {
  row: number;
  project: string;
  manager: string;
  developer: string;
  document: string;
  status: string;
  channel: string;
  folderLink: string;
  internal: boolean | null;
  external: boolean | null;
  /** Вид экспертизы строки; `null`, если не отмечен или отмечены оба. */
  expertise: Expertise | null;
  cycles: number | null;
  pages: number | null;
  /** Имя файла ЖУЗ либо отметка «без замечаний». */
  journalFile: string;
}

export interface Registry {
  path: string;
  sheet: string;
  /** Дата, на которую составлен перечень (конец отчётного периода), `ГГГГ-ММ-ДД`. */
  asOf: string | null;
  rows: RegistryRow[];
  issues: Issue[];
}

export interface IndicatorScore {
  fact: number;
  norm: number;
  over: number;
  score: number;
  weight: number;
  contribution: number;
}

export interface DocScore {
  indicators: Record<IndicatorId, IndicatorScore>;
  iikd: number;
  zone: Zone;
}

/** Чего не хватило для полной оценки документа. */
export type MissingPart = 'registry' | 'journal' | 'cycles' | 'date';

export interface DocumentEval {
  id: string;
  /**
   * Ключ документа, общий для всех его версий: проект, наименование и вид экспертизы.
   * По нему версии, загруженные в разное время, собираются в историю.
   */
  docKey: string;
  /** Дата версии, `ГГГГ-ММ-ДД`; `null`, если определить не удалось. */
  asOf: string | null;
  project: string;
  manager: string;
  developer: string;
  document: string;
  status: string;
  expertise: Expertise | null;
  pages: number | null;
  registryPath: string | null;
  journalPath: string | null;
  /** Фактические значения; `cycles: null` — число циклов не указано. */
  facts: { design: number; content: number; repeats: number; cycles: number | null } | null;
  /** `null`, если документ оценить нельзя (нет ЖУЗ). */
  score: DocScore | null;
  missing: MissingPart[];
  remarks: Remark[];
}

export interface FileReport {
  path: string;
  kind: 'journal' | 'registry' | 'skipped';
  note: string;
}

export interface Evaluation {
  documents: DocumentEval[];
  files: FileReport[];
  issues: Issue[];
}
