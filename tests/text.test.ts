import { describe, expect, it } from 'vitest';
import { bucketOf, dateFromTimestamp, fileKey, formatDate, norm, parseDate, parseReportingDate } from '../src/core/text.ts';

describe('даты', () => {
  it('порядковый номер дня Excel', () => {
    expect(parseDate(46273)).toBe('2026-09-08');
    expect(parseDate(46273.75)).toBe('2026-09-08');
    expect(parseDate(45658)).toBe('2025-01-01');
  });
  it('текстовые форматы', () => {
    expect(parseDate('29.07.2026')).toBe('2026-07-29');
    expect(parseDate('2026-07-29')).toBe('2026-07-29');
    expect(parseDate('5.1.2026')).toBe('2026-01-05');
  });
  it('мусор не превращается в дату', () => {
    expect(parseDate('Дата поступления замечания')).toBeNull();
    expect(parseDate(3)).toBeNull();
    expect(parseDate(null)).toBeNull();
  });
});

describe('дата перечня документов', () => {
  it.each([
    ['05.10.2026', '2026-10-05'],
    ['на 05.10.2026', '2026-10-05'],
    ['2026-10-05', '2026-10-05'],
    ['сентябрь 2026', '2026-09-30'],
    ['за февраль 2028 г.', '2028-02-29'],
    ['май 2026', '2026-05-31'],
    ['март 2026', '2026-03-31'],
    ['09.2026', '2026-09-30'],
    ['3 квартал 2026', '2026-09-30'],
    ['3-й квартал 2026 г.', '2026-09-30'],
    ['III кв. 2026', '2026-09-30'],
    ['IV квартал 2025', '2025-12-31'],
    ['2026, квартал 2', '2026-06-30'],
    ['Q1 2026', '2026-03-31'],
    ['2026 Q4', '2026-12-31'],
  ])('%s → %s', (text, expected) => {
    expect(parseReportingDate(text)).toBe(expected);
  });
  it('дата в ячейке Excel', () => {
    expect(parseReportingDate(46273)).toBe('2026-09-08');
  });
  it('без года дата не определяется', () => {
    expect(parseReportingDate('3 квартал')).toBeNull();
    expect(parseReportingDate('')).toBeNull();
  });
});

describe('периоды', () => {
  it('квартал и месяц по дате', () => {
    expect(bucketOf('2026-09-08', 'quarter')).toEqual({ key: '2026-Q3', label: '3 кв. 2026' });
    expect(bucketOf('2026-09-08', 'month')).toEqual({ key: '2026-09', label: 'сентябрь 2026' });
    expect(bucketOf('2026-12-31', 'quarter').key).toBe('2026-Q4');
    expect(bucketOf('2026-01-01', 'quarter').key).toBe('2026-Q1');
  });
  it('оформление даты и дата из отметки времени файла', () => {
    expect(formatDate('2026-09-08')).toBe('08.09.2026');
    expect(dateFromTimestamp(new Date(2026, 8, 8, 23, 30).getTime())).toBe('2026-09-08');
  });
});

describe('сопоставление строк', () => {
  it('нормализация', () => {
    expect(norm('  Учёт\u00a0 ранее\nвыданных ')).toBe('учет ранее выданных');
  });
  it('ключ файла не зависит от пути, регистра и расширения', () => {
    expect(fileKey('S:\\Папка\\ЖУЗ_ТЗ.XLSX')).toBe('жуз_тз');
    expect(fileKey('2026-Q3/Альфа/ЖУЗ_ТЗ.xlsx')).toBe('жуз_тз');
    expect(fileKey(' ЖУЗ_ТЗ ')).toBe('жуз_тз');
  });
});
