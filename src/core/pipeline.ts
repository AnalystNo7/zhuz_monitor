import { DEFAULT_CONFIG, type Config } from './config.ts';
import { parseJournal } from './journal.ts';
import { emptyManualData, parseDocumentOverrides, parseManagers } from './manual.ts';
import { parseRegistry } from './registry.ts';
import { dateFromTimestamp, dirOf, fileKey, formatDate, norm } from './text.ts';
import type {
  DocumentOverride, Evaluation, FileReport, Issue, Journal, ManagerAssignments, Passport, ProjectDocument, Registry, SheetData,
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

/** Какая доля журнала `older` уже есть в журнале `newer`, чтобы считать его ранней копией. */
const COPY_SHARE = 0.8;

/** Доля замечаний журнала `older`, тексты которых есть в журнале `newer`. */
function containedShare(older: Journal, newer: Journal): number {
  const texts = new Set(newer.remarks.map((r) => norm(r.text)).filter(Boolean));
  const own = older.remarks.map((r) => norm(r.text)).filter(Boolean);
  if (own.length === 0) return 1;
  return own.filter((t) => texts.has(t)).length / own.length;
}

function lastSegment(path: string): string {
  return path.split(/[\\/]/).map((s) => s.trim()).filter(Boolean).pop() ?? '';
}

/**
 * Подписи версий для документов проекта с одинаковым наименованием: последняя папка
 * из ссылки в перечне, иначе имя файла журнала. Если подписи совпадают — добавляется номер.
 */
function assignVariants(documents: ProjectDocument[]): void {
  const groups = new Map<string, ProjectDocument[]>();
  for (const doc of documents) {
    const key = pairKey(doc.project, doc.name);
    groups.set(key, [...(groups.get(key) ?? []), doc]);
  }
  const sources = [
    (doc: ProjectDocument) => lastSegment(doc.passports[doc.passports.length - 1]?.folderLink ?? ''),
    (doc: ProjectDocument) => (doc.journalPath ? baseName(doc.journalPath) : ''),
  ];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? '') || a.key.localeCompare(b.key));
    const distinct = sources.find((source) => {
      const labels = group.map(source);
      return labels.every(Boolean) && new Set(labels.map((l) => norm(l))).size === labels.length;
    });
    if (distinct) {
      for (const doc of group) doc.variant = distinct(doc);
      continue;
    }
    const base = group.map((doc) => sources.map((source) => source(doc)).find(Boolean) ?? '');
    const total = new Map<string, number>();
    for (const label of base) total.set(norm(label), (total.get(norm(label)) ?? 0) + 1);
    const counter = new Map<string, number>();
    group.forEach((doc, i) => {
      const label = base[i]!;
      if (label && total.get(norm(label)) === 1) {
        doc.variant = label;
        return;
      }
      const n = (counter.get(norm(label)) ?? 0) + 1;
      counter.set(norm(label), n);
      doc.variant = label ? `${label} №${n}` : `№${n}`;
    });
  }
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

/** Книга ручного ввода: назначения РП и (или) статусы и циклы документов. */
interface ManualFile {
  path: string;
  modified: number;
  managers: ManagerAssignments;
  documents: Map<string, DocumentOverride>;
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
  const manualFiles = new Map<string, ManualFile>();
  const manualFile = (workbook: InputWorkbook): ManualFile => {
    const existing = manualFiles.get(workbook.path);
    if (existing) return existing;
    const created: ManualFile = { path: workbook.path, modified: workbook.modified ?? 0, managers: new Map(), documents: new Map() };
    manualFiles.set(workbook.path, created);
    return created;
  };

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
        for (const [key, value] of assignments) manualFile(workbook).managers.set(key, value);
        continue;
      }
      const overrides = parseDocumentOverrides(sheet);
      if (overrides) {
        recognized = true;
        for (const [key, value] of overrides) manualFile(workbook).documents.set(key, value);
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

  // Журнал документа один и только пополняется. Если в папке несколько журналов с той же связкой
  // «проект — документ», журнал, чьи замечания почти все есть в более полном, — его ранняя копия.
  // Журнал с другими замечаниями относится к другой версии документа (например, по другому заказу).
  const identityOf = (journal: Journal): string =>
    journal.project || journal.document ? pairKey(journal.project, journal.document) : `file:${journal.path}`;
  const fuller = (a: Journal, b: Journal): number =>
    b.remarks.length - a.remarks.length ||
    b.rowCount - a.rowCount ||
    (fileDates.get(b.path) ?? '').localeCompare(fileDates.get(a.path) ?? '') ||
    a.path.localeCompare(b.path);

  const byIdentity = new Map<string, Journal[]>();
  for (const journal of journals.values()) {
    if (journal.remarks.length === 0) {
      files.push({ path: journal.path, kind: 'skipped', note: 'ЖУЗ без замечаний — пропущен.' });
      continue;
    }
    const identity = identityOf(journal);
    byIdentity.set(identity, [...(byIdentity.get(identity) ?? []), journal]);
  }

  const actualByPair = new Map<string, Journal[]>(); // связка «проект — документ» → актуальные журналы версий
  const actualOf = new Map<string, Journal>(); // путь любой копии → актуальный журнал
  for (const [identity, group] of byIdentity) {
    const versions: { primary: Journal; older: Journal[] }[] = [];
    for (const journal of [...group].sort(fuller)) {
      const version = versions.find((v) => containedShare(journal, v.primary) >= COPY_SHARE);
      if (version) version.older.push(journal);
      else versions.push({ primary: journal, older: [] });
    }
    actualByPair.set(identity, versions.map((v) => v.primary));
    for (const { primary, older } of versions) {
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
    if (versions.length > 1) {
      const sample = versions[0]!.primary;
      issues.push({
        level: 'info',
        file: sample.path,
        message: `Журналов документа «${sample.document}» проекта «${sample.project}» с разными замечаниями: ${versions.length}. Они считаются разными версиями документа.`,
      });
    }
  }

  const byName = new Map<string, Journal[]>();
  for (const path of actualOf.keys()) {
    const key = fileKey(path);
    byName.set(key, [...(byName.get(key) ?? []), journals.get(path)!]);
  }
  /** Из нескольких журналов — ближайший к перечню по дереву папок; `ambiguous`, если таких несколько. */
  const closest = (candidates: Journal[], registryPath: string): { journal: Journal | null; ambiguous: boolean } => {
    const ranked = candidates
      .map((journal) => ({ journal, distance: folderDistance(journal.path, registryPath) }))
      .sort((a, b) => a.distance - b.distance);
    return { journal: ranked[0]?.journal ?? null, ambiguous: ranked.length > 1 && ranked[1]!.distance === ranked[0]!.distance };
  };
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
        const pair = closest(actualByPair.get(pairKey(row.project, row.document)) ?? [], registry.path);
        const byPair = pair.journal;
        if (!marker && pair.ambiguous) {
          issues.push({ level: 'warning', ...where, message: `«${row.document}»: журналов с таким проектом и документом несколько (версии документа). Укажите в перечне имя файла ЖУЗ.` });
        }
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

      // Документ определяется своим журналом; без журнала — связкой «проект — документ» и папкой:
      // одноимённые документы в разных папках — разные версии (например, по разным заказам).
      let key = journal ? `journal:${journal.path}` : `row:${pairKey(row.project, row.document)}|${norm(row.folderLink)}`;
      const occurrence = (seen.get(key) ?? 0) + 1;
      seen.set(key, occurrence);
      if (occurrence > 1) {
        if (journal) {
          issues.push({ level: 'warning', ...where, message: `«${row.document}»: на журнал ${journal.path} ссылается несколько строк перечня. У каждого документа должен быть свой ЖУЗ.` });
        } else {
          if (occurrence === 2) {
            issues.push({
              level: 'warning',
              ...where,
              message:
                `В перечне несколько строк «${row.document}» с одинаковыми проектом и папкой. Если это разные версии документа, ` +
                'укажите версию в наименовании (например, «…, версия 2») или разные ссылки на папку.',
            });
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
        folderLink: row.folderLink,
        cycles: row.cycles,
        pages: row.pages,
      });
    }
  }

  // Журналы, которых нет ни в одном перечне.
  const linked = new Set([...drafts.values()].map((d) => d.journal?.path).filter(Boolean));
  for (const journal of [...actualByPair.values()].flat()) {
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
    if (!inRegistry) draftFor(`journal:${journal.path}`, journal);
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
      variant: '',
      manager,
      managerSource: manager ? ('registry' as const) : null,
      // Точка отсчёта — первое замечание; для документа без замечаний — дата перечня.
      startDate: firstRemark ?? firstPassport ?? (journal ? (fileDates.get(journal.path) ?? null) : null),
      passports,
      journalPath: journal?.path ?? null,
      remarks,
      journalMissing: journal === null && !draft.noRemarks,
      uncategorizedRows: journal?.uncategorizedRows ?? [],
      manual: null,
    };
  });

  assignVariants(documents);
  documents.sort(
    (a, b) =>
      a.project.localeCompare(b.project, 'ru') ||
      a.name.localeCompare(b.name, 'ru') ||
      a.variant.localeCompare(b.variant, 'ru', { numeric: true }) ||
      a.key.localeCompare(b.key),
  );
  // Ручной ввод: если файлов несколько, более поздний дополняет и переопределяет ранние.
  const manual = emptyManualData();
  const ordered = [...manualFiles.values()].sort((a, b) => a.modified - b.modified || a.path.localeCompare(b.path));
  for (const file of ordered) {
    for (const [key, value] of file.managers) manual.managers.set(key, value);
    for (const [key, value] of file.documents) manual.documents.set(key, value);
    files.push({ path: file.path, kind: 'manual', note: `Ручной ввод: РП проектов ${file.managers.size}, документов со статусом или циклами ${file.documents.size}` });
  }
  if (ordered.length > 1) {
    issues.push({
      level: 'warning',
      file: ordered[ordered.length - 1]!.path,
      message: `В папке ${ordered.length} файла ручного ввода. При совпадении проектов и документов действует файл, изменённый позже.`,
    });
  }

  files.sort((a, b) => a.path.localeCompare(b.path, 'ru'));
  return { documents, manual, manualPath: ordered[ordered.length - 1]?.path ?? null, files, issues };
}

