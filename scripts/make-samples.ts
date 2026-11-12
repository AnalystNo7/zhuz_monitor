// Генерирует демонстрационную папку samples/demo с вымышленными данными.
// В ней один журнал на документ; журналы пополнялись в разные месяцы, поэтому
// видна динамика. В папке «Архив» лежат более ранний перечень и старая копия
// одного из журналов — инструмент сам берёт актуальные.
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

/** Замечания, пришедшие в журнал одной датой. */
interface Wave {
  date: string;
  content?: number;
  design?: number;
  repeats?: number;
  other?: number;
  /** Отклонённые замечания. */
  rejected?: number;
  /** Замечания со статусом «Новое». */
  pending?: number;
  /** Принятые замечания без категории. */
  uncategorized?: number;
}

interface Doc {
  project: string;
  manager: string;
  developer: string;
  name: string;
  expertise: 'internal' | 'external';
  /** `null` — согласован без замечаний, журнала нет. */
  waves: Wave[] | null;
}

function write(path: string, sheets: { name: string; rows: WriteCell[][] }[]): void {
  const full = join(ROOT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, writeWorkbook(sheets));
}

function journalFile(doc: Doc): string {
  return `ЖУЗ_${doc.project}_${doc.name}.xlsx`.replace(/ /g, '_');
}

function journalRows(doc: Doc, waves: Wave[]): WriteCell[][] {
  const rows: WriteCell[][] = [JOURNAL_GROUPS, JOURNAL_HEADER];
  let number = 0;
  waves.forEach((wave, version) => {
    const add = (count: number | undefined, category: (n: number) => string | null, status = 'Принято') => {
      for (let i = 0; i < (count ?? 0); i++) {
        number += 1;
        rows.push([
          doc.project, number, wave.date, 'ООО «Пример»', 'Отдел экспертизы', 'Иванов И.И.', doc.name,
          `Раздел ${1 + (number % 7)}`, 'Текст документа', null, `Пример замечания № ${number}`, category(number), status,
          status === 'Принято' ? 'Исправлено' : status === 'Отклонено' ? 'Замечание не подтвердилось' : null,
          `${doc.name} v1.${version + 1}`,
        ]);
      }
    };
    const pick = (kind: keyof typeof CATEGORY) => (n: number) => CATEGORY[kind][n % CATEGORY[kind].length]!;
    add(wave.content, pick('content'));
    add(wave.design, pick('design'));
    add(wave.repeats, pick('repeats'));
    add(wave.other, pick('other'));
    add(wave.uncategorized, () => null);
    add(wave.rejected, pick('content'), 'Отклонено');
    add(wave.pending, pick('content'), 'Новое');
  });
  return rows;
}

interface RegistryEntry {
  doc: Doc;
  status: string;
  cycles: number | null;
  pages: number;
}

function registry(path: string, caption: string, entries: RegistryEntry[]): void {
  const rows: WriteCell[][] = [[caption], [], REGISTRY_HEADER];
  entries.forEach(({ doc, status, cycles, pages }, index) => {
    rows.push([
      index + 1, doc.project, doc.manager, doc.developer, doc.name, status, 'СЭД', `S:\\Проекты\\${doc.project}`,
      doc.expertise === 'internal' ? 'да' : 'нет', doc.expertise === 'external' ? 'да' : 'нет',
      cycles, pages, doc.waves ? journalFile(doc) : 'Без замечаний',
    ]);
  });
  write(path, [{ name: 'Лист1', rows }]);
}

const alpha = { project: 'Альфа', manager: 'Петров П.', developer: 'Аналитик' };
const beta = { project: 'Бета', manager: 'Сидорова А.', developer: 'Архитектор' };
const gamma = { project: 'Гамма', manager: 'Кузнецов Д.', developer: 'Аналитик' };

const spec: Doc = {
  ...alpha, name: 'Техническое задание', expertise: 'external',
  waves: [{ date: '12.05.2026', content: 8, design: 2 }, { date: '20.07.2026', content: 4, design: 1 }],
};
const solution: Doc = {
  ...alpha, name: 'Проектное решение', expertise: 'internal',
  waves: [{ date: '18.06.2026', content: 13, design: 4 }, { date: '22.09.2026', content: 8, design: 2, repeats: 2 }],
};
const adminGuide: Doc = { ...alpha, name: 'Руководство администратора', expertise: 'external', waves: null };
const testProgram: Doc = { ...beta, name: 'Программа и методика испытаний', expertise: 'external', waves: null };
const userGuide: Doc = {
  ...beta, name: 'Руководство пользователя', expertise: 'external',
  waves: [{ date: '20.08.2026', content: 9, design: 5, other: 2 }],
};
const regulation: Doc = {
  ...beta, name: 'Регламент сопровождения', expertise: 'internal',
  waves: [{ date: '22.09.2026', content: 4, design: 1, uncategorized: 2 }],
};
const accessMatrix: Doc = {
  ...gamma, name: 'Матрица доступа', expertise: 'external',
  waves: [
    { date: '18.06.2026', content: 14, design: 6, repeats: 1, rejected: 3 },
    { date: '20.08.2026', content: 8, design: 3, repeats: 2 },
    { date: '22.09.2026', content: 4, repeats: 1, pending: 2 },
  ],
};
const privateSpec: Doc = {
  ...gamma, name: 'Частное техническое задание', expertise: 'external',
  waves: [{ date: '22.09.2026', content: 12, design: 4, other: 1 }],
};

// Актуальные журналы: по одному на документ.
for (const doc of [spec, solution, userGuide, regulation, accessMatrix, privateSpec]) {
  write(join(doc.project, journalFile(doc)), [{ name: 'Шаблон ЖУЗ', rows: journalRows(doc, doc.waves!) }]);
}
// Старая копия журнала: только первые замечания. Инструмент её распознаёт и не учитывает.
write(join('Архив', journalFile(accessMatrix)), [{ name: 'Шаблон ЖУЗ', rows: journalRows(accessMatrix, accessMatrix.waves!.slice(0, 1)) }]);

registry('Перечень документов.xlsx', 'Данные на 30.09.2026', [
  { doc: spec, status: 'Согласован', cycles: 3, pages: 40 },
  { doc: solution, status: 'На доработке', cycles: 2, pages: 65 },
  { doc: adminGuide, status: 'Согласован', cycles: 1, pages: 20 },
  { doc: testProgram, status: 'Согласован', cycles: 1, pages: 25 },
  { doc: userGuide, status: 'Согласован', cycles: 2, pages: 30 },
  { doc: regulation, status: 'На согласовании', cycles: null, pages: 15 },
  { doc: accessMatrix, status: 'На доработке', cycles: 5, pages: 12 },
  { doc: privateSpec, status: 'На согласовании', cycles: 2, pages: 28 },
]);
// Более ранний перечень: по нему видно, как менялись статус и число циклов.
registry('Архив/Перечень документов (июнь).xlsx', 'Данные на 30.06.2026', [
  { doc: spec, status: 'На согласовании', cycles: 1, pages: 40 },
  { doc: solution, status: 'На согласовании', cycles: 1, pages: 65 },
  { doc: testProgram, status: 'Согласован', cycles: 1, pages: 25 },
  { doc: accessMatrix, status: 'На согласовании', cycles: 2, pages: 12 },
]);

console.log(`Демонстрационные данные записаны в ${ROOT}`);
