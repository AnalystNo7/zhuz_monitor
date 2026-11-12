import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG as cfg } from '../src/core/config.ts';
import { evaluate, type InputWorkbook } from '../src/core/pipeline.ts';
import { manualSheets } from '../src/core/manual.ts';
import { stateAt } from '../src/core/timeline.ts';
import type { ProjectDocument } from '../src/core/types.ts';
import { journalSheet, registrySheet, type RemarkInput } from './helpers.ts';

const content = (n: number, extra: RemarkInput = {}): RemarkInput[] => Array.from({ length: n }, () => ({ ...extra }));
const now = (doc: ProjectDocument) => stateAt(doc, null, cfg)!;

describe('связывание перечня с журналами', () => {
  it('находит журнал по имени файла и считает ИИКД', () => {
    const result = evaluate([
      {
        path: 'Перечень.xlsx',
        sheets: [registrySheet([
          { document: 'Техническое задание', cycles: 4, journalFile: 'ЖУЗ_ТЗ.xlsx' },
          { document: 'Руководство пользователя', cycles: 1, journalFile: 'без замечаний' },
        ])],
      },
      {
        path: 'Альфа/ЖУЗ_ТЗ.xlsx',
        sheets: [journalSheet([
          ...content(15),
          ...content(6, { category: 'Корректировка оформления и структуры документа' }),
          { category: 'Учет ранее выданных замечаний' },
          { category: 'Организационные и процессные вопросы' },
          { status: 'Отклонено' },
        ])],
      },
    ]);
    expect(result.documents.map((d) => d.name)).toEqual(['Руководство пользователя', 'Техническое задание']);
    const [manual, spec] = result.documents as [ProjectDocument, ProjectDocument];

    // Тот же набор, что в примере из методики: 6 / 15 / 1 / 4.
    expect(spec).toMatchObject({
      project: 'Проект Альфа', manager: 'Петров П.', managerSource: 'registry', journalPath: 'Альфа/ЖУЗ_ТЗ.xlsx',
      startDate: '2026-09-08', journalMissing: false, uncategorizedRows: [],
    });
    expect(now(spec)).toMatchObject({
      manager: 'Петров П.', status: 'Согласован', remarkCount: 24, cyclesSource: 'registry',
      facts: { design: 6, content: 15, repeats: 1, cycles: 4 }, missing: [],
    });
    expect(now(spec).score).toMatchObject({ iikd: 84.45, zone: 'yellow' });

    // Документ без замечаний получает 100; точка отсчёта — дата перечня.
    expect(manual).toMatchObject({ journalPath: null, startDate: '2026-09-30', journalMissing: false });
    expect(now(manual)).toMatchObject({ remarkCount: 0, facts: { design: 0, content: 0, repeats: 0, cycles: 1 }, missing: [] });
    expect(now(manual).score?.iikd).toBe(100);

    expect(result.issues).toEqual([]);
    expect(result.files.map((f) => f.kind)).toEqual(['journal', 'registry']);
  });

  it('без имени файла связывает по проекту и документу', () => {
    const result = evaluate([
      { path: 'Перечень.xlsx', sheets: [registrySheet([{ project: 'Проект Бета', document: 'Регламент', cycles: 1 }])] },
      { path: 'ЖУЗ_что_угодно.xlsx', sheets: [journalSheet(content(2, { project: ' проект бета ', document: 'РЕГЛАМЕНТ' }))] },
    ]);
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]).toMatchObject({ name: 'Регламент', journalPath: 'ЖУЗ_что_угодно.xlsx' });
    expect(result.issues).toEqual([]);
  });

  it('документ без найденного журнала не рассчитывается', () => {
    const result = evaluate([
      { path: 'Перечень.xlsx', sheets: [registrySheet([{ document: 'А', cycles: 1, journalFile: 'нет_такого.xlsx' }, { document: 'Б', cycles: 1 }])] },
    ]);
    expect(result.documents.map((d) => [d.name, d.journalMissing, now(d).score, now(d).missing])).toEqual([
      ['А', true, null, ['journal']],
      ['Б', true, null, ['journal']],
    ]);
    expect(result.issues.map((i) => i.level)).toEqual(['error', 'warning']);
  });

  it('журнал с принятыми замечаниями без категории не рассчитывается', () => {
    const result = evaluate([
      { path: 'Перечень.xlsx', sheets: [registrySheet([{ document: 'ТЗ', cycles: 1, journalFile: 'ЖУЗ' }])] },
      { path: 'ЖУЗ.xlsx', sheets: [journalSheet([{}, { category: null }, { category: null }])] },
    ]);
    const doc = result.documents[0]!;
    expect(doc.uncategorizedRows).toEqual([4, 5]);
    expect(now(doc)).toMatchObject({ remarkCount: 3, facts: null, score: null, missing: ['categories'] });
    expect(result.issues).toEqual([expect.objectContaining({ level: 'error', file: 'ЖУЗ.xlsx' })]);
  });

  it('без числа циклов в перечне циклы оцениваются по журналу', () => {
    const result = evaluate([
      { path: 'Перечень.xlsx', sheets: [registrySheet([{ document: 'ТЗ', journalFile: 'ЖУЗ' }])] },
      {
        path: 'ЖУЗ.xlsx',
        sheets: [journalSheet([
          ...content(6, { date: '10.03.2026', fileVersion: 'v1' }),
          ...content(2, { date: '20.04.2026', fileVersion: 'v2' }),
          ...content(2, { date: '25.05.2026', fileVersion: 'v3' }),
          ...content(2, { date: '30.06.2026', fileVersion: 'v4' }),
        ])],
      },
    ]);
    const state = now(result.documents[0]!);
    expect(state).toMatchObject({ cyclesSource: 'journal', facts: { content: 12, cycles: 4 }, missing: [] });
    // Содержание: 4 сверх нормы → 80; циклы: 1 сверх нормы → 85.
    expect(state.score?.iikd).toBe(90);
    expect(stateAt(result.documents[0]!, '2026-04-30', cfg)!.facts!.cycles).toBe(2);
  });

  it('журнал без перечня рассчитывается полностью, циклы — по журналу', () => {
    const result = evaluate([{ path: 'ЖУЗ_Отчет.xlsx', sheets: [journalSheet([{ date: '02.10.2026' }, { date: '29.07.2026', project: null }])] }]);
    expect(result.documents).toHaveLength(1);
    const doc = result.documents[0]!;
    expect(doc).toMatchObject({ project: 'Проект Альфа', name: 'Техническое задание', startDate: '2026-07-29', passports: [], manager: '', managerSource: null });
    expect(now(doc)).toMatchObject({ manager: '', status: '', cyclesSource: 'journal', facts: { cycles: 1 }, missing: [] });
  });

  it('пустой бланк ЖУЗ и посторонние книги пропускаются', () => {
    const result = evaluate([
      { path: 'Бланк ЖУЗ.xlsx', sheets: [journalSheet([], { hints: true })] },
      { path: 'Прочее.xlsx', sheets: [{ name: 'Лист1', rows: [['Что-то другое']] }] },
    ]);
    expect(result.documents).toEqual([]);
    expect(result.files.map((f) => f.kind)).toEqual(['skipped', 'skipped']);
  });

  it('отметки внутреннего и внешнего согласования не делят документ на два', () => {
    const result = evaluate([
      {
        path: 'Перечень.xlsx',
        sheets: [registrySheet([{ document: 'ТЗ', internal: 'да', external: 'да', cycles: 1, journalFile: 'без замечаний' }])],
      },
    ]);
    expect(result.documents).toHaveLength(1);
    expect(result.issues).toEqual([]);
  });

  it('предупреждает, если на один журнал ссылаются две строки перечня', () => {
    const result = evaluate([
      {
        path: 'Перечень.xlsx',
        sheets: [registrySheet([{ document: 'ТЗ', cycles: 1, journalFile: 'ЖУЗ' }, { document: 'ТЗ, версия 2', cycles: 1, journalFile: 'ЖУЗ' }])],
      },
      { path: 'ЖУЗ.xlsx', sheets: [journalSheet(content(2))] },
    ]);
    expect(result.documents).toHaveLength(1);
    expect(result.issues).toEqual([expect.objectContaining({ level: 'warning', row: 5 })]);
  });

  it('одноимённые документы без журналов остаются разными и вызывают предупреждение', () => {
    const result = evaluate([
      {
        path: 'Перечень.xlsx',
        sheets: [registrySheet([
          { document: 'Руководство пользователя', cycles: 1, journalFile: 'без замечаний' },
          { document: 'Руководство пользователя', cycles: 1, journalFile: 'без замечаний' },
        ])],
      },
    ]);
    expect(result.documents).toHaveLength(2);
    expect(result.issues).toEqual([expect.objectContaining({ level: 'warning', row: 5 })]);
  });
});

describe('копии одного журнала', () => {
  const older: InputWorkbook = { path: 'Архив/ЖУЗ_ТЗ.xlsx', sheets: [journalSheet(content(5))] };
  const newer: InputWorkbook = { path: 'ЖУЗ_ТЗ (2).xlsx', sheets: [journalSheet(content(11))] };

  it('актуальной считается самая полная копия', () => {
    const result = evaluate([older, newer]);
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]).toMatchObject({ journalPath: 'ЖУЗ_ТЗ (2).xlsx' });
    expect(now(result.documents[0]!).remarkCount).toBe(11);
    expect(result.files.map((f) => [f.path, f.kind])).toEqual([['Архив/ЖУЗ_ТЗ.xlsx', 'skipped'], ['ЖУЗ_ТЗ (2).xlsx', 'journal']]);
    expect(result.files[0]!.note).toContain('Более ранняя копия');
  });

  it('при равной полноте берётся файл, изменённый позже', () => {
    const june = new Date(2026, 5, 15).getTime();
    const july = new Date(2026, 6, 20).getTime();
    const result = evaluate([
      { path: 'a/ЖУЗ.xlsx', modified: july, sheets: [journalSheet(content(3))] },
      { path: 'b/ЖУЗ.xlsx', modified: june, sheets: [journalSheet(content(3))] },
    ]);
    expect(result.documents[0]!.journalPath).toBe('a/ЖУЗ.xlsx');
  });

  it('ссылка перечня на старую копию ведёт к актуальной', () => {
    const result = evaluate([
      { path: 'Перечень.xlsx', sheets: [registrySheet([{ document: 'ТЗ', cycles: 1, journalFile: 'ЖУЗ_ТЗ.xlsx' }])] },
      older,
      newer,
    ]);
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]!.journalPath).toBe('ЖУЗ_ТЗ (2).xlsx');
  });

  it('журналы разных документов с одинаковым именем файла различаются по папке', () => {
    const result = evaluate([
      { path: 'Альфа/Перечень.xlsx', sheets: [registrySheet([{ project: 'Альфа', document: 'ТЗ', cycles: 1, journalFile: 'ЖУЗ.xlsx' }])] },
      { path: 'Бета/Перечень.xlsx', sheets: [registrySheet([{ project: 'Бета', document: 'ТЗ', cycles: 1, journalFile: 'ЖУЗ.xlsx' }])] },
      { path: 'Альфа/ЖУЗ.xlsx', sheets: [journalSheet(content(20, { project: 'Альфа', document: 'ТЗ' }))] },
      { path: 'Бета/ЖУЗ.xlsx', sheets: [journalSheet(content(2, { project: 'Бета', document: 'ТЗ' }))] },
    ]);
    expect(result.documents.map((d) => [d.project, d.journalPath, now(d).score?.iikd])).toEqual([
      ['Альфа', 'Альфа/ЖУЗ.xlsx', 79],
      ['Бета', 'Бета/ЖУЗ.xlsx', 100],
    ]);
    expect(result.issues).toEqual([]);
  });
});

describe('несколько перечней за разное время', () => {
  const result = evaluate([
    {
      path: '2026-06/Перечень.xlsx',
      sheets: [registrySheet([{ document: 'ТЗ', status: 'На согласовании', cycles: 1, journalFile: 'ЖУЗ' }], 'Данные на 30.06.2026')],
    },
    {
      path: '2026-09/Перечень.xlsx',
      sheets: [registrySheet([{ document: 'ТЗ', status: 'Согласован', cycles: 4, journalFile: 'ЖУЗ' }], 'Данные на 30.09.2026')],
    },
    { path: 'ЖУЗ.xlsx', sheets: [journalSheet(content(2, { date: '10.06.2026' }))] },
  ]);

  it('сведения из перечней образуют историю одного документа', () => {
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]!.passports.map((p) => [p.asOf, p.status, p.cycles])).toEqual([
      ['2026-06-30', 'На согласовании', 1],
      ['2026-09-30', 'Согласован', 4],
    ]);
  });

  it('статус и число циклов берутся из перечня, действовавшего на дату', () => {
    const doc = result.documents[0]!;
    expect(stateAt(doc, '2026-07-31', cfg)).toMatchObject({ status: 'На согласовании', facts: { cycles: 1 } });
    expect(stateAt(doc, '2026-07-31', cfg)!.score?.iikd).toBe(100);
    expect(now(doc)).toMatchObject({ status: 'Согласован', facts: { cycles: 4 } });
    expect(now(doc).score?.iikd).toBe(97);
    // До первого перечня известны только сведения из самого раннего.
    expect(stateAt(doc, '2026-06-15', cfg)).toMatchObject({ status: 'На согласовании' });
  });

  it('перечень без даты получает дату файла и предупреждение', () => {
    const july = new Date(2026, 6, 20).getTime();
    const undated = evaluate([
      { path: 'Перечень.xlsx', modified: july, sheets: [registrySheet([{ document: 'ТЗ', cycles: 1, journalFile: 'без замечаний' }], 'Отчетный период:')] },
    ]);
    expect(undated.documents[0]).toMatchObject({ startDate: '2026-07-20' });
    expect(undated.issues).toEqual([expect.objectContaining({ level: 'warning', file: 'Перечень.xlsx' })]);
  });
});

describe('файл ручного ввода в папке', () => {
  const managersSheet = (rows: string[][]) => ({ name: 'РП по проектам', rows });

  it('распознаётся и не мешает журналам и перечням', () => {
    const [, documentsSheet] = manualSheets({
      managers: new Map(),
      documents: new Map([['проект альфа|техническое задание', { project: 'Проект Альфа', document: 'Техническое задание', status: 'Согласован', cycles: 2, updated: '2026-10-01' }]]),
    });
    const result = evaluate([
      {
        path: 'Ручной ввод.xlsx',
        sheets: [managersSheet([['Проект', 'РП'], ['Проект Альфа', 'Петров П.'], [' проект бета ', 'Сидорова А.'], ['Гамма', '']]), documentsSheet!],
      },
      { path: 'ЖУЗ.xlsx', sheets: [journalSheet(content(2))] },
    ]);
    expect([...result.manual.managers.entries()]).toEqual([
      ['проект альфа', { project: 'Проект Альфа', manager: 'Петров П.' }],
      ['проект бета', { project: 'проект бета', manager: 'Сидорова А.' }],
    ]);
    expect([...result.manual.documents.keys()]).toEqual(['проект альфа|техническое задание']);
    expect(result.manualPath).toBe('Ручной ввод.xlsx');
    expect(result.files.map((f) => [f.kind, f.note])).toEqual([
      ['journal', 'ЖУЗ: замечаний 2; в перечне документов не указан'],
      ['manual', 'Ручной ввод: РП проектов 2, документов со статусом или циклами 1'],
    ]);
    // Сам документ ручных значений не получает: они подставляются в интерфейсе.
    expect(result.documents[0]).toMatchObject({ manager: '', manual: null });
  });

  it('при нескольких файлах действует более поздний', () => {
    const result = evaluate([
      { path: 'a.xlsx', modified: 2, sheets: [managersSheet([['Проект', 'РП'], ['Альфа', 'Новый']])] },
      { path: 'b.xlsx', modified: 1, sheets: [managersSheet([['Проект', 'РП'], ['Альфа', 'Старый'], ['Бета', 'Сидорова А.']])] },
    ]);
    expect([...result.manual.managers.values()].map((a) => a.manager)).toEqual(['Новый', 'Сидорова А.']);
    expect(result.manualPath).toBe('a.xlsx');
    expect(result.issues).toEqual([expect.objectContaining({ level: 'warning', file: 'a.xlsx' })]);
  });
});
