import type { Config } from './config.ts';
import { computeScore } from './score.ts';
import { bucketOf, nextPeriod } from './text.ts';
import type { DocumentState, Granularity, MissingPart, Passport, Period, ProjectDocument, Remark } from './types.ts';

/*
 * Журнал документа один и только пополняется, у каждого замечания есть дата.
 * Поэтому состояние документа на любую прошлую дату восстанавливается из актуального
 * журнала: учитываются замечания, выданные не позже этой даты. Отдельных «снимков»
 * журнала за каждый период хранить не нужно.
 */

/** Дата, с которой замечание учитывается; замечание без даты относится к началу документа. */
function effectiveDate(remark: Remark, doc: ProjectDocument): string {
  return remark.date ?? doc.startDate ?? '';
}

/** Сведения из перечня, действовавшие на дату: последний перечень не позже неё, иначе самый ранний. */
function passportAt(doc: ProjectDocument, asOf: string | null): Passport | null {
  const { passports } = doc;
  if (passports.length === 0) return null;
  if (asOf === null) return passports[passports.length - 1]!;
  let found: Passport | null = null;
  for (const passport of passports) if ((passport.asOf ?? '') <= asOf) found = passport;
  return found ?? passports[0]!;
}

/**
 * Состояние документа на дату. `asOf = null` — текущее состояние по всем данным.
 * Возвращает `null`, если документ к этой дате ещё не начат.
 */
export function stateAt(doc: ProjectDocument, asOf: string | null, cfg: Config): DocumentState | null {
  if (asOf !== null && (doc.startDate === null || doc.startDate > asOf)) return null;

  const passport = passportAt(doc, asOf);
  const remarks = asOf === null ? doc.remarks : doc.remarks.filter((r) => effectiveDate(r, doc) <= asOf);

  const missing: MissingPart[] = [];
  if (doc.journalMissing) missing.push('journal');
  if (doc.uncategorizedRows.length > 0) missing.push('categories');
  if (doc.startDate === null) missing.push('date');
  const blocked = doc.journalMissing || doc.uncategorizedRows.length > 0;

  // Число циклов: из перечня, а без него — по журналу, сколько циклов началось к дате.
  // Документ, согласованный без замечаний, прошёл один цикл.
  const registryCycles = passport?.cycles ?? null;
  const cycles = registryCycles ?? Math.max(1, ...remarks.map((r) => r.cycle));

  let facts: DocumentState['facts'] = null;
  if (!blocked) {
    facts = { design: 0, content: 0, repeats: 0, cycles };
    for (const remark of remarks) if (remark.indicator) facts[remark.indicator] += 1;
  }
  return {
    doc,
    asOf,
    manager: doc.manager,
    developer: passport?.developer ?? '',
    status: passport?.status ?? '',
    remarkCount: remarks.length,
    cyclesSource: registryCycles === null ? 'journal' : 'registry',
    facts,
    score: facts ? computeScore(facts, cfg, passport?.pages ?? null) : null,
    missing,
  };
}

/** Состояния всех документов, начатых к дате. */
export function statesAt(documents: ProjectDocument[], asOf: string | null, cfg: Config): DocumentState[] {
  const states: DocumentState[] = [];
  for (const doc of documents) {
    const state = stateAt(doc, asOf, cfg);
    if (state) states.push(state);
  }
  return states;
}

/** Все даты, когда у документа что-то менялось: новые замечания или новый перечень. */
function eventDates(doc: ProjectDocument): string[] {
  const dates = new Set<string>();
  if (doc.startDate) dates.add(doc.startDate);
  for (const remark of doc.remarks) {
    const date = effectiveDate(remark, doc);
    if (date) dates.add(date);
  }
  for (const passport of doc.passports) {
    if (passport.asOf && (!doc.startDate || passport.asOf >= doc.startDate)) dates.add(passport.asOf);
  }
  return [...dates].sort();
}

/**
 * Периоды выбранной детализации без пропусков: от начала самого раннего документа
 * до последнего события. Итог нарастающий, поэтому значение есть в каждом периоде.
 */
export function listPeriods(documents: ProjectDocument[], granularity: Granularity): Period[] {
  const dates = documents.flatMap(eventDates).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (!first || !last) return [];
  const periods: Period[] = [];
  for (let period = bucketOf(first, granularity); period.end <= bucketOf(last, granularity).end; period = nextPeriod(period, granularity)) {
    periods.push(period);
  }
  return periods;
}

/**
 * История документа: состояние на каждую дату, когда оно менялось.
 * Соответствует версиям журнала: «было 5 замечаний — стало 11».
 */
export function history(doc: ProjectDocument, cfg: Config): DocumentState[] {
  const states: DocumentState[] = [];
  for (const date of eventDates(doc)) {
    const state = stateAt(doc, date, cfg);
    if (!state) continue;
    const previous = states[states.length - 1];
    const unchanged =
      previous &&
      previous.remarkCount === state.remarkCount &&
      previous.score?.iikd === state.score?.iikd &&
      previous.status === state.status;
    if (!unchanged) states.push(state);
  }
  return states;
}
