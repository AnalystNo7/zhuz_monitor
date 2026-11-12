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
  /** Принятое замечание без распознанной категории: из-за него журнал не рассчитывается. */
  uncategorized: boolean;
  /** Номер цикла согласования, к которому относится замечание (с 1). */
  cycle: number;
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
  /** Число циклов согласования по журналу. */
  cycles: number;
  /** Как определены циклы: по строкам «Цикл согласования N» или по датам и версиям файла. */
  cycleSource: 'markers' | 'dates';
  /** Строки принятых замечаний без распознанной категории. Если они есть, журнал не рассчитывается. */
  uncategorizedRows: number[];
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

/** Назначение руководителя проекту, заданное вручную. */
export interface ManagerAssignment {
  project: string;
  manager: string;
}

/** Назначения РП по ключу проекта (`norm(project)`). */
export type ManagerAssignments = Map<string, ManagerAssignment>;

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
  cycles: number | null;
  pages: number | null;
}

/**
 * Почему документ не рассчитан или рассчитан не полностью:
 * `journal` — журнал не найден; `categories` — у принятых замечаний нет категории;
 * `date` — дату начала определить не удалось.
 */
export type MissingPart = 'journal' | 'categories' | 'date';

/** Проектный документ: один журнал и сведения о нём из перечней. */
export interface ProjectDocument {
  /** Ключ документа: журнал, а для документа без журнала — связка «проект — документ». */
  key: string;
  project: string;
  name: string;
  /** РП из перечня документов; назначение вручную подставляется отдельно. */
  manager: string;
  /** Откуда взят РП. */
  managerSource: 'form' | 'registry' | null;
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
  /** Журнал указан в перечне, но не найден: оценить документ нельзя. */
  journalMissing: boolean;
  /** Строки принятых замечаний без категории: пока они есть, документ не рассчитывается. */
  uncategorizedRows: number[];
}

/** Состояние документа на дату: учтены замечания, выданные не позже этой даты. */
export interface DocumentState {
  doc: ProjectDocument;
  /** Дата состояния; `null` — по всем имеющимся данным. */
  asOf: string | null;
  manager: string;
  developer: string;
  status: string;
  /** Сколько уникальных замечаний выдано к этой дате (с любым статусом). */
  remarkCount: number;
  /** Откуда взято число циклов: из перечня или оценено по журналу. */
  cyclesSource: 'registry' | 'journal';
  /** Фактические значения показателей; `null`, если документ не рассчитан. */
  facts: { design: number; content: number; repeats: number; cycles: number } | null;
  /** `null`, если документ не рассчитан (см. `missing`). */
  score: DocScore | null;
  missing: MissingPart[];
}

export interface FileReport {
  path: string;
  kind: 'journal' | 'registry' | 'managers' | 'skipped';
  note: string;
}

export interface Evaluation {
  documents: ProjectDocument[];
  /** Назначения РП из файла в папке. */
  managers: ManagerAssignments;
  /** Путь к файлу с назначениями РП, если он есть в папке. */
  managersPath: string | null;
  files: FileReport[];
  issues: Issue[];
}
