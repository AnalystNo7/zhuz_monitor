import { formatDate, norm, parseDate, str } from './text.ts';
import type { Cell, DocumentOverride, ManagerAssignments, ManualData, ProjectDocument, SheetData } from './types.ts';

/*
 * Данные, введённые вручную в форме: РП по проектам, статус и число циклов по документам.
 * Хранятся в папке с журналами отдельной книгой, чтобы их видели все, кто открывает папку.
 */

export const MANUAL_FILE_NAME = 'Мониторинг ПД - ручной ввод.xlsx';
export const MANAGERS_SHEET = 'РП по проектам';
export const DOCUMENTS_SHEET = 'Документы';
const MANAGERS_HEADER = ['Проект', 'РП'];
const DOCUMENTS_HEADER = ['Проект', 'Документ', 'Статус', 'Циклы согласования', 'Изменено'];
const HEADER_SEARCH_ROWS = 10;

export function projectKey(project: string): string {
  return norm(project);
}

/** Ключ документа: связка «проект — документ». */
export function documentKey(project: string, document: string): string {
  return `${norm(project)}|${norm(document)}`;
}

export function emptyManualData(): ManualData {
  return { managers: new Map(), documents: new Map() };
}

function findHeader(sheet: SheetData, test: (header: string[]) => boolean): { index: number; header: string[] } | null {
  for (let index = 0; index < Math.min(sheet.rows.length, HEADER_SEARCH_ROWS); index++) {
    const header = (sheet.rows[index] ?? []).map((c) => norm(c));
    if (test(header)) return { index, header };
  }
  return null;
}

/**
 * Разбирает лист как таблицу назначений «Проект — РП».
 * Возвращает `null`, если на листе нет такой шапки. Перечень документов сюда не подходит:
 * в нём есть колонка с документом.
 */
export function parseManagers(sheet: SheetData): ManagerAssignments | null {
  const found = findHeader(sheet, (h) => h.includes('проект') && h.some((x) => x === 'рп' || x.startsWith('руководитель проекта')));
  if (!found || found.header.some((h) => h.startsWith('проектный документ') || h === 'документ')) return null;
  const projectColumn = found.header.indexOf('проект');
  const managerColumn = found.header.findIndex((h) => h === 'рп' || h.startsWith('руководитель проекта'));

  const assignments: ManagerAssignments = new Map();
  for (const row of sheet.rows.slice(found.index + 1)) {
    const project = str(row[projectColumn] as Cell);
    const manager = str(row[managerColumn] as Cell);
    if (project && manager) assignments.set(projectKey(project), { project, manager });
  }
  return assignments;
}

function positiveInteger(v: Cell | undefined): number | null {
  const n = typeof v === 'number' ? v : Number(str(v).replace(',', '.'));
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/**
 * Разбирает лист ручных статусов и циклов: «Проект — Документ — Статус — Циклы — Изменено».
 * Возвращает `null`, если на листе нет такой шапки.
 */
export function parseDocumentOverrides(sheet: SheetData): Map<string, DocumentOverride> | null {
  const found = findHeader(sheet, (h) => h.includes('проект') && h.includes('документ') && h.some((x) => x === 'статус' || x.startsWith('циклы')));
  // Журнал и перечень документов сюда не подходят: в них есть замечания или РП.
  if (!found || found.header.some((h) => h.startsWith('состав замечания') || h === 'рп')) return null;
  const column = (test: (h: string) => boolean) => found.header.findIndex(test);
  const projectColumn = column((h) => h === 'проект');
  const documentColumn = column((h) => h === 'документ');
  const statusColumn = column((h) => h === 'статус');
  const cyclesColumn = column((h) => h.startsWith('циклы'));
  const updatedColumn = column((h) => h.startsWith('изменено'));

  const overrides = new Map<string, DocumentOverride>();
  for (const row of sheet.rows.slice(found.index + 1)) {
    const project = str(row[projectColumn] as Cell);
    const document = str(row[documentColumn] as Cell);
    if (!document) continue;
    const override: DocumentOverride = {
      project,
      document,
      status: statusColumn < 0 ? '' : str(row[statusColumn] as Cell),
      cycles: cyclesColumn < 0 ? null : positiveInteger(row[cyclesColumn]),
      updated: updatedColumn < 0 ? null : parseDate(row[updatedColumn]),
    };
    if (override.status || override.cycles !== null) overrides.set(documentKey(project, document), override);
  }
  return overrides;
}

/** Листы книги ручного ввода для записи в Excel. Пустые назначения не записываются. */
export function manualSheets(data: ManualData): { name: string; rows: (string | number | null)[][] }[] {
  const byProject = (a: { project: string }, b: { project: string }) => a.project.localeCompare(b.project, 'ru');
  const managers = [...data.managers.values()]
    .filter((a) => a.manager.trim())
    .sort(byProject)
    .map((a) => [a.project, a.manager.trim()]);
  const documents = [...data.documents.values()]
    .filter((d) => d.status.trim() || d.cycles !== null)
    .sort((a, b) => byProject(a, b) || a.document.localeCompare(b.document, 'ru'))
    .map((d) => [d.project, d.document, d.status.trim() || null, d.cycles, d.updated ? formatDate(d.updated) : null]);
  return [
    { name: MANAGERS_SHEET, rows: [MANAGERS_HEADER, ...managers] },
    { name: DOCUMENTS_SHEET, rows: [DOCUMENTS_HEADER, ...documents] },
  ];
}

/** Подставляет введённое вручную: РП проекта, статус и циклы документа. Ручное важнее перечня. */
export function applyManual(documents: ProjectDocument[], data: ManualData): ProjectDocument[] {
  if (data.managers.size === 0 && data.documents.size === 0) return documents;
  return documents.map((doc) => {
    const manager = data.managers.get(projectKey(doc.project))?.manager.trim();
    const override = data.documents.get(documentKey(doc.project, doc.name)) ?? null;
    if (!manager && !override) return doc;
    return {
      ...doc,
      ...(manager ? { manager, managerSource: 'form' as const } : {}),
      manual: override,
    };
  });
}
