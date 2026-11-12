import { INDICATOR_IDS, type Config } from './config.ts';
import { round2 } from './score.ts';
import { listPeriods, statesAt } from './timeline.ts';
import type { DocumentState, Granularity, IndicatorId, Period, ProjectDocument, Zone } from './types.ts';

export interface Summary {
  /** Всего документов в выборке. */
  total: number;
  /** Документов с рассчитанным ИИКД; остальные не рассчитаны (нет журнала или категорий). */
  scored: number;
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

export function summarize(states: DocumentState[]): Summary {
  const zones: Record<Zone, number> = { green: 0, yellow: 0, red: 0 };
  const values: number[] = [];
  for (const state of states) {
    if (!state.score) continue;
    zones[state.score.zone] += 1;
    values.push(state.score.iikd);
  }
  return {
    total: states.length,
    scored: values.length,
    average: mean(values),
    zones,
  };
}

function indicatorSummary(states: DocumentState[], id: IndicatorId): IndicatorSummary {
  const scores: number[] = [];
  let failed = 0;
  for (const state of states) {
    if (!state.score) continue;
    const indicator = state.score.indicators[id];
    scores.push(indicator.score);
    if (indicator.over > 0) failed += 1;
  }
  return { average: mean(scores), failed };
}

function describe(key: string, label: string, states: DocumentState[]): GroupSummary {
  const indicators = {} as Record<IndicatorId, IndicatorSummary>;
  for (const id of INDICATOR_IDS) indicators[id] = indicatorSummary(states, id);
  return { key, label, ...summarize(states), indicators };
}

export function groupBy(
  states: DocumentState[],
  keyOf: (state: DocumentState) => { key: string; label: string },
): GroupSummary[] {
  const groups = new Map<string, { label: string; states: DocumentState[] }>();
  for (const state of states) {
    const { key, label } = keyOf(state);
    const group = groups.get(key) ?? { label, states: [] };
    group.states.push(state);
    groups.set(key, group);
  }
  return [...groups].map(([key, group]) => describe(key, group.label, group.states));
}

/** От лучшего среднего к худшему; группы без оценок — в конце. */
function byAverageDesc(a: GroupSummary, b: GroupSummary): number {
  if (a.average === null || b.average === null) return (a.average === null ? 1 : 0) - (b.average === null ? 1 : 0);
  return b.average - a.average || a.label.localeCompare(b.label, 'ru');
}

/** Рейтинг руководителей проектов и данные для матрицы уязвимостей. */
export function byManager(states: DocumentState[]): GroupSummary[] {
  return groupBy(states, (s) => {
    const label = s.manager || 'РП не указан';
    return { key: label.toLowerCase(), label };
  }).sort(byAverageDesc);
}

export function byProject(states: DocumentState[]): GroupSummary[] {
  return groupBy(states, (s) => {
    const label = s.doc.project || 'Проект не указан';
    return { key: label.toLowerCase(), label };
  }).sort(byAverageDesc);
}

export interface TrendPoint extends GroupSummary {
  period: Period;
}

/**
 * Динамика нарастающим итогом: на конец каждого периода — состояние всех документов,
 * начатых к этому моменту. `filter` отбирает состояния (например, по статусу документа).
 */
export function trend(
  documents: ProjectDocument[],
  granularity: Granularity,
  cfg: Config,
  filter: (state: DocumentState) => boolean = () => true,
): TrendPoint[] {
  return listPeriods(documents, granularity).map((period) => ({
    period,
    ...describe(period.key, period.label, statesAt(documents, period.end, cfg).filter(filter)),
  }));
}
