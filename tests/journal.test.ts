import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG as cfg } from '../src/core/config.ts';
import { parseJournal } from '../src/core/journal.ts';
import type { Cell } from '../src/core/types.ts';
import { JOURNAL_HEADER, journalSheet, remarkRow } from './helpers.ts';

describe('разбор журнала учёта замечаний', () => {
  it('лист без шапки ЖУЗ не считается журналом', () => {
    expect(parseJournal({ name: 'Лист1', rows: [['Проект', 'РП'], ['Альфа', 'Петров']] }, 'a.xlsx', cfg)).toBeNull();
    expect(parseJournal({ name: 'Пусто', rows: [] }, 'a.xlsx', cfg)).toBeNull();
  });

  it('читает замечания и определяет показатель', () => {
    const journal = parseJournal(
      journalSheet([
        { category: 'Уточнение / корректировка информации' },
        { category: 'Орфографические и грамматические ошибки' },
        { category: 'Учет ранее выданных замечаний' },
        { category: 'Организационные и процессные вопросы' },
      ]),
      'ЖУЗ.xlsx',
      cfg,
    )!;
    expect(journal.remarks.map((r) => r.indicator)).toEqual(['content', 'design', 'repeats', null]);
    expect(journal.remarks[0]).toMatchObject({
      row: 3, project: 'Проект Альфа', number: '1', date: '2026-09-08', status: 'accepted', uncategorized: false, copies: 1,
    });
    expect(journal).toMatchObject({ project: 'Проект Альфа', document: 'Техническое задание', rowCount: 4 });
    expect(journal.issues).toEqual([]);
  });

  it('пропускает подсказку под шапкой, пустые строки и строки-разделители', () => {
    const sheet = journalSheet([{}, {}], { hints: true });
    sheet.rows.push([], [null, null, null], ['Цикл согласования 2'], remarkRow({ number: 3 }));
    const journal = parseJournal(sheet, 'ЖУЗ.xlsx', cfg)!;
    expect(journal.remarks.map((r) => r.row)).toEqual([4, 5, 9]);
  });

  it('находит колонки по названиям при другом порядке и лишних колонках', () => {
    const order = [12, 0, 11, 10, 6, 2, 1];
    const reorder = (row: Cell[]): Cell[] => ['лишняя', ...order.map((i) => row[i] ?? null)];
    const journal = parseJournal(
      { name: 'ЖУЗ', rows: [reorder(JOURNAL_HEADER), reorder(remarkRow({ text: 'Опечатка', category: 'Орфографические и грамматические ошибки' }))] },
      'ЖУЗ.xlsx',
      cfg,
    )!;
    expect(journal.remarks[0]).toMatchObject({ text: 'Опечатка', indicator: 'design', document: 'Техническое задание' });
  });

  it('подставляет проект из предыдущей строки, если ячейка пустая', () => {
    const journal = parseJournal(journalSheet([{ project: 'Проект Бета' }, { project: null }]), 'ЖУЗ.xlsx', cfg)!;
    expect(journal.remarks.map((r) => r.project)).toEqual(['Проект Бета', 'Проект Бета']);
  });

  it('проект и документ журнала берутся из первого замечания', () => {
    const journal = parseJournal(
      journalSheet([{ document: 'ПР СЗИ_v1.2.4' }, { document: 'ПР СЗИ_v1.4.2' }, { document: 'ПР СЗИ_v1.4.2' }]),
      'ЖУЗ.xlsx',
      cfg,
    )!;
    expect(journal.document).toBe('ПР СЗИ_v1.2.4');
    expect(journal.issues).toEqual([expect.objectContaining({ level: 'info' })]);
  });

  it('учитывает только принятые замечания', () => {
    const journal = parseJournal(
      journalSheet([
        { status: 'Принято' },
        { status: 'принято ' },
        { status: 'Согласовано с комментарием' },
        { status: 'Отклонено' },
        { status: 'Новое' },
        { status: 'Снято' },
        { status: 'Снято' },
        { status: null },
      ]),
      'ЖУЗ.xlsx',
      cfg,
    )!;
    expect(journal.remarks.map((r) => r.status)).toEqual(['accepted', 'accepted', 'accepted', 'rejected', 'pending', 'unknown', 'unknown', 'empty']);
    expect(journal.remarks.map((r) => r.indicator)).toEqual(['content', 'content', 'content', null, null, null, null, null]);
    // Сообщения сгруппированы: по одному на каждый вид проблемы, с номерами строк.
    expect(journal.issues.map((i) => [i.level, i.message])).toEqual([
      ['warning', 'Статус «Снято» отсутствует в справочнике — замечания не учтены. Строки: 8, 9.'],
      ['warning', 'Статус замечания не указан — замечания не учтены. Строки: 10.'],
      ['info', 'Замечаний, по которым решение ещё не принято: 1. В расчёт они не входят.'],
    ]);
  });

  it('принятое замечание без категории блокирует расчёт журнала', () => {
    const journal = parseJournal(
      journalSheet([{ category: null }, { category: 'Новая категория' }, { category: 'Прочее' }, { category: null, status: 'Отклонено' }]),
      'ЖУЗ.xlsx',
      cfg,
    )!;
    expect(journal.remarks.map((r) => [r.indicator, r.uncategorized])).toEqual([
      [null, true],
      [null, true],
      [null, false],
      [null, false],
    ]);
    // Отклонённое замечание без категории на расчёт не влияет и расчёт не блокирует.
    expect(journal.uncategorizedRows).toEqual([3, 4]);
    expect(journal.issues.map((i) => [i.level, i.message])).toEqual([
      ['error', 'ЖУЗ не рассчитан: у принятых замечаний не указана категория или её нет в справочнике. Укажите категорию и обновите данные. Строки: 3, 4.'],
      ['warning', 'Категория «новая категория» отсутствует в справочнике. Строки: 4.'],
    ]);
  });

  it('частично распознанная категория не блокирует расчёт', () => {
    const journal = parseJournal(journalSheet([{ category: 'Уточнение / корректировка информации; Совсем новое' }]), 'ЖУЗ.xlsx', cfg)!;
    expect(journal.remarks[0]).toMatchObject({ indicator: 'content', uncategorized: false });
    expect(journal.uncategorizedRows).toEqual([]);
    expect(journal.issues.map((i) => i.level)).toEqual(['warning']);
  });

  it('повторяющиеся по тексту замечания считаются один раз', () => {
    const journal = parseJournal(
      journalSheet([
        { text: 'Нумерация таблиц начинается с 2', category: null, status: 'Отклонено', date: '11.09.2026' },
        { text: 'Нет определения ДО' },
        { text: ' нумерация таблиц  начинается с 2 ', category: 'Корректировка оформления и структуры документа', date: '14.08.2026' },
      ]),
      'ЖУЗ.xlsx',
      cfg,
    )!;
    expect(journal.rowCount).toBe(3);
    expect(journal.remarks).toHaveLength(2);
    // Объединённое замечание принято, если принята хотя бы одна из строк; дата — самая ранняя.
    expect(journal.remarks[0]).toMatchObject({ copies: 2, status: 'accepted', indicator: 'design', uncategorized: false, date: '2026-08-14' });
    expect(journal.uncategorizedRows).toEqual([]);
    expect(journal.issues).toEqual([expect.objectContaining({ level: 'info', message: expect.stringContaining('уникальных замечаний 2') })]);

    const separate = parseJournal(journalSheet([{ text: 'Одно и то же' }, { text: 'Одно и то же' }]), 'ЖУЗ.xlsx', { ...cfg, mergeDuplicateRemarks: false })!;
    expect(separate.remarks).toHaveLength(2);
  });

  it('предупреждает о замечаниях без даты', () => {
    const journal = parseJournal(journalSheet([{}, { date: 'не помню' }]), 'ЖУЗ.xlsx', cfg)!;
    expect(journal.remarks.map((r) => r.date)).toEqual(['2026-09-08', null]);
    expect(journal.issues).toEqual([expect.objectContaining({ level: 'warning', message: expect.stringContaining('не указана дата') })]);
  });
});

describe('циклы согласования по журналу', () => {
  const cycles = (remarks: Parameters<typeof journalSheet>[0]) => {
    const journal = parseJournal(journalSheet(remarks), 'ЖУЗ.xlsx', cfg)!;
    return { total: journal.cycles, source: journal.cycleSource, byRemark: journal.remarks.map((r) => r.cycle) };
  };

  it('замечания одной волны — один цикл', () => {
    expect(cycles([{ date: '08.09.2026' }, { date: '14.09.2026' }])).toEqual({ total: 1, source: 'dates', byRemark: [1, 1] });
  });

  it('новый цикл: перерыв больше 7 дней и новая версия файла', () => {
    // Как в ЖУЗ ПМИ: замечания к версии 1.0 и через 8 дней — к версии 1.1.
    const remarks = [
      { date: '14.09.2026', fileVersion: 'ПМИ 1.0' },
      { date: '17.09.2026', fileVersion: 'ПМИ 1.0' },
      { date: '25.09.2026', fileVersion: 'ПМИ 1.1' },
    ];
    expect(cycles(remarks)).toMatchObject({ total: 2, byRemark: [1, 1, 2] });
  });

  it('перерыв без смены версии файла — тот же цикл', () => {
    // Как в ЖУЗ ПР СЗИ: две даты с разницей 9 дней к одной версии, затем новая версия.
    const remarks = [
      { date: '13.04.2026', fileVersion: 'ПР_v1.4.1' },
      { date: '22.04.2026', fileVersion: 'ПР_v1.4.1.docx' },
      { date: '04.09.2026', fileVersion: 'ПР_v1.5.2' },
    ];
    expect(cycles(remarks)).toMatchObject({ total: 2, byRemark: [1, 1, 2] });
  });

  it('без версии файла решает перерыв в датах', () => {
    expect(cycles([{ date: '16.01.2026', fileVersion: null }, { date: '14.08.2026', fileVersion: 'МД.docx' }])).toMatchObject({ total: 2 });
    expect(cycles([{ date: '01.03.2026', fileVersion: null }, { date: '20.03.2026', fileVersion: null }])).toMatchObject({ total: 2 });
  });

  it('отклонённые замечания тоже отмечают цикл, замечание без даты — первый цикл', () => {
    const remarks = [
      { date: '01.03.2026', fileVersion: 'v1' },
      { date: '01.06.2026', fileVersion: 'v2', status: 'Отклонено' },
      { date: 'нет', fileVersion: 'v1' },
    ];
    expect(cycles(remarks)).toMatchObject({
      total: 2,
      byRemark: [1, 2, 1],
    });
  });

  it('строки «Цикл согласования N» важнее дат', () => {
    const sheet = journalSheet([]);
    sheet.rows.push(['Цикл согласования 1'], remarkRow({ number: 1, date: '01.03.2026' }), remarkRow({ number: 2, date: '01.06.2026' }));
    sheet.rows.push(['Цикл согласования № 2'], remarkRow({ number: 3, date: '02.06.2026' }));
    const journal = parseJournal(sheet, 'ЖУЗ.xlsx', cfg)!;
    expect(journal.cycleSource).toBe('markers');
    expect(journal.remarks.map((r) => r.cycle)).toEqual([1, 1, 2]);
    expect(journal.cycles).toBe(2);
  });

  it('одна строка «Цикл согласования 1» не мешает считать циклы по датам', () => {
    const sheet = journalSheet([]);
    sheet.rows.push(
      ['Цикл согласования 1 '],
      remarkRow({ number: 1, date: '15.05.2026', fileVersion: 'ПР_28.04' }),
      remarkRow({ number: 2, date: '21.09.2026', fileVersion: 'ПР_18.09.26' }),
    );
    const journal = parseJournal(sheet, 'ЖУЗ.xlsx', cfg)!;
    expect(journal).toMatchObject({ cycleSource: 'dates', cycles: 2 });
  });
});

describe('протянутые ячейки', () => {
  const warnings = (remarks: Parameters<typeof journalSheet>[0]) =>
    parseJournal(journalSheet(remarks), 'ЖУЗ.xlsx', cfg)!.issues.filter((i) => i.level === 'warning').map((i) => i.message);

  it('даты, растущие на день в каждой строке, вызывают предупреждение', () => {
    // Как в ЖУЗ ПР по функциональности: 21.09, затем 22.09 … 02.10 по одной строке.
    const days = ['21.09.2026', '21.09.2026', '22.09.2026', '23.09.2026', '24.09.2026', '25.09.2026', '26.09.2026', '27.09.2026', '28.09.2026', '29.09.2026', '30.09.2026', '01.10.2026', '02.10.2026'];
    expect(warnings(days.map((date) => ({ date })))).toEqual([
      'Даты замечаний в строках 4–15 растут ровно на день в каждой строке (21.09.2026 … 02.10.2026). ' +
        'Похоже на протягивание ячейки в Excel — проверьте даты: от них зависят динамика и число циклов.',
    ]);
  });

  it('короткая цепочка и одинаковые даты — не протягивание', () => {
    expect(warnings(['01.09.2026', '02.09.2026', '03.09.2026', '04.09.2026'].map((date) => ({ date })))).toEqual([]);
    expect(warnings(Array.from({ length: 10 }, () => ({ date: '01.09.2026' })))).toEqual([]);
    expect(warnings(['01.09.2026', '02.09.2026', '04.09.2026', '05.09.2026', '06.09.2026', '07.09.2026'].map((date) => ({ date })))).toEqual([]);
  });

  it('версия файла с числом, растущим на единицу, вызывает предупреждение', () => {
    const versions = ['ПР _28.04', 'ПР _28.04', 'ПР _28.05', 'ПР _28.06', 'ПР _28.07', 'ПР _28.08', 'ПР _18.09.26'];
    expect(warnings(versions.map((fileVersion) => ({ fileVersion })))).toEqual([
      'Версия файла в строках 4–8 отличается только числом, растущим на единицу («ПР _28.04» … «ПР _28.08»). ' +
        'Похоже на протягивание ячейки в Excel — проверьте версии: по ним определяются циклы.',
    ]);
  });
});
