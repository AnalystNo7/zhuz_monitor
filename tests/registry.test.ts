import { describe, expect, it } from 'vitest';
import { parseRegistry } from '../src/core/registry.ts';
import type { Registry, SheetData } from '../src/core/types.ts';
import { REGISTRY_HEADER, journalSheet, registrySheet } from './helpers.ts';

function registry(sheet: SheetData): Registry {
  const parsed = parseRegistry(sheet, 'Шаблон_1.xlsx');
  if (parsed.kind !== 'registry') throw new Error('ожидался перечень документов');
  return parsed.registry;
}

describe('разбор перечня документов (расширенный Шаблон_1)', () => {
  it('читает строки, дату перечня и новые колонки', () => {
    const result = registry(
      registrySheet([
        { document: 'Техническое задание', cycles: 2, pages: 35, journalFile: 'ЖУЗ_ТЗ.xlsx' },
        { document: 'Руководство пользователя', cycles: '1', journalFile: 'Без замечаний' },
      ]),
    );
    expect(result.asOf).toBe('2026-09-30');
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      row: 4, project: 'Проект Альфа', manager: 'Петров П.', document: 'Техническое задание', status: 'Согласован',
      internal: false, external: true, cycles: 2, pages: 35, journalFile: 'ЖУЗ_ТЗ.xlsx',
    });
    expect(result.rows[1]).toMatchObject({ cycles: 1, pages: null });
    expect(result.issues).toEqual([]);
  });

  it.each([
    ['Отчетный период: сентябрь 2026', '2026-09-30'],
    ['Отчётный период 05.10.2026', '2026-10-05'],
    ['Данные на 05.10.2026', '2026-10-05'],
    ['Отчетный период:', null],
  ])('дата из подписи «%s»', (label, expected) => {
    expect(registry(registrySheet([{ document: 'ТЗ', journalFile: 'ЖУЗ.xlsx' }], label)).asOf).toBe(expected);
  });

  it('берёт дату из соседней ячейки', () => {
    const sheet = registrySheet([{ document: 'ТЗ', journalFile: 'ЖУЗ.xlsx' }]);
    sheet.rows[0] = ['Отчетный период:', null, 'IV кв. 2026'];
    expect(registry(sheet).asOf).toBe('2026-12-31');
    sheet.rows[0] = ['Отчетный период:', 46273];
    expect(registry(sheet).asOf).toBe('2026-09-08');
  });

  it('отметки внутреннего и внешнего согласования читаются как есть', () => {
    const result = registry(
      registrySheet([
        { document: 'А', internal: 'да', external: 'нет', journalFile: 'а' },
        { document: 'Б', internal: 'Да', external: 'Да', journalFile: 'б' },
        { document: 'В', internal: null, external: null, journalFile: 'в' },
      ]),
    );
    expect(result.rows.map((r) => [r.internal, r.external])).toEqual([[true, false], [true, true], [null, null]]);
    expect(result.issues).toEqual([]);
  });

  it('предупреждает о нечисловом количестве циклов', () => {
    const result = registry(registrySheet([{ document: 'ТЗ', cycles: 'два', journalFile: 'ЖУЗ.xlsx' }]));
    expect(result.rows[0]!.cycles).toBeNull();
    expect(result.issues[0]).toMatchObject({ level: 'warning', row: 4 });
  });

  it('исходный Шаблон_1 без колонки «Файл ЖУЗ» распознаётся как неполный', () => {
    const sheet = { name: 'Лист1', rows: [['Отчетный период:'], [], REGISTRY_HEADER.slice(0, 10), [1, 'Альфа', 'Петров П.', '', 'ТЗ']] };
    expect(parseRegistry(sheet, 'Шаблон_1.xlsx').kind).toBe('incomplete');
  });

  it('журнал и посторонние листы перечнем не считаются', () => {
    expect(parseRegistry(journalSheet([{}]), 'ЖУЗ.xlsx').kind).toBe('none');
    expect(parseRegistry({ name: 'Лист2', rows: [['что-то']] }, 'x.xlsx').kind).toBe('none');
  });
});
