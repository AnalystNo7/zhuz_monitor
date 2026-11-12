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
    expect(journal.remarks[0]).toMatchObject({ row: 3, project: 'Проект Альфа', number: '1', date: '2026-09-08', status: 'accepted' });
    expect(journal.issues).toEqual([]);
  });

  it('пропускает строку-подсказку под шапкой и пустые строки', () => {
    const sheet = journalSheet([{}, {}], { hints: true });
    sheet.rows.push([], [null, null, null], remarkRow({ number: 3 }));
    const journal = parseJournal(sheet, 'ЖУЗ.xlsx', cfg)!;
    expect(journal.remarks).toHaveLength(3);
    expect(journal.remarks.map((r) => r.row)).toEqual([4, 5, 8]);
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

  it('учитывает только принятые замечания и сообщает о нераспознанных статусах', () => {
    const journal = parseJournal(
      journalSheet([
        { status: 'Принято' },
        { status: 'Согласовано с комментарием' },
        { status: 'Отклонено' },
        { status: 'На рассмотрении' },
        { status: null },
      ]),
      'ЖУЗ.xlsx',
      cfg,
    )!;
    expect(journal.remarks.map((r) => r.indicator)).toEqual(['content', 'content', null, null, null]);
    expect(journal.issues.map((i) => [i.level, i.row])).toEqual([['warning', 6], ['warning', 7]]);
    expect(journal.issues[0]!.message).toContain('На рассмотрении');
  });

  it('сообщает о пустой и незнакомой категории у принятого замечания', () => {
    const journal = parseJournal(journalSheet([{ category: null }, { category: 'Новая категория' }]), 'ЖУЗ.xlsx', cfg)!;
    expect(journal.remarks.map((r) => r.indicator)).toEqual([null, null]);
    expect(journal.issues).toHaveLength(2);
  });

  it('отмечает журнал с замечаниями к нескольким документам', () => {
    const journal = parseJournal(journalSheet([{ document: 'Документ А' }, { document: 'Документ Б' }]), 'ЖУЗ.xlsx', cfg)!;
    expect(journal.issues).toEqual([expect.objectContaining({ level: 'info' })]);
  });
});
