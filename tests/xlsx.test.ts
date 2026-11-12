import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG as cfg } from '../src/core/config.ts';
import { parseJournal } from '../src/core/journal.ts';
import { writeWorkbook } from '../src/io/xlsx-write.ts';
import { readWorkbook } from '../src/io/xlsx.ts';

// Книга создана сторонней библиотекой (openpyxl): общие строки, даты, форматированный текст.
const fixture = new Uint8Array(readFileSync(new URL('./fixtures/journal.xlsx', import.meta.url)));

describe('чтение xlsx', () => {
  const sheets = readWorkbook(fixture);

  it('возвращает листы в порядке вкладок', () => {
    expect(sheets.map((s) => s.name)).toEqual(['Шаблон ЖУЗ', 'Пустой', 'Справочник']);
    expect(sheets[1]!.rows).toEqual([]);
    expect(sheets[2]!.rows).toEqual([[], [null, 'Значение']]);
  });

  it('читает строки, числа, даты и логические значения', () => {
    const rows = sheets[0]!.rows;
    expect(rows[1]![0]).toBe('Проект');
    expect(rows[1]![14]).toBe('Наименование файла и версия документа');
    expect(rows[2]!.slice(0, 4)).toEqual(['Проект Альфа', 1, 46232, 'ООО "Пример & Ко"']);
    expect(rows[2]![4]).toBe('Отдел <экспертизы>');
    expect(rows[2]![7]).toBe('3 Раздел\nРоли участников');
    expect(rows[3]![0]).toBeNull();
    expect(rows[4]![2]).toBe('14.09.2026');
    expect(rows[5]![10]).toBe('Обычный текст, полужирный и снова обычный');
    expect(rows[6]).toEqual([]);
    expect(rows[7]![15]).toBe(12.5);
    expect(rows[7]![16]).toBe(true);
  });

  it('прочитанный лист разбирается как журнал', () => {
    const journal = parseJournal(sheets[0]!, 'journal.xlsx', cfg)!;
    expect(journal.remarks.map((r) => [r.date, r.status, r.indicator])).toEqual([
      ['2026-07-29', 'accepted', 'content'],
      ['2026-09-08', 'rejected', null],
      ['2026-09-14', 'accepted', 'repeats'],
      [null, 'accepted', null],
    ]);
    expect(journal.remarks[1]!.project).toBe('Проект Альфа');
  });

  it('отказывается читать файл, не являющийся книгой', () => {
    expect(() => readWorkbook(new Uint8Array([1, 2, 3, 4]))).toThrow(/не читается/);
  });
});

describe('запись xlsx', () => {
  it('записанная книга читается обратно без потерь', () => {
    const rows = [
      ['Текст с <тегами> & "кавычками"', 42, 3.14, true, null, 'перенос\nстроки'],
      [],
      [null, null, 'в третьей колонке'],
    ];
    const sheets = readWorkbook(writeWorkbook([{ name: 'Данные', rows }, { name: 'Второй/лист', rows: [['x']] }]));
    expect(sheets.map((s) => s.name)).toEqual(['Данные', 'Второй лист']);
    expect(sheets[0]!.rows).toEqual([
      ['Текст с <тегами> & "кавычками"', 42, 3.14, true, null, 'перенос\nстроки'],
      [],
      [null, null, 'в третьей колонке'],
    ]);
  });
});
