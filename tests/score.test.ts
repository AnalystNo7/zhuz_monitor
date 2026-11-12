import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, INDICATOR_IDS, type Config } from '../src/core/config.ts';
import { computeScore } from '../src/core/score.ts';

const cfg = DEFAULT_CONFIG;
const score = (design: number, content: number, repeats: number, cycles: number | null) =>
  computeScore({ design, content, repeats, cycles }, cfg);

describe('формула ИИКД', () => {
  it('сумма весов равна 1', () => {
    const sum = INDICATOR_IDS.reduce((s, id) => s + cfg.indicators[id].weight, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('воспроизводит пример из методики (таблица 2)', () => {
    const result = score(6, 15, 1, 4);
    expect(result.indicators.design).toMatchObject({ over: 2, score: 98 });
    expect(result.indicators.content).toMatchObject({ over: 7, score: 65 });
    expect(result.indicators.repeats).toMatchObject({ over: 0, score: 100 });
    expect(result.indicators.cycles).toMatchObject({ over: 1, score: 85 });
    expect(result.iikd).toBe(84.45);
    expect(result.zone).toBe('yellow');
  });

  it('документ без замечаний получает 100 баллов', () => {
    expect(score(0, 0, 0, 1)).toMatchObject({ iikd: 100, zone: 'green' });
  });

  it.each([
    // оформление, содержание, повторы, циклы → ИИКД (строки пилотного реестра)
    [0, 39, 0, 2, 65],
    [4, 81, 0, 2, 65],
    [20, 56, 5, 3, 50.6],
    [0, 13, 0, 2, 91.25],
    [0, 26, 0, 1, 68.5],
    [0, 11, 0, 2, 94.75],
    [0, 29, 0, 2, 65],
  ])('строка реестра %i/%i/%i/%i даёт %f', (design, content, repeats, cycles, expected) => {
    expect(score(design, content, repeats, cycles).iikd).toBe(expected);
  });

  it('балл показателя не опускается ниже нуля', () => {
    expect(score(0, 1000, 0, 1).indicators.content.score).toBe(0);
  });

  it('границы зон: 90 — зелёная, 70 — жёлтая', () => {
    expect(score(0, 12, 2, 1)).toMatchObject({ iikd: 90, zone: 'green' });
    expect(score(5, 12, 2, 1)).toMatchObject({ iikd: 89.85, zone: 'yellow' });
    expect(score(0, 0, 11, 1)).toMatchObject({ iikd: 70, zone: 'yellow' });
    expect(score(1, 0, 11, 1)).toMatchObject({ iikd: 70, zone: 'yellow' });
    expect(score(5, 0, 11, 1)).toMatchObject({ iikd: 69.85, zone: 'red' });
  });

  it('неуказанное число циклов не штрафуется', () => {
    expect(score(0, 0, 0, null).iikd).toBe(100);
    expect(score(0, 0, 0, null).indicators.cycles.score).toBe(100);
  });

  it('норматив на 10 листов включается настройкой', () => {
    const scaled: Config = { ...cfg, normMode: 'per10pages' };
    const result = computeScore({ design: 8, content: 22, repeats: 0, cycles: 1 }, scaled, 20);
    expect(result.indicators.design).toMatchObject({ norm: 8, over: 0 });
    expect(result.indicators.content).toMatchObject({ norm: 16, over: 6, score: 70 });
    // Без числа листов остаётся плоский норматив.
    expect(computeScore({ design: 8, content: 0, repeats: 0, cycles: 1 }, scaled, null).indicators.design.norm).toBe(4);
  });
});
