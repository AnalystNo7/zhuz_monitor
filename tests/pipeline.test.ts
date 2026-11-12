import { describe, expect, it } from 'vitest';
import { byManager, summarize } from '../src/core/aggregate.ts';
import { evaluate } from '../src/core/pipeline.ts';
import { journalSheet, registrySheet, type RemarkInput } from './helpers.ts';

const content = (n: number): RemarkInput[] => Array.from({ length: n }, () => ({}));

describe('расчёт по папке', () => {
  it('связывает перечень с журналами по имени файла и считает ИИКД', () => {
    const result = evaluate([
      {
        path: '2026-Q3/Шаблон_1.xlsx',
        sheets: [registrySheet([
          { document: 'Техническое задание', cycles: 4, journalFile: 'ЖУЗ_ТЗ.xlsx' },
          { document: 'Руководство пользователя', cycles: 1, journalFile: 'без замечаний' },
        ])],
      },
      {
        path: '2026-Q3/ЖУЗ_ТЗ.xlsx',
        sheets: [journalSheet([
          ...content(15),
          ...Array.from({ length: 6 }, () => ({ category: 'Корректировка оформления и структуры документа' })),
          { category: 'Учет ранее выданных замечаний' },
          { category: 'Организационные и процессные вопросы' },
          { status: 'Отклонено' },
        ])],
      },
    ]);
    expect(result.documents).toHaveLength(2);
    const [manual, spec] = result.documents;
    // Тот же набор, что в примере из методики: 6 / 15 / 1 / 4.
    expect(spec).toMatchObject({
      document: 'Техническое задание', manager: 'Петров П.', journalPath: '2026-Q3/ЖУЗ_ТЗ.xlsx',
      facts: { design: 6, content: 15, repeats: 1, cycles: 4 }, missing: [],
    });
    expect(spec!.score).toMatchObject({ iikd: 84.45, zone: 'yellow' });
    expect(spec!.remarks).toHaveLength(24);
    expect(manual).toMatchObject({ document: 'Руководство пользователя', facts: { design: 0, content: 0, repeats: 0, cycles: 1 }, missing: [] });
    expect(manual!.score?.iikd).toBe(100);
    expect(result.issues).toEqual([]);
    expect(result.files.map((f) => f.kind)).toEqual(['journal', 'registry']);
  });

  it('документ без найденного ЖУЗ остаётся без оценки', () => {
    const result = evaluate([
      { path: 'Шаблон_1.xlsx', sheets: [registrySheet([{ document: 'А', cycles: 1, journalFile: 'нет_такого.xlsx' }, { document: 'Б', cycles: 1 }])] },
    ]);
    expect(result.documents.map((d) => [d.document, d.score, d.missing])).toEqual([
      ['А', null, ['journal']],
      ['Б', null, ['journal']],
    ]);
    expect(result.issues.map((i) => i.level)).toEqual(['error', 'warning']);
    expect(summarize(result.documents)).toMatchObject({ total: 2, scored: 0, average: null, incomplete: 2 });
  });

  it('без числа циклов считает три показателя и помечает документ', () => {
    const result = evaluate([
      { path: 'Шаблон_1.xlsx', sheets: [registrySheet([{ document: 'ТЗ', journalFile: 'ЖУЗ' }])] },
      { path: 'ЖУЗ.xlsx', sheets: [journalSheet(content(10))] },
    ]);
    expect(result.documents[0]).toMatchObject({ facts: { content: 10, cycles: null }, missing: ['cycles'] });
    expect(result.documents[0]!.score?.iikd).toBe(96.5);
  });

  it('журнал без перечня оценивается отдельно, период берётся из дат замечаний', () => {
    const result = evaluate([{ path: 'ЖУЗ_Отчет.xlsx', sheets: [journalSheet([{ date: '29.07.2026' }, { date: '02.10.2026', project: null }])] }]);
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]).toMatchObject({
      project: 'Проект Альфа', document: 'Техническое задание', manager: '', expertise: null,
      missing: ['registry', 'cycles'], asOf: '2026-10-02',
    });
  });

  it('пустой бланк ЖУЗ и посторонние книги пропускаются', () => {
    const result = evaluate([
      { path: 'Бланк ЖУЗ.xlsx', sheets: [journalSheet([], { hints: true })] },
      { path: 'Прочее.xlsx', sheets: [{ name: 'Лист1', rows: [['Что-то другое']] }] },
    ]);
    expect(result.documents).toEqual([]);
    expect(result.files.map((f) => f.kind)).toEqual(['skipped', 'skipped']);
  });

  it('дата версии: из перечня, иначе по дате файла, иначе по последнему замечанию', () => {
    const june = new Date(2026, 5, 15).getTime();
    const july = new Date(2026, 6, 20).getTime();
    const dated = evaluate([
      { path: 'Шаблон_1.xlsx', modified: july, sheets: [registrySheet([{ document: 'ТЗ', cycles: 1, journalFile: 'ЖУЗ' }])] },
      { path: 'ЖУЗ.xlsx', modified: june, sheets: [journalSheet(content(2))] },
    ]);
    expect(dated.documents[0]!.asOf).toBe('2026-09-30');
    expect(dated.issues).toEqual([]);

    const undated = evaluate([
      { path: 'Шаблон_1.xlsx', modified: july, sheets: [registrySheet([{ document: 'ТЗ', cycles: 1, journalFile: 'ЖУЗ' }], 'Отчетный период:')] },
      { path: 'ЖУЗ.xlsx', modified: june, sheets: [journalSheet(content(2))] },
    ]);
    expect(undated.documents[0]).toMatchObject({ asOf: '2026-07-20', missing: [] });
    expect(undated.issues).toEqual([expect.objectContaining({ level: 'warning', file: 'Шаблон_1.xlsx' })]);

    const standalone = evaluate([{ path: 'ЖУЗ.xlsx', modified: june, sheets: [journalSheet(content(2))] }]);
    expect(standalone.documents[0]!.asOf).toBe('2026-06-15');

    const nothing = evaluate([
      { path: 'Шаблон_1.xlsx', sheets: [registrySheet([{ document: 'ТЗ', cycles: 1, journalFile: 'без замечаний' }], 'Отчетный период:')] },
    ]);
    expect(nothing.documents[0]).toMatchObject({ asOf: null, missing: ['date'] });
  });

  it('внутренняя и внешняя экспертиза одного документа оцениваются отдельно', () => {
    const result = evaluate([
      {
        path: 'Шаблон_1.xlsx',
        sheets: [registrySheet([
          { document: 'ТЗ', internal: 'да', external: 'нет', cycles: 1, journalFile: 'ЖУЗ_внутр' },
          { document: 'ТЗ', internal: 'нет', external: 'да', cycles: 2, journalFile: 'ЖУЗ_внеш' },
        ])],
      },
      { path: 'ЖУЗ_внутр.xlsx', sheets: [journalSheet(content(2))] },
      { path: 'ЖУЗ_внеш.xlsx', sheets: [journalSheet(content(20))] },
    ]);
    expect(result.documents.map((d) => [d.expertise, d.score?.iikd])).toEqual([['internal', 100], ['external', 79]]);
    expect(new Set(result.documents.map((d) => d.docKey)).size).toBe(2);
    expect(result.issues).toEqual([]);
  });

  it('одноимённые документы одного перечня остаются разными документами', () => {
    const result = evaluate([
      {
        path: 'Шаблон_1.xlsx',
        sheets: [registrySheet([
          { document: 'Руководство пользователя', cycles: 1, journalFile: 'без замечаний' },
          { document: 'Руководство пользователя', cycles: 1, journalFile: 'без замечаний' },
        ])],
      },
    ]);
    expect(new Set(result.documents.map((d) => d.docKey)).size).toBe(2);
    expect(result.issues).toEqual([expect.objectContaining({ level: 'warning', row: 5 })]);
  });
});

describe('выбор журнала при одинаковых именах файлов', () => {
  const registry = (period: string) => registrySheet([{ document: 'ТЗ', cycles: 1, journalFile: 'ЖУЗ.xlsx' }], `Отчетный период: ${period}`);

  it('берёт журнал из подпапки своего периода', () => {
    const result = evaluate([
      { path: '2026 кв.2/Шаблон_1.xlsx', sheets: [registry('2 квартал 2026')] },
      { path: '2026 кв.3/Шаблон_1.xlsx', sheets: [registry('3 квартал 2026')] },
      { path: '2026 кв.2/Альфа/ЖУЗ.xlsx', sheets: [journalSheet(content(20))] },
      { path: '2026 кв.3/Альфа/ЖУЗ.xlsx', sheets: [journalSheet(content(2))] },
    ]);
    expect(result.documents.map((d) => [d.asOf, d.journalPath, d.score?.iikd])).toEqual([
      ['2026-06-30', '2026 кв.2/Альфа/ЖУЗ.xlsx', 79],
      ['2026-09-30', '2026 кв.3/Альфа/ЖУЗ.xlsx', 100],
    ]);
    expect(result.issues).toEqual([]);
  });

  it('находит единственный журнал в любой папке', () => {
    const result = evaluate([
      { path: 'Перечни/Шаблон_1.xlsx', sheets: [registry('3 квартал 2026')] },
      { path: 'Журналы/Альфа/ЖУЗ.xlsx', sheets: [journalSheet(content(2))] },
    ]);
    expect(result.documents[0]).toMatchObject({ journalPath: 'Журналы/Альфа/ЖУЗ.xlsx', missing: [] });
    expect(result.issues).toEqual([]);
  });

  it('предупреждает, если выбрать однозначно нельзя', () => {
    const result = evaluate([
      { path: 'Шаблон_1.xlsx', sheets: [registry('3 квартал 2026')] },
      { path: 'Альфа/ЖУЗ.xlsx', sheets: [journalSheet(content(2))] },
      { path: 'Бета/ЖУЗ.xlsx', sheets: [journalSheet(content(2))] },
    ]);
    expect(result.issues).toEqual([expect.objectContaining({ level: 'warning', row: 4 })]);
  });
});

describe('сводные показатели', () => {
  const result = evaluate([
    {
      path: 'Шаблон_1.xlsx',
      sheets: [registrySheet([
        { manager: 'Петров П.', document: 'А', cycles: 1, journalFile: 'без замечаний' },
        { manager: 'Петров П.', document: 'Б', cycles: 5, journalFile: 'ЖУЗ_Б' },
        { manager: 'Сидорова А.', document: 'В', cycles: 1, journalFile: 'ЖУЗ_В' },
        { manager: 'Сидорова А.', document: 'Г', cycles: 1, journalFile: 'потерян' },
      ])],
    },
    { path: 'ЖУЗ_Б.xlsx', sheets: [journalSheet(content(12))] },
    { path: 'ЖУЗ_В.xlsx', sheets: [journalSheet(content(40))] },
  ]);

  it('общая сводка', () => {
    // А = 100; Б = 100 − 0,35·20 − 0,2·30 = 87; В = 65; Г без оценки.
    expect(summarize(result.documents)).toEqual({
      total: 4, scored: 3, incomplete: 1, average: 84, zones: { green: 1, yellow: 1, red: 1 },
    });
  });

  it('рейтинг руководителей и средние баллы по показателям', () => {
    const groups = byManager(result.documents);
    expect(groups.map((g) => [g.label, g.scored, g.average])).toEqual([['Петров П.', 2, 93.5], ['Сидорова А.', 1, 65]]);
    expect(groups[0]!.indicators.content).toEqual({ average: 90, failed: 1 });
    expect(groups[0]!.indicators.cycles).toEqual({ average: 85, failed: 1 });
    expect(groups[1]!.indicators.content).toEqual({ average: 0, failed: 1 });
    expect(groups[1]!.indicators.design).toEqual({ average: 100, failed: 0 });
  });
});
