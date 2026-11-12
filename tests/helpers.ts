import type { Cell, SheetData } from '../src/core/types.ts';

/** Шапка журнала в том виде, в каком она встречается в шаблоне ЖУЗ. */
export const JOURNAL_HEADER: Cell[] = [
  'Проект', 'Номер замечания', 'Дата замечания', 'Организация автора замечания', 'Подразделение',
  'ФИО автора замечания', 'Документ', 'Раздел документа', 'Объект в составе документа', 'Контекст',
  'Состав замечания', 'Категория замечания', 'Статус замечания', 'Отработка замечания ',
  'Наименование файла и версия документа',
];

export const JOURNAL_GROUPS: Cell[] = [null, null, null, 'Автор замечания', null, null, 'Документ', null, null, 'Замечание'];

export const JOURNAL_HINTS: Cell[] = JOURNAL_HEADER.map(
  (title) => `${title}\n\nУстанавливается вручную - Обязательно для заполнения`,
);

export interface RemarkInput {
  project?: string | null;
  number?: number | null;
  date?: Cell;
  document?: string;
  text?: string;
  category?: string | null;
  status?: string | null;
  fileVersion?: string | null;
}

export function remarkRow(r: RemarkInput): Cell[] {
  return [
    r.project === undefined ? 'Проект Альфа' : r.project,
    r.number ?? 1,
    r.date ?? 46273,
    'ООО "Пример"',
    'Отдел экспертизы',
    'Иванов И.И.',
    r.document ?? 'Техническое задание',
    'Раздел 1',
    'Текст документа',
    null,
    r.text ?? `Текст замечания ${r.number ?? 1}`,
    r.category === undefined ? 'Уточнение / корректировка информации' : r.category,
    r.status === undefined ? 'Принято' : r.status,
    'Исправлено',
    r.fileVersion === undefined ? 'ТЗ v1.1' : r.fileVersion,
  ];
}

export function journalSheet(remarks: RemarkInput[], options: { hints?: boolean } = {}): SheetData {
  const rows: Cell[][] = [JOURNAL_GROUPS, JOURNAL_HEADER];
  if (options.hints) rows.push(JOURNAL_HINTS);
  remarks.forEach((r, i) => rows.push(remarkRow({ number: i + 1, ...r })));
  return { name: 'Шаблон ЖУЗ', rows };
}

/** Шапка расширенного Шаблона_1. */
export const REGISTRY_HEADER: Cell[] = [
  '№', 'Проект', 'РП', 'Отв. за разработку', 'Проектный документ', 'Статус документа',
  'СЭД «Tessa»/Оф. письма/ИС ПРИТ.ПСПД', 'Ссылка на папку ', 'Внутренеее согласование', 'Внешнее согласование',
  'Количество циклов согласования', 'Количество листов', 'Файл ЖУЗ',
];

export interface RegistryInput {
  project?: string;
  manager?: string;
  document: string;
  status?: string;
  internal?: Cell;
  external?: Cell;
  cycles?: Cell;
  pages?: Cell;
  journalFile?: Cell;
}

export function registrySheet(rows: RegistryInput[], period: Cell = 'Отчетный период: 3 квартал 2026'): SheetData {
  const body: Cell[][] = rows.map((r, i) => [
    i + 1, r.project ?? 'Проект Альфа', r.manager ?? 'Петров П.', 'Аналитик', r.document, r.status ?? 'Согласован',
    'СЭД', 'S:\\Папка', r.internal === undefined ? 'нет' : r.internal, r.external === undefined ? 'да' : r.external,
    r.cycles ?? null, r.pages ?? null, r.journalFile ?? null,
  ]);
  return { name: 'Лист1', rows: [[period], [], REGISTRY_HEADER, ...body] };
}
