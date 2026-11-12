import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG as cfg } from '../src/core/config.ts';
import { applyManagers, managersRows, parseManagers, projectsWithoutManager } from '../src/core/managers.ts';
import { evaluate } from '../src/core/pipeline.ts';
import { statesAt } from '../src/core/timeline.ts';
import { journalSheet, registrySheet } from './helpers.ts';

describe('назначение РП', () => {
  const { documents } = evaluate([
    { path: 'Перечень.xlsx', sheets: [registrySheet([{ project: 'Альфа', manager: 'Петров П.', document: 'ТЗ', journalFile: 'без замечаний' }])] },
    { path: 'ЖУЗ_Бета.xlsx', sheets: [journalSheet([{ project: 'Бета', document: 'ПР' }])] },
    { path: 'ЖУЗ_Гамма.xlsx', sheets: [journalSheet([{ project: 'Гамма', document: 'МД' }])] },
  ]);

  it('без назначений РП берётся из перечня', () => {
    expect(documents.map((d) => [d.project, d.manager, d.managerSource])).toEqual([
      ['Альфа', 'Петров П.', 'registry'],
      ['Бета', '', null],
      ['Гамма', '', null],
    ]);
    expect(projectsWithoutManager(statesAt(documents, null, cfg))).toEqual(['Бета', 'Гамма']);
  });

  it('назначение вручную подставляется для всех документов проекта и важнее перечня', () => {
    const assigned = applyManagers(documents, new Map([
      ['альфа', { project: 'Альфа', manager: 'Иванова И.' }],
      ['бета', { project: 'Бета', manager: ' Сидорова А. ' }],
      ['гамма', { project: 'Гамма', manager: '  ' }],
    ]));
    expect(assigned.map((d) => [d.manager, d.managerSource])).toEqual([
      ['Иванова И.', 'form'],
      ['Сидорова А.', 'form'],
      ['', null],
    ]);
    expect(statesAt(assigned, null, cfg).map((s) => s.manager)).toEqual(['Иванова И.', 'Сидорова А.', '']);
    // Исходные документы не меняются.
    expect(documents[0]!.manager).toBe('Петров П.');
  });

  it('файл назначений: запись и разбор', () => {
    const rows = managersRows(new Map([['б', { project: 'Бета', manager: 'Сидорова А.' }], ['а', { project: 'Альфа', manager: '' }]]));
    expect(rows).toEqual([['Проект', 'РП'], ['Бета', 'Сидорова А.']]);
    expect(parseManagers({ name: 'x', rows })?.get('бета')).toEqual({ project: 'Бета', manager: 'Сидорова А.' });
    // Перечень документов с колонкой РП назначениями не считается.
    expect(parseManagers({ name: 'x', rows: [['Проект', 'РП', 'Проектный документ']] })).toBeNull();
    expect(parseManagers({ name: 'x', rows: [['Что-то']] })).toBeNull();
  });
});
