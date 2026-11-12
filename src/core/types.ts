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
/** `pending` — решение по замечанию ещё не принято («Новое»). */
export type RemarkStatus = 'accepted' | 'rejected' | 'pending' | 'unknown' | 'empty';

export type Granularity = 'month' | 'quarter';

/** Отчётный период выбранной детализации: месяц или квартал. */
export interface Period {
  /** Ключ для сортировки и группировки: `2026-Q3` или `2026-09`. */
  key: string;
  label: string;
  /** Последний день периода, `ГГГГ-ММ-ДД`. */
  end: string;
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
  /** Категория не указана или не распознана; показатель назначен по умолчанию. */
  uncategorized: boolean;
  /** Сколько строк журнала с тем же текстом объединено в это замечание (1 — без повторов). */
  copies: number;
  resolution: string;
  fileVersion: string;
}

export interface Journal {
  path: string;
  sheet: string;
  /** Проект и документ журнала — по первому замечанию. */
  project: string;
  document: string;
  /** Уникальные замечания. */
  remarks: Remark[];
  /** Сколько строк с замечаниями было в журнале до объединения повторов. */
  rowCount: number;
  issues: Issue[];
}

/** Строка расширенного Шаблона_1: сведения о документе от руководителя проекта. */
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

/** Сведения о документе из перечня на дату его составления. */
export interface Passport {
  /** Дата перечня; `null`, если определить не удалось. */
  asOf: string | null;
  registryPath: string;
  row: number;
  project: string;
  document: string;
  manager: string;
  developer: string;
  status: string;
  expertise: Expertise | null;
  cycles: number | null;
  pages: number | null;
}

/** Чего не хватило для полной оценки документа. */
export type MissingPart = 'registry' | 'journal' | 'cycles' | 'date';

/** Проектный документ: один журнал и сведения о нём из перечней. */
export interface ProjectDocument {
  /** Ключ документа: журнал, а для документа без журнала — проект, наименование и вид экспертизы. */
  key: string;
  project: string;
  name: string;
  /**
   * Точка отсчёта: дата первого замечания в журнале. Для документа без замечаний — дата перечня.
   * `null`, если дату определить не удалось.
   */
  startDate: string | null;
  /** Сведения из перечней от ранних к поздним; пусто, если документа нет ни в одном перечне. */
  passports: Passport[];
  journalPath: string | null;
  /** Уникальные замечания журнала. */
  remarks: Remark[];
  /** `false`, если журнал указан в перечне, но не найден: оценить документ нельзя. */
  evaluable: boolean;
}

/** Состояние документа на дату: учтены замечания, выданные не позже этой даты. */
export interface DocumentState {
  doc: ProjectDocument;
  /** Дата состояния; `null` — по всем имеющимся данным. */
  asOf: string | null;
  manager: string;
  developer: string;
  status: string;
  expertise: Expertise | null;
  /** Сколько уникальных замечаний выдано к этой дате (с любым статусом). */
  remarkCount: number;
  /** Фактические значения; `cycles: null` — число циклов не указано. */
  facts: { design: number; content: number; repeats: number; cycles: number | null } | null;
  /** `null`, если документ оценить нельзя (нет ЖУЗ). */
  score: DocScore | null;
  missing: MissingPart[];
}

export interface FileReport {
  path: string;
  kind: 'journal' | 'registry' | 'skipped';
  note: string;
}

export interface Evaluation {
  documents: ProjectDocument[];
  files: FileReport[];
  issues: Issue[];
}
