import { norm, str } from './text.ts';
import type { Cell, DocumentState, ManagerAssignments, ProjectDocument, SheetData } from './types.ts';

/*
 * Руководители проектов, назначенные вручную. Хранятся в папке с журналами
 * отдельной книгой «Проект — РП», чтобы назначения видели все, кто открывает папку.
 */

export const MANAGERS_FILE_NAME = 'РП по проектам.xlsx';
export const MANAGERS_SHEET_NAME = 'РП по проектам';
const HEADER: [string, string] = ['Проект', 'РП'];
const HEADER_SEARCH_ROWS = 10;

export function projectKey(project: string): string {
  return norm(project);
}

/**
 * Разбирает лист как таблицу назначений «Проект — РП».
 * Возвращает `null`, если на листе нет такой шапки. Перечень документов сюда не подходит:
 * в нём есть колонка «Проектный документ».
 */
export function parseManagers(sheet: SheetData): ManagerAssignments | null {
  for (let index = 0; index < Math.min(sheet.rows.length, HEADER_SEARCH_ROWS); index++) {
    const header = (sheet.rows[index] ?? []).map((c) => norm(c));
    const projectColumn = header.indexOf('проект');
    const managerColumn = header.findIndex((h) => h === 'рп' || h.startsWith('руководитель проекта'));
    if (projectColumn < 0 || managerColumn < 0) continue;
    if (header.some((h) => h.startsWith('проектный документ') || h === 'документ')) return null;

    const assignments: ManagerAssignments = new Map();
    for (const row of sheet.rows.slice(index + 1)) {
      const project = str(row[projectColumn] as Cell);
      const manager = str(row[managerColumn] as Cell);
      if (project && manager) assignments.set(projectKey(project), { project, manager });
    }
    return assignments;
  }
  return null;
}

/** Строки для записи назначений в книгу Excel, по алфавиту проектов. */
export function managersRows(assignments: ManagerAssignments): string[][] {
  const rows = [...assignments.values()]
    .filter((a) => a.manager.trim())
    .sort((a, b) => a.project.localeCompare(b.project, 'ru'))
    .map((a) => [a.project, a.manager.trim()]);
  return [HEADER, ...rows];
}

/** Подставляет назначенных вручную РП: назначение важнее значения из перечня. */
export function applyManagers(documents: ProjectDocument[], assignments: ManagerAssignments): ProjectDocument[] {
  if (assignments.size === 0) return documents;
  return documents.map((doc) => {
    const manager = assignments.get(projectKey(doc.project))?.manager.trim();
    return manager ? { ...doc, manager, managerSource: 'form' as const } : doc;
  });
}

/** Проекты, у которых нет РП ни в перечне, ни в назначениях. */
export function projectsWithoutManager(states: DocumentState[]): string[] {
  return [...new Set(states.filter((s) => !s.manager).map((s) => s.doc.project))];
}
