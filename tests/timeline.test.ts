import { describe, expect, it } from 'vitest';
import { byManager, summarize, trend } from '../src/core/aggregate.ts';
import { DEFAULT_CONFIG as cfg } from '../src/core/config.ts';
import { evaluate } from '../src/core/pipeline.ts';
import { history, listPeriods, stateAt, statesAt } from '../src/core/timeline.ts';
import { journalSheet, registrySheet, type RemarkInput } from './helpers.ts';

const content = (n: number, extra: RemarkInput = {}): RemarkInput[] => Array.from({ length: n }, () => ({ ...extra }));

/*
 * Один перечень и три документа:
 *  «А» — журнал пополнялся дважды: 5 замечаний в январе и ещё 6 в августе;
 *  «Б» — согласован без замечаний, появляется с датой перечня;
 *  «В» — 40 замечаний в мае.
 */
const { documents } = evaluate([
  {
    path: 'Перечень.xlsx',
    sheets: [registrySheet([
      { manager: 'Петров П.', document: 'А', status: 'На согласовании', cycles: 2, journalFile: 'ЖУЗ_А' },
      { manager: 'Петров П.', document: 'Б', status: 'Согласован', cycles: 1, journalFile: 'без замечаний' },
      { manager: 'Сидорова А.', document: 'В', status: 'Согласован', cycles: 1, journalFile: 'ЖУЗ_В' },
    ], 'Данные на 30.09.2026')],
  },
  {
    path: 'ЖУЗ_А.xlsx',
    sheets: [journalSheet([
      ...content(5, { document: 'А', date: '16.01.2026' }),
      ...content(6, { document: 'А', date: '14.08.2026' }),
    ])],
  },
  { path: 'ЖУЗ_В.xlsx', sheets: [journalSheet(content(40, { document: 'В', date: '10.05.2026' }))] },
]);
const [a, b, c] = documents;

describe('состояние документа на дату', () => {
  it('точка отсчёта — первое замечание; для документа без замечаний — дата перечня', () => {
    expect(documents.map((d) => [d.name, d.startDate])).toEqual([['А', '2026-01-16'], ['Б', '2026-09-30'], ['В', '2026-05-10']]);
  });

  it('до точки отсчёта документа нет', () => {
    expect(stateAt(a!, '2026-01-15', cfg)).toBeNull();
    expect(stateAt(b!, '2026-09-29', cfg)).toBeNull();
    expect(stateAt(a!, '2026-01-16', cfg)).not.toBeNull();
  });

  it('учитываются замечания, выданные не позже даты', () => {
    expect(stateAt(a!, '2026-03-31', cfg)).toMatchObject({ remarkCount: 5, facts: { content: 5 } });
    expect(stateAt(a!, '2026-03-31', cfg)!.score?.iikd).toBe(100);
    expect(stateAt(a!, '2026-08-14', cfg)).toMatchObject({ remarkCount: 11, facts: { content: 11 } });
    expect(stateAt(a!, '2026-08-14', cfg)!.score?.iikd).toBe(94.75);
    expect(stateAt(a!, null, cfg)!.score?.iikd).toBe(94.75);
  });

  it('замечание без даты считается с начала документа', () => {
    const { documents: docs } = evaluate([
      { path: 'ЖУЗ.xlsx', sheets: [journalSheet([{ date: '10.03.2026' }, { date: 'нет' }, { date: '05.06.2026' }])] },
    ]);
    expect(stateAt(docs[0]!, '2026-03-31', cfg)!.remarkCount).toBe(2);
    expect(stateAt(docs[0]!, '2026-06-30', cfg)!.remarkCount).toBe(3);
  });

  it('история — состояние на каждую дату, когда журнал пополнялся', () => {
    expect(history(a!, cfg).map((s) => [s.asOf, s.remarkCount, s.score?.iikd])).toEqual([
      ['2026-01-16', 5, 100],
      ['2026-08-14', 11, 94.75],
    ]);
    expect(history(b!, cfg).map((s) => [s.asOf, s.remarkCount])).toEqual([['2026-09-30', 0]]);
  });
});

describe('динамика нарастающим итогом', () => {
  it('периоды идут без пропусков от первого документа до последнего события', () => {
    expect(listPeriods(documents, 'quarter').map((p) => p.label)).toEqual(['1 кв. 2026', '2 кв. 2026', '3 кв. 2026']);
    expect(listPeriods(documents, 'month').map((p) => p.key)).toEqual([
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09',
    ]);
    expect(listPeriods([], 'month')).toEqual([]);
  });

  it('по кварталам', () => {
    expect(trend(documents, 'quarter', cfg).map((g) => [g.label, g.scored, g.average])).toEqual([
      ['1 кв. 2026', 1, 100],
      ['2 кв. 2026', 2, 82.5],
      ['3 кв. 2026', 3, 86.58],
    ]);
  });

  it('по месяцам: документ без новых замечаний переносится с прежней оценкой', () => {
    expect(trend(documents, 'month', cfg).map((g) => [g.period.key, g.scored, g.average])).toEqual([
      ['2026-01', 1, 100],
      ['2026-02', 1, 100],
      ['2026-03', 1, 100],
      ['2026-04', 1, 100],
      ['2026-05', 2, 82.5],
      ['2026-06', 2, 82.5],
      ['2026-07', 2, 82.5],
      ['2026-08', 2, 79.88],
      ['2026-09', 3, 86.58],
    ]);
  });

  it('отбор по статусу документа', () => {
    const approved = trend(documents, 'quarter', cfg, (s) => s.status === 'Согласован');
    expect(approved.map((g) => [g.label, g.scored, g.average])).toEqual([
      ['1 кв. 2026', 0, null],
      ['2 кв. 2026', 1, 65],
      ['3 кв. 2026', 2, 82.5],
    ]);
  });
});

describe('сводные показатели', () => {
  const states = statesAt(documents, null, cfg);

  it('общая сводка', () => {
    expect(summarize(states)).toEqual({ total: 3, scored: 3, incomplete: 0, average: 86.58, zones: { green: 2, yellow: 0, red: 1 } });
    expect(c).toBeDefined();
  });

  it('рейтинг руководителей и средние баллы по показателям', () => {
    const groups = byManager(states);
    expect(groups.map((g) => [g.label, g.scored, g.average])).toEqual([['Петров П.', 2, 97.38], ['Сидорова А.', 1, 65]]);
    expect(groups[0]!.indicators.content).toEqual({ average: 92.5, failed: 1 });
    expect(groups[0]!.indicators.cycles).toEqual({ average: 100, failed: 0 });
    expect(groups[1]!.indicators.content).toEqual({ average: 0, failed: 1 });
  });

  it('документ без журнала в средние не входит', () => {
    const { documents: docs } = evaluate([
      { path: 'Перечень.xlsx', sheets: [registrySheet([{ document: 'Г', cycles: 1, journalFile: 'потерян' }])] },
    ]);
    expect(summarize(statesAt(docs, null, cfg))).toMatchObject({ total: 1, scored: 0, average: null, incomplete: 1 });
  });
});
