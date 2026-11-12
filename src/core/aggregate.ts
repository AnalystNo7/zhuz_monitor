import { INDICATOR_IDS } from './config.ts';
import { round2 } from './score.ts';
import type { DocumentEval, IndicatorId, Period, Zone } from './types.ts';

export interface Summary {
  /** Всего документов в выборке. */
  total: number;
  /** Документов с рассчитанным ИИКД. */
  scored: number;
  /** Документов, по которым не хватило данных для полной оценки. */
  incomplete: number;
  average: number | null;
  zones: Record<Zone, number>;
}

export interface IndicatorSummary {
  /** Средний балл показателя; `null`, если данных нет. */
  average: number | null;
  /** Сколько документов превысили норматив. */
  failed: number;
}

export interface GroupSummary extends Summary {
  key: string;
  label: string;
  indicators: Record<IndicatorId, IndicatorSummary>;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return round2(values.reduce((sum, v) => sum + v, 0) / values.length);
}

export function summarize(documents: DocumentEval[]): Summary {
  const zones: Record<Zone, number> = { green: 0, yellow: 0, red: 0 };
  const values: number[] = [];
  for (const doc of documents) {
    if (!doc.score) continue;
    zones[doc.score.zone] += 1;
    values.push(doc.score.iikd);
  }
  return {
    total: documents.length,
    scored: values.length,
    incomplete: documents.filter((d) => d.missing.length > 0).length,
    average: mean(values),
    zones,
  };
}

function indicatorSummary(documents: DocumentEval[], id: IndicatorId): IndicatorSummary {
  const scores: number[] = [];
  let failed = 0;
  for (const doc of documents) {
    if (!doc.score || !doc.facts) continue;
    // Неуказанное число циклов не штрафуется и в статистику показателя не идёт.
    if (id === 'cycles' && doc.facts.cycles === null) continue;
    const indicator = doc.score.indicators[id];
    scores.push(indicator.score);
    if (indicator.over > 0) failed += 1;
  }
  return { average: mean(scores), failed };
}

export function groupBy(
  documents: DocumentEval[],
  keyOf: (doc: DocumentEval) => { key: string; label: string },
): GroupSummary[] {
  const groups = new Map<string, { label: string; docs: DocumentEval[] }>();
  for (const doc of documents) {
    const { key, label } = keyOf(doc);
    const group = groups.get(key) ?? { label, docs: [] };
    group.docs.push(doc);
    groups.set(key, group);
  }
  return [...groups].map(([key, { label, docs }]) => {
    const indicators = {} as Record<IndicatorId, IndicatorSummary>;
    for (const id of INDICATOR_IDS) indicators[id] = indicatorSummary(docs, id);
    return { key, label, ...summarize(docs), indicators };
  });
}

/** От лучшего среднего к худшему; группы без оценок — в конце. */
function byAverageDesc(a: GroupSummary, b: GroupSummary): number {
  if (a.average === null || b.average === null) return (a.average === null ? 1 : 0) - (b.average === null ? 1 : 0);
  return b.average - a.average || a.label.localeCompare(b.label, 'ru');
}

/** Рейтинг руководителей проектов и данные для матрицы уязвимостей. */
export function byManager(documents: DocumentEval[]): GroupSummary[] {
  return groupBy(documents, (d) => {
    const label = d.manager || 'РП не указан';
    return { key: label.toLowerCase(), label };
  }).sort(byAverageDesc);
}

export function byProject(documents: DocumentEval[]): GroupSummary[] {
  return groupBy(documents, (d) => {
    const label = d.project || 'Проект не указан';
    return { key: label.toLowerCase(), label };
  }).sort(byAverageDesc);
}

/** Динамика по отчётным периодам в хронологическом порядке. */
export function byPeriod(documents: DocumentEval[]): GroupSummary[] {
  return groupBy(
    documents.filter((d) => d.period),
    (d) => ({ key: d.period!.key, label: d.period!.label }),
  ).sort((a, b) => a.key.localeCompare(b.key));
}

export function listPeriods(documents: DocumentEval[]): Period[] {
  const periods = new Map<string, Period>();
  for (const doc of documents) if (doc.period) periods.set(doc.period.key, doc.period);
  return [...periods.values()].sort((a, b) => a.key.localeCompare(b.key));
}
