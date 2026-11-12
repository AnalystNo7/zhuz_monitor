import { DEFAULT_CONFIG, type Config } from './config.ts';
import { parseJournal } from './journal.ts';
import { parseRegistry } from './registry.ts';
import { computeScore } from './score.ts';
import { dateFromTimestamp, dirOf, fileKey, formatDate, mostFrequent, norm } from './text.ts';
import type {
  DocumentEval, Evaluation, Expertise, FileReport, Issue, Journal, MissingPart, Registry, Remark, SheetData,
} from './types.ts';

export interface InputWorkbook {
  /** Путь относительно выбранной папки, с разделителем `/`. */
  path: string;
  sheets: SheetData[];
  /** Время последнего изменения файла, мс. По нему определяется дата версии, если она не указана в перечне. */
  modified?: number | null;
}

function countFacts(remarks: Remark[]): { design: number; content: number; repeats: number } {
  const facts = { design: 0, content: 0, repeats: 0 };
  for (const remark of remarks) if (remark.indicator) facts[remark.indicator] += 1;
  return facts;
}

/** Расстояние между папками двух файлов в дереве каталогов: 0 — лежат рядом. */
function folderDistance(a: string, b: string): number {
  const left = dirOf(a).split('/').filter(Boolean);
  const right = dirOf(b).split('/').filter(Boolean);
  let common = 0;
  while (common < left.length && common < right.length && left[common] === right[common]) common++;
  return left.length - common + (right.length - common);
}

/**
 * Из журналов с одинаковым именем выбирает ближайший к перечню по дереву папок:
 * версии за разные периоды обычно называются одинаково и лежат в соседних папках.
 */
function closestJournal(candidates: Journal[], registryPath: string): { journal: Journal | null; ambiguous: boolean } {
  const ranked = candidates
    .map((journal) => ({ journal, distance: folderDistance(journal.path, registryPath) }))
    .sort((a, b) => a.distance - b.distance);
  const best = ranked[0];
  if (!best) return { journal: null, ambiguous: false };
  return { journal: best.journal, ambiguous: ranked[1]?.distance === best.distance };
}

function baseName(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.(xlsx|xlsm)$/i, '');
}

function lastRemarkDate(remarks: Remark[]): string | null {
  return remarks.map((r) => r.date).filter((d): d is string => d !== null).sort().pop() ?? null;
}

/** Ключ документа, общий для его версий, загруженных в разное время. */
export function documentKey(project: string, document: string, expertise: Expertise | null): string {
  return [norm(project), norm(document), expertise ?? ''].join('|');
}

/**
 * Полный расчёт по набору книг из папки: распознаёт журналы и перечни документов,
 * связывает их между собой и считает ИИКД по каждой версии каждого документа.
 */
export function evaluate(workbooks: InputWorkbook[], cfg: Config = DEFAULT_CONFIG): Evaluation {
  const journals = new Map<string, Journal>();
  const registries: Registry[] = [];
  const files: FileReport[] = [];
  const issues: Issue[] = [];
  const fileDates = new Map<string, string>();

  for (const workbook of workbooks) {
    if (typeof workbook.modified === 'number') fileDates.set(workbook.path, dateFromTimestamp(workbook.modified));
    let recognized = false;
    let incompleteRegistry = false;
    for (const sheet of workbook.sheets) {
      const journal = parseJournal(sheet, workbook.path, cfg);
      if (journal) {
        recognized = true;
        const existing = journals.get(workbook.path);
        if (existing) {
          existing.remarks.push(...journal.remarks);
          existing.issues.push(...journal.issues);
        } else {
          journals.set(workbook.path, journal);
        }
        continue;
      }
      const parsed = parseRegistry(sheet, workbook.path);
      if (parsed.kind === 'registry') {
        recognized = true;
        registries.push(parsed.registry);
        issues.push(...parsed.registry.issues);
      } else if (parsed.kind === 'incomplete') {
        incompleteRegistry = true;
      }
    }
    if (recognized) continue;
    files.push({
      path: workbook.path,
      kind: 'skipped',
      note: incompleteRegistry
        ? 'Похож на перечень документов, но в нём нет колонки «Файл ЖУЗ» — пропущен.'
        : 'Не распознан как ЖУЗ или перечень документов — пропущен.',
    });
  }

  const byName = new Map<string, Journal[]>();
  for (const journal of journals.values()) {
    const key = fileKey(journal.path);
    byName.set(key, [...(byName.get(key) ?? []), journal]);
    issues.push(...journal.issues);
  }

  const documents: DocumentEval[] = [];
  const used = new Set<string>();

  for (const registry of registries) {
    // Дата версии: указанная в перечне, иначе дата изменения файла перечня.
    const registryDate = registry.asOf ?? fileDates.get(registry.path) ?? null;
    if (!registry.asOf) {
      issues.push({
        level: 'warning',
        file: registry.path,
        message: registryDate
          ? `Над таблицей не указан отчётный период — дата версии взята по дате изменения файла (${formatDate(registryDate)}).`
          : 'Над таблицей не указан отчётный период.',
      });
    }
    files.push({
      path: registry.path,
      kind: 'registry',
      note: `Перечень документов: ${registry.rows.length}; дата данных: ${registryDate ? formatDate(registryDate) : 'не указана'}`,
    });

    const seen = new Map<string, number>();
    for (const row of registry.rows) {
      const missing: MissingPart[] = [];
      if (row.cycles === null) missing.push('cycles');

      let journal: Journal | null = null;
      const marker = norm(row.journalFile);
      const noRemarks = cfg.noRemarksMarkers.includes(marker);
      if (!noRemarks) {
        if (!marker) {
          missing.push('journal');
          issues.push({ level: 'warning', file: registry.path, row: row.row, message: `«${row.document}»: не указан файл ЖУЗ — документ не оценён.` });
        } else {
          const found = closestJournal(byName.get(fileKey(row.journalFile)) ?? [], registry.path);
          journal = found.journal;
          if (!journal) {
            missing.push('journal');
            issues.push({ level: 'error', file: registry.path, row: row.row, message: `«${row.document}»: файл ЖУЗ «${row.journalFile}» не найден в папке — документ не оценён.` });
          } else {
            used.add(journal.path);
            if (found.ambiguous) {
              issues.push({ level: 'warning', file: registry.path, row: row.row, message: `Найдено несколько одинаково расположенных файлов «${row.journalFile}», взят ${journal.path}.` });
            }
          }
        }
      }

      const remarks = journal?.remarks ?? [];
      const asOf = registryDate ?? (journal ? (fileDates.get(journal.path) ?? lastRemarkDate(remarks)) : null);
      if (!asOf) missing.push('date');

      // Одноимённые документы одного перечня — разные документы: различаем их по порядку строк.
      const project = row.project || mostFrequent(remarks.map((r) => r.project));
      const baseKey = documentKey(project, row.document, row.expertise);
      const occurrence = (seen.get(baseKey) ?? 0) + 1;
      seen.set(baseKey, occurrence);
      if (occurrence === 2) {
        issues.push({
          level: 'warning',
          file: registry.path,
          row: row.row,
          message: `В перечне несколько строк «${row.document}» с одинаковыми проектом и видом экспертизы. Версии таких документов сопоставляются по порядку строк — лучше уточнить наименования.`,
        });
      }

      const facts = journal || noRemarks ? { ...countFacts(remarks), cycles: row.cycles } : null;
      documents.push({
        id: `${registry.path}#${row.row}`,
        docKey: occurrence > 1 ? `${baseKey}#${occurrence}` : baseKey,
        asOf,
        project,
        manager: row.manager,
        developer: row.developer,
        document: row.document,
        status: row.status,
        expertise: row.expertise,
        pages: row.pages,
        registryPath: registry.path,
        journalPath: journal?.path ?? null,
        facts,
        score: facts ? computeScore(facts, cfg, row.pages) : null,
        missing,
        remarks,
      });
    }
  }

  // Журналы, на которые не ссылается ни один перечень: считаем три показателя из четырёх.
  for (const journal of journals.values()) {
    if (used.has(journal.path)) {
      files.push({ path: journal.path, kind: 'journal', note: `ЖУЗ: замечаний ${journal.remarks.length}` });
      continue;
    }
    if (journal.remarks.length === 0) {
      files.push({ path: journal.path, kind: 'skipped', note: 'ЖУЗ без замечаний, в перечне документов не указан — пропущен.' });
      continue;
    }
    files.push({ path: journal.path, kind: 'journal', note: `ЖУЗ: замечаний ${journal.remarks.length}; в перечне документов не указан` });
    const asOf = fileDates.get(journal.path) ?? lastRemarkDate(journal.remarks);
    const missing: MissingPart[] = ['registry', 'cycles'];
    if (!asOf) missing.push('date');
    const project = mostFrequent(journal.remarks.map((r) => r.project));
    const document = mostFrequent(journal.remarks.map((r) => r.document)) || baseName(journal.path);
    const facts = { ...countFacts(journal.remarks), cycles: null };
    documents.push({
      id: journal.path,
      docKey: documentKey(project, document, null),
      asOf,
      project,
      manager: '',
      developer: '',
      document,
      status: '',
      expertise: null,
      pages: null,
      registryPath: null,
      journalPath: journal.path,
      facts,
      score: computeScore(facts, cfg),
      missing,
      remarks: journal.remarks,
    });
  }

  documents.sort(
    (a, b) =>
      (a.asOf ?? '').localeCompare(b.asOf ?? '') ||
      a.project.localeCompare(b.project, 'ru') ||
      a.document.localeCompare(b.document, 'ru') ||
      a.id.localeCompare(b.id),
  );
  files.sort((a, b) => a.path.localeCompare(b.path, 'ru'));
  return { documents, files, issues };
}
