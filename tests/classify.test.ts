import { describe, expect, it } from 'vitest';
import { classifyCategories, classifyStatus, matchCategory, splitCategories } from '../src/core/classify.ts';
import { DEFAULT_CONFIG as cfg } from '../src/core/config.ts';

describe('статус замечания', () => {
  it.each([
    ['Принято', 'accepted'],
    ['  принято ', 'accepted'],
    ['Согласовано с комментарием', 'accepted'],
    ['Отклонено', 'rejected'],
    ['', 'empty'],
    [null, 'empty'],
    ['Новое', 'pending'],
    ['На рассмотрении', 'pending'],
    ['Снято', 'unknown'],
  ] as const)('%s → %s', (raw, expected) => {
    expect(classifyStatus(raw, cfg)).toBe(expected);
  });
});

describe('категория замечания', () => {
  it('каждое наименование из справочника распознаётся как своя категория', () => {
    for (const category of cfg.categories) {
      expect(matchCategory(category.title, cfg)?.id, category.title).toBe(category.id);
    }
  });

  it('делит ячейку на категории по строкам и точкам с запятой', () => {
    expect(splitCategories(' - Дополнение текстового содержания документа;\n- Уточнение / корректировка информации')).toEqual([
      'дополнение текстового содержания документа',
      'уточнение / корректировка информации',
    ]);
    expect(splitCategories('Уточнение / корректировка информации;\n')).toEqual(['уточнение / корректировка информации']);
    expect(splitCategories(null)).toEqual([]);
  });

  it.each([
    [' - Дополнение текстового содержания документа;\n- Уточнение / корректировка информации', 'content'],
    [' - Изменение текстового содержания документа;\n- Уточнение / корректировка информации', 'content'],
    [' - Уточнение / корректировка информации;\n - Корректировка с учетом положений / нормативных документов', 'content'],
    ['Уточнение в части требований к функциональности', 'content'],
    ['Уточнение', 'content'],
    ['- Уточнение / корректировка информации;', 'content'],
    ['Ошибки в терминологии и определениях / сокращениях и расшифровках', 'content'],
    ['Ошибки в терминологии и определениях / сокращениях и расшифровка', 'content'],
    ['Корректировка оформления и структуры документа', 'design'],
    ['Орфографические и грамматические ошибки', 'design'],
    ['Учет ранее выданных замечаний', 'repeats'],
    ['Учёт ранее выданных замечаний', 'repeats'],
    ['Организационные и процессные вопросы', null],
    ['Прочее', null],
    ['', null],
  ] as const)('%s → %s', (raw, expected) => {
    expect(classifyCategories(raw, cfg).indicator).toBe(expected);
  });

  it('замечание с несколькими категориями считается по более тяжёлому показателю', () => {
    expect(classifyCategories('Орфографические и грамматические ошибки; Уточнение / корректировка информации', cfg).indicator).toBe('content');
    expect(classifyCategories('Уточнение / корректировка информации\nУчет ранее выданных замечаний', cfg).indicator).toBe('repeats');
    expect(classifyCategories('Прочее; Корректировка оформления и структуры документа', cfg).indicator).toBe('design');
  });

  it('незнакомая категория возвращается отдельно и в расчёт не идёт', () => {
    const result = classifyCategories('Совсем новая категория', cfg);
    expect(result).toEqual({ categories: [], unknown: ['совсем новая категория'], indicators: [], indicator: null });
  });
});
