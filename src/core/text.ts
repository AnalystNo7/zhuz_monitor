import type { Cell, Granularity, Period } from './types.ts';

/** Текст ячейки без неразрывных пробелов и пробелов по краям. */
export function str(v: Cell | undefined): string {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\u00a0/g, ' ').trim();
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

const MONTH_STEMS = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
const MONTH_NAMES = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4 };

/** Последний день месяца. */
function monthEnd(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`;
}

/** Период, в который попадает дата, при выбранной детализации. */
export function bucketOf(isoDate: string, granularity: Granularity): Period {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  if (granularity === 'month') {
    return { key: isoDate.slice(0, 7), label: `${MONTH_NAMES[month - 1]} ${year}`, end: monthEnd(year, month) };
  }
  const quarter = Math.ceil(month / 3);
  return { key: `${year}-Q${quarter}`, label: `${quarter} кв. ${year}`, end: monthEnd(year, quarter * 3) };
}

/** Следующий за данным период той же детализации. */
export function nextPeriod(period: Period, granularity: Granularity): Period {
  const next = new Date(Date.UTC(Number(period.end.slice(0, 4)), Number(period.end.slice(5, 7)) - 1, Number(period.end.slice(8, 10)) + 1));
  return bucketOf(next.toISOString().slice(0, 10), granularity);
}

/** Число дней от одной даты `ГГГГ-ММ-ДД` до другой. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** `ДД.ММ.ГГГГ` из `ГГГГ-ММ-ДД`. */
export function formatDate(isoDate: string): string {
  return `${isoDate.slice(8, 10)}.${isoDate.slice(5, 7)}.${isoDate.slice(0, 4)}`;
}

/** Локальная календарная дата из отметки времени файла. */
export function dateFromTimestamp(ms: number): string {
  const d = new Date(ms);
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate())!;
}

/**
 * Дата, на которую составлен перечень, из свободного текста: «05.10.2026»,
 * «сентябрь 2026», «09.2026», «3 квартал 2026», «III кв. 2026», «Q3 2026».
 * Для месяца и квартала возвращается последний день периода.
 */
export function parseReportingDate(text: Cell | undefined): string | null {
  if (typeof text === 'number') return parseDate(text);
  const s = norm(text);
  if (!s) return null;

  const fullDate = /(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(s);
  if (fullDate) return iso(Number(fullDate[3]), Number(fullDate[2]), Number(fullDate[1]));
  const isoDate = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (isoDate) return iso(Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3]));

  const yearMatch = /(20\d{2})/.exec(s);
  if (!yearMatch) return null;
  const year = Number(yearMatch[1]);
  const rest = s.replace(yearMatch[0], ' ');
  const quarterEnd = (quarter: number) => monthEnd(year, quarter * 3);

  let m = /(?:^|[^\d])([1-4])\s*-?\s*(?:й|ый|ой|ий)?\s*кв/.exec(rest);
  if (m) return quarterEnd(Number(m[1]));
  m = /(?:^|[^a-z])(iv|iii|ii|i)\s*кв/.exec(rest);
  if (m) return quarterEnd(ROMAN[m[1]!]!);
  m = /кв(?:артал)?\.?\s*([1-4])(?:[^\d]|$)/.exec(rest);
  if (m) return quarterEnd(Number(m[1]));
  m = /q\s*([1-4])|([1-4])\s*q/.exec(rest);
  if (m) return quarterEnd(Number(m[1] ?? m[2]));

  // «Ма» совпадает и с «март», поэтому май проверяется по целому слову.
  for (let i = 0; i < MONTH_STEMS.length; i++) {
    const stem = MONTH_STEMS[i]!;
    const hit = stem === 'ма' ? /(?:^|[^а-я])ма[йяе](?:[^а-я]|$)/.test(rest) : rest.includes(stem);
    if (hit) return monthEnd(year, i + 1);
  }
  // «09.2026»: после удаления года остаётся номер месяца с разделителем.
  m = /(?:^|[^\d])(\d{1,2})\s*[./-]/.exec(rest);
  if (m) {
    const month = Number(m[1]);
    if (month >= 1 && month <= 12) return monthEnd(year, month);
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
