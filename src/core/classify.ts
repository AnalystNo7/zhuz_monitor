import type { CategoryConfig, Config } from './config.ts';
import { norm } from './text.ts';
import type { Cell, RemarkIndicator, RemarkStatus } from './types.ts';

export function classifyStatus(raw: Cell | undefined, cfg: Config): RemarkStatus {
  const s = norm(raw).replace(/[.;]+$/, '');
  if (!s) return 'empty';
  if (cfg.acceptedStatuses.includes(s)) return 'accepted';
  if (cfg.rejectedStatuses.includes(s)) return 'rejected';
  if (cfg.pendingStatuses.includes(s)) return 'pending';
  return 'unknown';
}

/**
 * Ячейка «Категория замечания» может содержать несколько категорий списком:
 * каждая с новой строки или через точку с запятой, с маркером «-» или без него.
 */
export function splitCategories(raw: Cell | undefined): string[] {
  // Делим до нормализации: она схлопывает переводы строк в пробелы.
  return String(raw ?? '')
    .split(/[\r\n;]+/)
    .map((part) => norm(part).replace(/^[\s\-–—•*]+/, '').replace(/[\s.,;]+$/, ''))
    .filter(Boolean);
}

export function matchCategory(fragment: string, cfg: Config): CategoryConfig | null {
  const f = norm(fragment);
  return cfg.categories.find((c) => c.keywords.some((k) => f.includes(k))) ?? null;
}

export interface CategoryResult {
  /** Идентификаторы распознанных категорий. */
  categories: string[];
  /** Фрагменты, которые не удалось отнести ни к одной категории справочника. */
  unknown: string[];
  /** Все показатели, на которые указывают категории замечания. */
  indicators: RemarkIndicator[];
  /** Показатель, по которому замечание считается: первый по приоритету. */
  indicator: RemarkIndicator | null;
}

/** Из нескольких показателей выбирает тот, что стоит раньше в `indicatorPriority`. */
export function pickIndicator(indicators: Iterable<RemarkIndicator>, cfg: Config): RemarkIndicator | null {
  const set = new Set(indicators);
  return cfg.indicatorPriority.find((i) => set.has(i)) ?? null;
}

/**
 * Определяет категории замечания и показатель, в который оно идёт.
 * Замечание считается один раз: если категорий несколько, берётся показатель,
 * стоящий раньше в `indicatorPriority`.
 */
export function classifyCategories(raw: Cell | undefined, cfg: Config): CategoryResult {
  const categories: string[] = [];
  const unknown: string[] = [];
  const indicators = new Set<RemarkIndicator>();
  for (const fragment of splitCategories(raw)) {
    const category = matchCategory(fragment, cfg);
    if (!category) {
      unknown.push(fragment);
      continue;
    }
    if (!categories.includes(category.id)) categories.push(category.id);
    if (category.indicator) indicators.add(category.indicator);
  }
  return { categories, unknown, indicators: [...indicators], indicator: pickIndicator(indicators, cfg) };
}
