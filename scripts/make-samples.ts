// Генерирует демонстрационную папку samples/demo с вымышленными данными:
// три загрузки в разные месяцы, в каждой расширенный Шаблон_1 и журналы учёта замечаний.
// Часть документов загружается повторно — на них видно отслеживание версий.
// Запуск: npm run samples
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { writeWorkbook, type WriteCell } from '../src/io/xlsx-write.ts';

const ROOT = 'samples/demo';

const JOURNAL_GROUPS: WriteCell[] = [null, null, null, 'Автор замечания', null, null, 'Документ', null, null, 'Замечание'];
const JOURNAL_HEADER: WriteCell[] = [
  'Проект', 'Номер замечания', 'Дата замечания', 'Организация автора замечания', 'Подразделение',
  'ФИО автора замечания', 'Документ', 'Раздел документа', 'Объект в составе документа', 'Контекст',
  'Состав замечания', 'Категория замечания', 'Статус замечания', 'Отработка замечания',
  'Наименование файла и версия документа',
];
const REGISTRY_HEADER: WriteCell[] = [
  '№', 'Проект', 'РП', 'Отв. за разработку', 'Проектный документ', 'Статус документа',
  'СЭД «Tessa»/Оф. письма/ИС ПРИТ.ПСПД', 'Ссылка на папку', 'Внутреннее согласование', 'Внешнее согласование',
  'Количество циклов согласования', 'Количество листов', 'Файл ЖУЗ',
];

const CATEGORY = {
  content: ['Уточнение / корректировка информации', ' - Дополнение текстового содержания документа;\n- Уточнение / корректировка информации', 'Уточнение в части требований к функциональности'],
  design: ['Корректировка оформления и структуры документа', 'Орфографические и грамматические ошибки'],
  repeats: ['Учет ранее выданных замечаний'],
  other: ['Организационные и процессные вопросы'],
};

interface Doc {
  project: string;
  manager: string;
  developer: string;
  name: string;
  /** Вид экспертизы: на каждую — своя строка перечня и свой журнал. */
  expertise: 'internal' | 'external';
  status: string;
  cycles: number | null;
  pages: number;
  /** Количество замечаний по видам; `null` — согласован без замечаний. */
  remarks: { content?: number; design?: number; repeats?: number; other?: number; rejected?: number } | null;
}

function write(path: string, sheets: { name: string; rows: WriteCell[][] }[]): void {
  const full = join(ROOT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, writeWorkbook(sheets));
}

function journalRows(doc: Doc, date: string): WriteCell[][] {
  const rows: WriteCell[][] = [JOURNAL_GROUPS, JOURNAL_HEADER];
  let number = 0;
  const add = (kind: keyof typeof CATEGORY, count: number, status = 'Принято') => {
    for (let i = 0; i < count; i++) {
      number += 1;
      const variants = CATEGORY[kind];
      rows.push([
        doc.project, number, date, 'ООО «Пример»', 'Отдел экспертизы', 'Иванов И.И.', doc.name,
        `Раздел ${1 + (number % 7)}`, 'Текст документа', null, `Пример замечания № ${number}`,
        variants[number % variants.length]!, status, status === 'Принято' ? 'Исправлено' : 'Замечание не подтвердилось',
        `${doc.name} v1.${1 + (number % 3)}`,
      ]);
    }
  };
  add('content', doc.remarks?.content ?? 0);
  add('design', doc.remarks?.design ?? 0);
  add('repeats', doc.remarks?.repeats ?? 0);
  add('other', doc.remarks?.other ?? 0);
  add('content', doc.remarks?.rejected ?? 0, 'Отклонено');
  return rows;
}

function upload(folder: string, label: string, date: string, docs: Doc[]): void {
  const rows: WriteCell[][] = [[`Отчетный период: ${label}`], [], REGISTRY_HEADER];
  docs.forEach((doc, index) => {
    const suffix = doc.expertise === 'internal' ? 'внутр' : 'внеш';
    const file = doc.remarks ? `ЖУЗ_${doc.project}_${doc.name}_${suffix}.xlsx`.replace(/[ «»]/g, '_') : 'Без замечаний';
    if (doc.remarks) write(join(folder, doc.project, file), [{ name: 'Шаблон ЖУЗ', rows: journalRows(doc, date) }]);
    rows.push([
      index + 1, doc.project, doc.manager, doc.developer, doc.name, doc.status, 'СЭД', `S:\\Проекты\\${doc.project}`,
      doc.expertise === 'internal' ? 'да' : 'нет', doc.expertise === 'external' ? 'да' : 'нет',
      doc.cycles, doc.pages, file,
    ]);
  });
  write(join(folder, 'Шаблон_1.xlsx'), [{ name: 'Лист1', rows }]);
}

const alpha = { project: 'Альфа', manager: 'Петров П.', developer: 'Аналитик' };
const beta = { project: 'Бета', manager: 'Сидорова А.', developer: 'Архитектор' };
const gamma = { project: 'Гамма', manager: 'Кузнецов Д.', developer: 'Аналитик' };
const internal = { expertise: 'internal' } as const;
const external = { expertise: 'external' } as const;

upload('2026-06 июнь', 'июнь 2026', '18.06.2026', [
  { ...alpha, ...external, name: 'Техническое задание', status: 'На согласовании', cycles: 2, pages: 40, remarks: { content: 14, design: 3 } },
  { ...alpha, ...internal, name: 'Проектное решение', status: 'На согласовании', cycles: 1, pages: 65, remarks: { content: 21, design: 6, repeats: 2 } },
  { ...beta, ...external, name: 'Программа и методика испытаний', status: 'Согласован', cycles: 1, pages: 25, remarks: null },
  { ...gamma, ...external, name: 'Матрица доступа', status: 'На согласовании', cycles: 3, pages: 12, remarks: { content: 30, design: 12, repeats: 4, rejected: 3 } },
]);

upload('2026-08 август', 'август 2026', '20.08.2026', [
  { ...alpha, ...internal, name: 'Проектное решение', status: 'На доработке', cycles: 2, pages: 65, remarks: { content: 13, design: 4, repeats: 1 } },
  { ...alpha, ...external, name: 'Проектное решение', status: 'На согласовании', cycles: 1, pages: 65, remarks: { content: 9, design: 2 } },
  { ...beta, ...external, name: 'Руководство пользователя', status: 'Согласован', cycles: 2, pages: 30, remarks: { content: 9, design: 5, other: 2 } },
  { ...gamma, ...external, name: 'Матрица доступа', status: 'На доработке', cycles: 5, pages: 12, remarks: { content: 22, design: 9, repeats: 3 } },
]);

upload('2026-09 сентябрь', 'сентябрь 2026', '22.09.2026', [
  { ...alpha, ...external, name: 'Техническое задание', status: 'Согласован', cycles: 3, pages: 40, remarks: { content: 8, design: 2 } },
  { ...alpha, ...internal, name: 'Проектное решение', status: 'Согласован', cycles: 3, pages: 65, remarks: { content: 6, design: 1 } },
  { ...alpha, ...external, name: 'Проектное решение', status: 'На доработке', cycles: 2, pages: 65, remarks: { content: 12, design: 3, repeats: 1 } },
  { ...beta, ...external, name: 'Протокол испытаний', status: 'Согласован', cycles: 1, pages: 8, remarks: null },
  { ...beta, ...internal, name: 'Регламент сопровождения', status: 'На согласовании', cycles: null, pages: 15, remarks: { content: 6, design: 1 } },
  { ...gamma, ...external, name: 'Матрица доступа', status: 'Согласован', cycles: 6, pages: 12, remarks: { content: 16, design: 7, repeats: 3 } },
  { ...gamma, ...external, name: 'Частное техническое задание', status: 'На согласовании', cycles: 2, pages: 28, remarks: { content: 12, design: 4, other: 1 } },
]);

console.log(`Демонстрационные данные записаны в ${ROOT}`);
