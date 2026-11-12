import { describe, expect, it } from 'vitest';
import { fileKey, norm, parseDate, parsePeriod } from '../src/core/text.ts';

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

describe('отчётный период', () => {
  it.each([
    ['3 квартал 2026', '2026-Q3'],
    ['3-й квартал 2026 г.', '2026-Q3'],
    ['III кв. 2026', '2026-Q3'],
    ['IV квартал 2025', '2025-Q4'],
    ['2026, квартал 2', '2026-Q2'],
    ['Q1 2026', '2026-Q1'],
    ['2026 Q4', '2026-Q4'],
    ['сентябрь 2026', '2026-Q3'],
    ['май 2026', '2026-Q2'],
    ['март 2026', '2026-Q1'],
    ['09.2026', '2026-Q3'],
    ['05.10.2026', '2026-Q4'],
  ])('%s → %s', (text, key) => {
    expect(parsePeriod(text)?.key).toBe(key);
  });
  it('дата в ячейке Excel', () => {
    expect(parsePeriod(46273)?.key).toBe('2026-Q3');
  });
  it('без года период не определяется', () => {
    expect(parsePeriod('3 квартал')).toBeNull();
    expect(parsePeriod('')).toBeNull();
  });
  it('подпись периода', () => {
    expect(parsePeriod('3 квартал 2026')?.label).toBe('3 кв. 2026');
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
