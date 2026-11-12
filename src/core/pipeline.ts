import { DEFAULT_CONFIG, type Config } from './config.ts';
import { parseJournal } from './journal.ts';
import { parseManagers } from './managers.ts';
import { parseRegistry } from './registry.ts';
import { dateFromTimestamp, dirOf, fileKey, formatDate, norm } from './text.ts';
import type {
  Evaluation, FileReport, Issue, Journal, ManagerAssignments, Passport, ProjectDocument, Registry, SheetData,
} from './types.ts';

export interface InputWorkbook {
  /** Путь относительно выбранной папки, с разделителем `/`. */
  path: string;
  sheets: SheetData[];
  /** Время последнего изменения файла, мс. */
  modified?: number | null;
}

/** Расстояние между папками двух файлов в дереве каталогов: 0 — лежат рядом. */
function folderDistance(a: string, b: string): number {
  const left = dirOf(a).split('/').filter(Boolean);
  const right = dirOf(b).split('/').filter(Boolean);
  let common = 0;
  while (common < left.length && common < right.length && left[common] === right[common]) common++;
  return left.length - common + (right.length - common);
}

function baseName(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.(xlsx|xlsm)$/i, '');
}

/** Связка «проект — документ»: у каждого документа проекта один журнал. */
export function pairKey(project: string, document: string): string {
  return `${norm(project)}|${norm(document)}`;
}

interface DocumentDraft {
  key: string;
  journal: Journal | null;
  passports: Passport[];
  /** Хотя бы один перечень отметил документ как согласованный без замечаний. */
  noRemarks: boolean;
}

interface ManagersFile {
  path: string;
  modified: number;
  assignments: ManagerAssignments;
}

/**
 * Полный разбор набора книг из папки: распознаёт журналы и перечни документов,
 * отбирает актуальную копию каждого журнала и связывает журналы с перечнями.
 */
export function evaluate(workbooks: InputWorkbook[], cfg: Config = DEFAULT_CONFIG): Evaluation {
  const journals = new Map<string, Journal>();
  const registries: Registry[] = [];
  const files: FileReport[] = [];
  const issues: Issue[] = [];
  const fileDates = new Map<string, string>();
  const managersFiles: ManagersFile[] = [];

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
          existing.rowCount += journal.rowCount;
          existing.project ||= journal.project;
          existing.document ||= journal.document;
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
        continue;
      }
      if (parsed.kind === 'incomplete') {
        incompleteRegistry = true;
        continue;
      }
      const assignments = parseManagers(sheet);
      if (assignments) {
        recognized = true;
        managersFiles.push({ path: workbook.path, modified: workbook.modified ?? 0, assignments });
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

  // Журнал документа один и только пополняется. Если в папке лежит несколько его копий,
  // актуальной считается самая полная, остальные — более ранние версии.
  const identityOf = (journal: Journal): string =>
    journal.project || journal.document ? pairKey(journal.project, journal.document) : `file:${journal.path}`;
  const fuller = (a: Journal, b: Journal): number =>
    b.remarks.length - a.remarks.length ||
    b.rowCount - a.rowCount ||
    (fileDates.get(b.path) ?? '').localeCompare(fileDates.get(a.path) ?? '') ||
    a.path.localeCompare(b.path);

  const copies = new Map<string, Journal[]>();
  for (const journal of journals.values()) {
    if (journal.remarks.length === 0) {
      files.push({ path: journal.path, kind: 'skipped', note: 'ЖУЗ без замечаний — пропущен.' });
      continue;
    }
    const identity = identityOf(journal);
    copies.set(identity, [...(copies.get(identity) ?? []), journal]);
  }

  const actual = new Map<string, Journal>(); // связка «проект — документ» → актуальный журнал
  const actualOf = new Map<string, Journal>(); // путь любой копии → актуальный журнал
  for (const [identity, group] of copies) {
    group.sort(fuller);
    const [primary, ...older] = group as [Journal, ...Journal[]];
    actual.set(identity, primary);
    actualOf.set(primary.path, primary);
    issues.push(...primary.issues);
    for (const copy of older) {
      actualOf.set(copy.path, primary);
      files.push({
        path: copy.path,
        kind: 'skipped',
        note: `Более ранняя копия журнала (замечаний ${copy.remarks.length}, в актуальной — ${primary.remarks.length}): не учитывается. Актуальная: ${primary.path}`,
      });
    }
  }

  const byName = new Map<string, Journal[]>();
  for (const path of actualOf.keys()) {
    const key = fileKey(path);
    byName.set(key, [...(byName.get(key) ?? []), journals.get(path)!]);
  }
  /** Журнал по имени файла; из одноимённых — ближайший к перечню по дереву папок. */
  const findByName = (name: string, registryPath: string): Journal | null => {
    const ranked = (byName.get(fileKey(name)) ?? [])
      .map((journal) => ({ journal, distance: folderDistance(journal.path, registryPath) }))
      .sort((a, b) => a.distance - b.distance);
    return ranked[0] ? actualOf.get(ranked[0].journal.path)! : null;
  };

  const drafts = new Map<string, DocumentDraft>();
  const draftFor = (key: string, journal: Journal | null): DocumentDraft => {
    const existing = drafts.get(key);
    if (existing) return existing;
    const created: DocumentDraft = { key, journal, passports: [], noRemarks: false };
    drafts.set(key, created);
    return created;
  };

  // Перечни обрабатываются от ранних к поздним: сведения из них образуют историю документа.
  const dated = registries
    .map((registry) => ({ registry, date: registry.asOf ?? fileDates.get(registry.path) ?? null }))
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.registry.path.localeCompare(b.registry.path));

  for (const { registry, date } of dated) {
    if (!registry.asOf) {
      issues.push({
        level: 'warning',
        file: registry.path,
        message: date
          ? `Над таблицей не указана дата перечня — взята дата изменения файла (${formatDate(date)}).`
          : 'Над таблицей не указана дата перечня.',
      });
    }
    files.push({
      path: registry.path,
      kind: 'registry',
      note: `Перечень документов: ${registry.rows.length}; дата данных: ${date ? formatDate(date) : 'не указана'}`,
    });

    const seen = new Map<string, number>();
    for (const row of registry.rows) {
      const where = { file: registry.path, row: row.row };
      const marker = norm(row.journalFile);
      const noRemarks = cfg.noRemarksMarkers.includes(marker);

      let journal: Journal | null = null;
      if (!noRemarks) {
        const byPair = actual.get(pairKey(row.project, row.document)) ?? null;
        if (marker) {
          journal = findByName(row.journalFile, registry.path) ?? byPair;
          if (!journal) {
            issues.push({ level: 'error', ...where, message: `«${row.document}»: файл ЖУЗ «${row.journalFile}» не найден в папке — документ не оценён.` });
          }
        } else {
          journal = byPair;
          if (!journal) {
            issues.push({ level: 'warning', ...where, message: `«${row.document}»: не указан файл ЖУЗ, и журнал с таким проектом и документом не найден — документ не оценён.` });
          }
        }
      }

      // Документ определяется своим журналом; без журнала — связкой «проект — документ».
      let key = journal ? `journal:${identityOf(journal)}` : `row:${pairKey(row.project, row.document)}`;
      const occurrence = (seen.get(key) ?? 0) + 1;
      seen.set(key, occurrence);
      if (occurrence > 1) {
        if (journal) {
          issues.push({ level: 'warning', ...where, message: `«${row.document}»: на журнал ${journal.path} ссылается несколько строк перечня. У каждого документа должен быть свой ЖУЗ.` });
        } else {
          if (occurrence === 2) {
            issues.push({ level: 'warning', ...where, message: `В перечне несколько строк «${row.document}» с одинаковым проектом. Наименование документа в проекте должно быть уникальным.` });
          }
          key = `${key}#${occurrence}`;
        }
      }

      const draft = draftFor(key, journal);
      draft.journal ??= journal;
      draft.noRemarks ||= noRemarks;
      draft.passports.push({
        asOf: date,
        registryPath: registry.path,
        row: row.row,
        project: row.project,
        document: row.document,
        manager: row.manager,
        developer: row.developer,
        status: row.status,
        cycles: row.cycles,
        pages: row.pages,
      });
    }
  }

  // Журналы, которых нет ни в одном перечне.
  const linked = new Set([...drafts.values()].map((d) => d.journal?.path).filter(Boolean));
  for (const journal of actual.values()) {
    const inRegistry = linked.has(journal.path);
    const duplicates = journal.rowCount - journal.remarks.length;
    files.push({
      path: journal.path,
      kind: 'journal',
      note:
        `ЖУЗ: замечаний ${journal.remarks.length}` +
        (duplicates > 0 ? ` (строк ${journal.rowCount}, повторы объединены)` : '') +
        (inRegistry ? '' : '; в перечне документов не указан'),
    });
    if (!inRegistry) draftFor(`journal:${identityOf(journal)}`, journal);
  }

  const documents: ProjectDocument[] = [...drafts.values()].map((draft) => {
    const { journal, passports } = draft;
    const latest = passports[passports.length - 1];
    const manager = [...passports].reverse().find((p) => p.manager)?.manager ?? '';
    const remarks = journal?.remarks ?? [];
    const firstRemark = remarks.map((r) => r.date).filter((d): d is string => d !== null).sort()[0];
    const firstPassport = passports.map((p) => p.asOf).filter((d): d is string => d !== null).sort()[0];
    return {
      key: draft.key,
      project: latest?.project || journal?.project || '',
      name: latest?.document || journal?.document || (journal ? baseName(journal.path) : ''),
      manager,
      managerSource: manager ? ('registry' as const) : null,
      // Точка отсчёта — первое замечание; для документа без замечаний — дата перечня.
      startDate: firstRemark ?? firstPassport ?? (journal ? (fileDates.get(journal.path) ?? null) : null),
      passports,
      journalPath: journal?.path ?? null,
      remarks,
      journalMissing: journal === null && !draft.noRemarks,
      uncategorizedRows: journal?.uncategorizedRows ?? [],
    };
  });

  documents.sort((a, b) => a.project.localeCompare(b.project, 'ru') || a.name.localeCompare(b.name, 'ru') || a.key.localeCompare(b.key));
  // Назначения РП: если файлов несколько, более поздний дополняет и переопределяет ранние.
  const managers: ManagerAssignments = new Map();
  managersFiles.sort((a, b) => a.modified - b.modified || a.path.localeCompare(b.path));
  for (const file of managersFiles) {
    for (const [key, value] of file.assignments) managers.set(key, value);
    files.push({ path: file.path, kind: 'managers', note: `Назначения РП: проектов ${file.assignments.size}` });
  }
  if (managersFiles.length > 1) {
    issues.push({
      level: 'warning',
      file: managersFiles[managersFiles.length - 1]!.path,
      message: `В папке ${managersFiles.length} файла с назначениями РП. При совпадении проектов действует файл, изменённый позже.`,
    });
  }

  files.sort((a, b) => a.path.localeCompare(b.path, 'ru'));
  return { documents, managers, managersPath: managersFiles[managersFiles.length - 1]?.path ?? null, files, issues };
}

