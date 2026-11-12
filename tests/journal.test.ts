import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG as cfg, type Config } from '../src/core/config.ts';
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

  it('принятое замечание без категории относится к содержанию и помечается', () => {
    const journal = parseJournal(
      journalSheet([{ category: null }, { category: 'Новая категория' }, { category: 'Прочее' }, { category: null, status: 'Отклонено' }]),
      'ЖУЗ.xlsx',
      cfg,
    )!;
    expect(journal.remarks.map((r) => [r.indicator, r.uncategorized])).toEqual([
      ['content', true],
      ['content', true],
      [null, false],
      [null, false],
    ]);
    expect(journal.issues.map((i) => i.message)).toEqual([
      'У принятых замечаний не указана категория — учтены как «содержание». Строки: 3.',
      'Категория «новая категория» отсутствует в справочнике. Строки: 4.',
    ]);
  });

  it('замечания без категории можно не учитывать — настройкой', () => {
    const strict: Config = { ...cfg, uncategorizedIndicator: null };
    const journal = parseJournal(journalSheet([{ category: null }]), 'ЖУЗ.xlsx', strict)!;
    expect(journal.remarks[0]).toMatchObject({ indicator: null, uncategorized: true });
    expect(journal.issues[0]!.message).toContain('не учтены');
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
