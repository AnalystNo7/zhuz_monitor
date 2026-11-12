import { DEFAULT_CONFIG, type Config } from './config.ts';
import { parseJournal } from './journal.ts';
import { parseRegistry } from './registry.ts';
import { computeScore } from './score.ts';
import { dirOf, fileKey, mostFrequent, norm, periodFromDate } from './text.ts';
import type {
  DocumentEval, Evaluation, FileReport, Issue, Journal, MissingPart, Registry, Remark, SheetData,
} from './types.ts';

export interface InputWorkbook {
  /** Путь относительно выбранной папки, с разделителем `/`. */
  path: string;
  sheets: SheetData[];
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
 * файлы за разные периоды обычно называются одинаково и лежат в соседних папках.
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

/**
 * Полный расчёт по набору книг из папки: распознаёт журналы и перечни документов,
 * связывает их между собой и считает ИИКД по каждому документу.
 */
export function evaluate(workbooks: InputWorkbook[], cfg: Config = DEFAULT_CONFIG): Evaluation {
  const journals = new Map<string, Journal>();
  const registries: Registry[] = [];
  const files: FileReport[] = [];
  const issues: Issue[] = [];

  for (const workbook of workbooks) {
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
        files.push({
          path: workbook.path,
          kind: 'registry',
          note: `Перечень документов: ${parsed.registry.rows.length}, период: ${parsed.registry.period?.label ?? 'не указан'}`,
        });
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
    for (const row of registry.rows) {
      const missing: MissingPart[] = [];
      if (!registry.period) missing.push('period');
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
      const facts = journal || noRemarks ? { ...countFacts(remarks), cycles: row.cycles } : null;
      documents.push({
        id: `${registry.path}#${row.row}`,
        period: registry.period,
        project: row.project || mostFrequent(remarks.map((r) => r.project)),
        manager: row.manager,
        developer: row.developer,
        document: row.document,
        status: row.status,
        internal: row.internal,
        external: row.external,
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
    const lastDate = journal.remarks.map((r) => r.date).filter((d): d is string => d !== null).sort().pop();
    const period = lastDate ? periodFromDate(lastDate) : null;
    const missing: MissingPart[] = ['registry', 'cycles'];
    if (!period) missing.push('period');
    const facts = { ...countFacts(journal.remarks), cycles: null };
    documents.push({
      id: journal.path,
      period,
      project: mostFrequent(journal.remarks.map((r) => r.project)),
      manager: '',
      developer: '',
      document: mostFrequent(journal.remarks.map((r) => r.document)) || baseName(journal.path),
      status: '',
      internal: null,
      external: null,
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
      (a.period?.key ?? '').localeCompare(b.period?.key ?? '') ||
      a.project.localeCompare(b.project, 'ru') ||
      a.document.localeCompare(b.document, 'ru'),
  );
  files.sort((a, b) => a.path.localeCompare(b.path, 'ru'));
  return { documents, files, issues };
}
