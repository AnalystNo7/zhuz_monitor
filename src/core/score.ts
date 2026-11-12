import { INDICATOR_IDS, type Config } from './config.ts';
import type { DocScore, IndicatorId, IndicatorScore, Zone } from './types.ts';

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function zoneOf(iikd: number, cfg: Config): Zone {
  if (iikd >= cfg.zones.green) return 'green';
  if (iikd >= cfg.zones.yellow) return 'yellow';
  return 'red';
}

/** Норматив показателя для документа с учётом режима расчёта. */
export function normFor(id: IndicatorId, pages: number | null, cfg: Config): number {
  const base = cfg.indicators[id].norm;
  const scalable = id === 'design' || id === 'content';
  if (cfg.normMode === 'per10pages' && scalable && pages && pages > 0) return (base * pages) / 10;
  return base;
}

export interface Facts {
  design: number;
  content: number;
  repeats: number;
  /** `null` — число циклов неизвестно; штраф по показателю не начисляется. */
  cycles: number | null;
}

/**
 * ИИКД = Σ Wn × Bn, где Bn = max(0; 100 − Sn × kn), Sn = max(0; Xn − N).
 * Значение округляется до сотых, зона определяется по округлённому значению.
 */
export function computeScore(facts: Facts, cfg: Config, pages: number | null = null): DocScore {
  const indicators = {} as Record<IndicatorId, IndicatorScore>;
  let total = 0;
  for (const id of INDICATOR_IDS) {
    const { weight, penalty } = cfg.indicators[id];
    const fact = facts[id] ?? 0;
    const norm = normFor(id, pages, cfg);
    const over = Math.max(0, fact - norm);
    const score = Math.max(0, 100 - over * penalty);
    const contribution = weight * score;
    indicators[id] = { fact, norm, over, score: round2(score), weight, contribution: round2(contribution) };
    total += contribution;
  }
  const iikd = round2(total);
  return { indicators, iikd, zone: zoneOf(iikd, cfg) };
}
