import { describe, expect, it } from 'vitest';
import {
  buildHistories, documentsInPeriod, latestVersions, listPeriods, previousVersion, summarize, trend,
} from '../src/core/aggregate.ts';
import { evaluate } from '../src/core/pipeline.ts';
import { journalSheet, registrySheet, type RemarkInput } from './helpers.ts';

const content = (n: number): RemarkInput[] => Array.from({ length: n }, () => ({}));

/*
 * Три загрузки в разное время. Документ «А» дорабатывается и загружается трижды,
 * «Б» согласован без замечаний в июне, «В» появляется в сентябре.
 */
const { documents } = evaluate([
  {
    path: '2026-06/Шаблон_1.xlsx',
    sheets: [registrySheet([
      { document: 'А', status: 'На согласовании', cycles: 1, journalFile: 'ЖУЗ_А' },
      { document: 'Б', cycles: 1, journalFile: 'без замечаний' },
    ], 'Отчетный период: июнь 2026')],
  },
  { path: '2026-06/ЖУЗ_А.xlsx', sheets: [journalSheet(content(20))] },
  {
    path: '2026-08/Шаблон_1.xlsx',
    sheets: [registrySheet([{ document: 'А', status: 'На доработке', cycles: 2, journalFile: 'ЖУЗ_А' }], 'Отчетный период: август 2026')],
  },
  { path: '2026-08/ЖУЗ_А.xlsx', sheets: [journalSheet(content(12))] },
  {
    path: '2026-09/Шаблон_1.xlsx',
    sheets: [registrySheet([
      { document: 'А', status: 'Согласован', cycles: 3, journalFile: 'ЖУЗ_А' },
      { document: 'В', cycles: 1, journalFile: 'ЖУЗ_В' },
    ], 'Отчетный период: сентябрь 2026')],
  },
  { path: '2026-09/ЖУЗ_А.xlsx', sheets: [journalSheet(content(2))] },
  { path: '2026-09/ЖУЗ_В.xlsx', sheets: [journalSheet(content(40))] },
]);

const view = (docs: typeof documents) => docs.map((d) => [d.document, d.asOf, d.score?.iikd]);

describe('версии документа', () => {
  it('каждая загрузка даёт отдельную версию с общей для документа связкой', () => {
    expect(view(documents)).toEqual([
      ['А', '2026-06-30', 79],
      ['Б', '2026-06-30', 100],
      ['А', '2026-08-31', 93],
      ['А', '2026-09-30', 100],
      ['В', '2026-09-30', 65],
    ]);
    const histories = buildHistories(documents);
    expect(histories.size).toBe(3);
    expect(histories.get(documents[0]!.docKey)!.map((d) => d.status)).toEqual(['На согласовании', 'На доработке', 'Согласован']);
  });

  it('текущее состояние — последняя версия каждого документа', () => {
    const latest = latestVersions(documents);
    expect(view(latest)).toEqual([
      ['Б', '2026-06-30', 100],
      ['А', '2026-09-30', 100],
      ['В', '2026-09-30', 65],
    ]);
    expect(summarize(latest)).toMatchObject({ scored: 3, average: 88.33, zones: { green: 2, yellow: 0, red: 1 } });
  });

  it('предыдущая версия нужна для расчёта изменения', () => {
    const histories = buildHistories(documents);
    expect(previousVersion(documents[0]!, histories)).toBeNull();
    expect(previousVersion(documents[3]!, histories)?.asOf).toBe('2026-08-31');
    expect(previousVersion(documents[4]!, histories)).toBeNull();
  });
});

describe('периоды: месяц и квартал', () => {
  it('список периодов зависит от детализации', () => {
    expect(listPeriods(documents, 'quarter').map((p) => p.label)).toEqual(['2 кв. 2026', '3 кв. 2026']);
    expect(listPeriods(documents, 'month').map((p) => p.label)).toEqual(['июнь 2026', 'август 2026', 'сентябрь 2026']);
  });

  it('в квартале берётся последняя версия документа за квартал', () => {
    expect(view(documentsInPeriod(documents, 'quarter', '2026-Q3'))).toEqual([
      ['А', '2026-09-30', 100],
      ['В', '2026-09-30', 65],
    ]);
    expect(view(documentsInPeriod(documents, 'month', '2026-08'))).toEqual([['А', '2026-08-31', 93]]);
    expect(documentsInPeriod(documents, 'month', '2026-07')).toEqual([]);
  });

  it('динамика по кварталам и по месяцам', () => {
    expect(trend(documents, 'quarter').map((g) => [g.label, g.scored, g.average])).toEqual([
      ['2 кв. 2026', 2, 89.5],
      ['3 кв. 2026', 2, 82.5],
    ]);
    expect(trend(documents, 'month').map((g) => [g.label, g.scored, g.average])).toEqual([
      ['июнь 2026', 2, 89.5],
      ['август 2026', 1, 93],
      ['сентябрь 2026', 2, 82.5],
    ]);
  });

  it('версии без даты в периоды не попадают, но видны в текущем состоянии', () => {
    const undated = evaluate([
      { path: 'Шаблон_1.xlsx', sheets: [registrySheet([{ document: 'Г', cycles: 1, journalFile: 'без замечаний' }], 'Отчетный период:')] },
    ]).documents;
    expect(listPeriods(undated, 'quarter')).toEqual([]);
    expect(trend(undated, 'month')).toEqual([]);
    expect(latestVersions(undated)).toHaveLength(1);
  });
});
