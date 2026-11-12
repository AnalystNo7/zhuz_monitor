import type { Cell, Period } from './types.ts';

/** Текст ячейки без неразрывных пробелов и пробелов по краям. */
export function str(v: Cell | undefined): string {
  if (v === null || v === undefined) return '';
  return String(v).replace(/ /g, ' ').trim();
}

/** Ключ для сравнения: нижний регистр, «ё» как «е», одиночные пробелы. */
export function norm(v: Cell | undefined): string {
  return str(v).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

export function isBlank(v: Cell | undefined): boolean {
  return str(v) === '';
}

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Дата из ячейки: порядковый номер дня Excel, `ДД.ММ.ГГГГ` или `ГГГГ-ММ-ДД`. */
export function parseDate(v: Cell | undefined): string | null {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 20000 || v > 80000) return null;
    // 25569 — номер дня 01.01.1970 в системе дат Excel.
    return new Date((Math.floor(v) - 25569) * 86_400_000).toISOString().slice(0, 10);
  }
  const s = str(v);
  let m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(s);
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

export function period(year: number, quarter: number): Period {
  return { key: `${year}-Q${quarter}`, label: `${quarter} кв. ${year}`, year, quarter };
}

export function periodFromDate(isoDate: string): Period {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  return period(year, Math.ceil(month / 3));
}

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4 };
const MONTHS = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];

/**
 * Отчётный период из свободного текста: «3 квартал 2026», «III кв. 2026», «Q3 2026»,
 * «сентябрь 2026», «09.2026», «05.10.2026». Месяц и дата приводятся к кварталу.
 */
export function parsePeriod(text: Cell | undefined): Period | null {
  if (typeof text === 'number') {
    const d = parseDate(text);
    return d ? periodFromDate(d) : null;
  }
  const s = norm(text);
  if (!s) return null;

  const fullDate = /(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(s);
  if (fullDate) {
    const d = iso(Number(fullDate[3]), Number(fullDate[2]), Number(fullDate[1]));
    return d ? periodFromDate(d) : null;
  }

  const yearMatch = /(20\d{2})/.exec(s);
  if (!yearMatch) return null;
  const year = Number(yearMatch[1]);
  const rest = s.replace(yearMatch[0], ' ');

  let m = /(?:^|[^\d])([1-4])\s*-?\s*(?:й|ый|ой|ий)?\s*кв/.exec(rest);
  if (m) return period(year, Number(m[1]));
  m = /(?:^|[^a-z])(iv|iii|ii|i)\s*кв/.exec(rest);
  if (m) return period(year, ROMAN[m[1]!]!);
  m = /кв(?:артал)?\.?\s*([1-4])(?:[^\d]|$)/.exec(rest);
  if (m) return period(year, Number(m[1]));
  m = /q\s*([1-4])|([1-4])\s*q/.exec(rest);
  if (m) return period(year, Number(m[1] ?? m[2]));

  // «Ма» совпадает и с «март», поэтому май проверяется по целому слову.
  for (let i = 0; i < MONTHS.length; i++) {
    const stem = MONTHS[i]!;
    const hit = stem === 'ма' ? /(?:^|[^а-я])ма[йяе](?:[^а-я]|$)/.test(rest) : rest.includes(stem);
    if (hit) return period(year, Math.ceil((i + 1) / 3));
  }
  // «09.2026»: после удаления года остаётся номер месяца с разделителем.
  m = /(?:^|[^\d])(\d{1,2})\s*[./-]/.exec(rest);
  if (m) {
    const month = Number(m[1]);
    if (month >= 1 && month <= 12) return period(year, Math.ceil(month / 3));
  }
  return null;
}

/** Имя файла без пути и расширения, пригодное для сопоставления. */
export function fileKey(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  return norm(base.replace(/\.(xlsx|xlsm|xls)$/i, ''));
}

export function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** Самое частое непустое значение; при равенстве — встретившееся раньше. */
export function mostFrequent(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = '';
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}
