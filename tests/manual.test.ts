import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG as cfg } from '../src/core/config.ts';
import { applyManual, emptyManualData, manualSheets, parseDocumentOverrides, parseManagers } from '../src/core/manual.ts';
import { evaluate } from '../src/core/pipeline.ts';
import { stateAt, statesAt } from '../src/core/timeline.ts';
import type { DocumentOverride, ManualData } from '../src/core/types.ts';
import { journalSheet, registrySheet } from './helpers.ts';

const override = (project: string, document: string, rest: Partial<DocumentOverride>): [string, DocumentOverride] => [
  `${project.toLowerCase()}|${document.toLowerCase()}`,
  { project, document, status: '', cycles: null, updated: null, ...rest },
];

describe('назначение РП', () => {
  const { documents } = evaluate([
    { path: 'Перечень.xlsx', sheets: [registrySheet([{ project: 'Альфа', manager: 'Петров П.', document: 'ТЗ', journalFile: 'без замечаний' }])] },
    { path: 'ЖУЗ_Бета.xlsx', sheets: [journalSheet([{ project: 'Бета', document: 'ПР' }])] },
    { path: 'ЖУЗ_Гамма.xlsx', sheets: [journalSheet([{ project: 'Гамма', document: 'МД' }])] },
  ]);

  it('без ручного ввода РП берётся из перечня', () => {
    expect(documents.map((d) => [d.project, d.manager, d.managerSource, d.manual])).toEqual([
      ['Альфа', 'Петров П.', 'registry', null],
      ['Бета', '', null, null],
      ['Гамма', '', null, null],
    ]);
  });

  it('РП из формы подставляется для всех документов проекта и важнее перечня', () => {
    const data: ManualData = {
      managers: new Map([
        ['альфа', { project: 'Альфа', manager: 'Иванова И.' }],
        ['бета', { project: 'Бета', manager: ' Сидорова А. ' }],
        ['гамма', { project: 'Гамма', manager: '  ' }],
      ]),
      documents: new Map(),
    };
    const assigned = applyManual(documents, data);
    expect(assigned.map((d) => [d.manager, d.managerSource])).toEqual([
      ['Иванова И.', 'form'],
      ['Сидорова А.', 'form'],
      ['', null],
    ]);
    expect(statesAt(assigned, null, cfg).map((s) => s.manager)).toEqual(['Иванова И.', 'Сидорова А.', '']);
    // Исходные документы не меняются.
    expect(documents[0]!.manager).toBe('Петров П.');
    expect(applyManual(documents, emptyManualData())).toBe(documents);
  });
});

describe('статус и циклы, введённые вручную', () => {
  const { documents } = evaluate([
    {
      path: 'Перечень.xlsx',
      sheets: [registrySheet([{ project: 'Альфа', document: 'ТЗ', status: 'На согласовании', cycles: 2, journalFile: 'ЖУЗ' }], 'Данные на 30.06.2026')],
    },
    { path: 'ЖУЗ.xlsx', sheets: [journalSheet([{ project: 'Альфа', document: 'ТЗ', date: '10.03.2026' }])] },
    { path: 'ЖУЗ_ПР.xlsx', sheets: [journalSheet([{ project: 'Бета', document: 'ПР', date: '10.03.2026' }])] },
  ]);
  const data: ManualData = {
    managers: new Map(),
    documents: new Map([
      override('Альфа', 'ТЗ', { status: 'Согласован', cycles: 4, updated: '2026-08-15' }),
      override('Бета', 'ПР', { status: 'На доработке', updated: null }),
    ]),
  };
  const [spec, solution] = applyManual(documents, data);

  it('важнее перечня и оценки по журналу', () => {
    expect(stateAt(spec!, null, cfg)).toMatchObject({ status: 'Согласован', cycles: 4, cyclesSource: 'form', facts: { cycles: 4 } });
    expect(stateAt(spec!, null, cfg)!.score?.iikd).toBe(97);
    expect(stateAt(solution!, null, cfg)).toMatchObject({ status: 'На доработке', cycles: 1, cyclesSource: 'journal' });
  });

  it('действует с даты изменения: раньше — перечень и журнал', () => {
    expect(stateAt(spec!, '2026-07-31', cfg)).toMatchObject({ status: 'На согласовании', cycles: 2, cyclesSource: 'registry' });
    expect(stateAt(spec!, '2026-08-15', cfg)).toMatchObject({ status: 'Согласован', cycles: 4, cyclesSource: 'form' });
    // Без даты изменения ручные значения действуют всегда.
    expect(stateAt(solution!, '2026-03-31', cfg)).toMatchObject({ status: 'На доработке' });
  });
});

describe('файл ручного ввода', () => {
  const data: ManualData = {
    managers: new Map([
      ['бета', { project: 'Бета', manager: 'Сидорова А.' }],
      ['альфа', { project: 'Альфа', manager: '' }],
    ]),
    documents: new Map([
      override('Бета', 'ПР', { status: 'Согласован', updated: '2026-10-01' }),
      override('Альфа', 'ТЗ', { cycles: 3, updated: '2026-09-15' }),
      override('Альфа', 'Пустой', {}),
    ]),
  };

  it('запись: два листа, пустые значения не пишутся', () => {
    expect(manualSheets(data)).toEqual([
      { name: 'РП по проектам', rows: [['Проект', 'РП'], ['Бета', 'Сидорова А.']] },
      {
        name: 'Документы',
        rows: [
          ['Проект', 'Документ', 'Статус', 'Циклы согласования', 'Изменено'],
          ['Альфа', 'ТЗ', null, 3, '15.09.2026'],
          ['Бета', 'ПР', 'Согласован', null, '01.10.2026'],
        ],
      },
    ]);
  });

  it('разбор записанного', () => {
    const [managers, documents] = manualSheets(data);
    expect([...parseManagers(managers!)!.values()]).toEqual([{ project: 'Бета', manager: 'Сидорова А.' }]);
    expect([...parseDocumentOverrides(documents!)!.values()]).toEqual([
      { project: 'Альфа', document: 'ТЗ', status: '', cycles: 3, updated: '2026-09-15' },
      { project: 'Бета', document: 'ПР', status: 'Согласован', cycles: null, updated: '2026-10-01' },
    ]);
  });

  it('некорректное число циклов не читается', () => {
    const sheet = { name: 'x', rows: [['Проект', 'Документ', 'Циклы согласования'], ['А', 'ТЗ', 'два'], ['А', 'ПР', 0], ['А', 'МД', 2.5], ['А', 'ПМИ', '3']] };
    expect([...parseDocumentOverrides(sheet)!.values()].map((d) => [d.document, d.cycles])).toEqual([['ПМИ', 3]]);
  });

  it('чужие таблицы не принимаются за ручной ввод', () => {
    expect(parseManagers({ name: 'x', rows: [['Проект', 'РП', 'Проектный документ']] })).toBeNull();
    expect(parseManagers({ name: 'x', rows: [['Что-то']] })).toBeNull();
    expect(parseDocumentOverrides(journalSheet([{}]))).toBeNull();
    expect(parseDocumentOverrides({ name: 'x', rows: [['Проект', 'РП', 'Документ', 'Статус']] })).toBeNull();
  });
});
