import { describe, expect, it } from 'vitest';
import { parseRegistry } from '../src/core/registry.ts';
import { REGISTRY_HEADER, journalSheet, registrySheet } from './helpers.ts';

describe('разбор перечня документов (расширенный Шаблон_1)', () => {
  it('читает строки, период и новые колонки', () => {
    const parsed = parseRegistry(
      registrySheet([
        { document: 'Техническое задание', cycles: 2, pages: 35, journalFile: 'ЖУЗ_ТЗ.xlsx' },
        { document: 'Руководство пользователя', cycles: '1', journalFile: 'Без замечаний' },
      ]),
      'Шаблон_1.xlsx',
    );
    if (parsed.kind !== 'registry') throw new Error('ожидался перечень документов');
    const { registry } = parsed;
    expect(registry.period?.key).toBe('2026-Q3');
    expect(registry.rows).toHaveLength(2);
    expect(registry.rows[0]).toMatchObject({
      row: 4, project: 'Проект Альфа', manager: 'Петров П.', document: 'Техническое задание',
      internal: false, external: true, cycles: 2, pages: 35, journalFile: 'ЖУЗ_ТЗ.xlsx',
    });
    expect(registry.rows[1]).toMatchObject({ cycles: 1, pages: null });
    expect(registry.issues).toEqual([]);
  });

  it('берёт период из соседней ячейки', () => {
    const sheet = registrySheet([{ document: 'ТЗ', journalFile: 'ЖУЗ.xlsx' }]);
    sheet.rows[0] = ['Отчетный период:', null, 'IV кв. 2026'];
    const parsed = parseRegistry(sheet, 'Шаблон_1.xlsx');
    expect(parsed.kind === 'registry' && parsed.registry.period?.key).toBe('2026-Q4');
  });

  it('предупреждает, если период не указан', () => {
    const parsed = parseRegistry(registrySheet([{ document: 'ТЗ', journalFile: 'ЖУЗ.xlsx' }], 'Отчетный период:'), 'Шаблон_1.xlsx');
    if (parsed.kind !== 'registry') throw new Error('ожидался перечень документов');
    expect(parsed.registry.period).toBeNull();
    expect(parsed.registry.issues).toHaveLength(1);
  });

  it('предупреждает о нечисловом количестве циклов', () => {
    const parsed = parseRegistry(registrySheet([{ document: 'ТЗ', cycles: 'два', journalFile: 'ЖУЗ.xlsx' }]), 'Шаблон_1.xlsx');
    if (parsed.kind !== 'registry') throw new Error('ожидался перечень документов');
    expect(parsed.registry.rows[0]!.cycles).toBeNull();
    expect(parsed.registry.issues[0]).toMatchObject({ level: 'warning', row: 4 });
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
