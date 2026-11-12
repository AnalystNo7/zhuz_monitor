import { strFromU8, unzipSync } from 'fflate';
import type { Cell, SheetData } from '../core/types.ts';

/*
 * Минимальный читатель .xlsx: достаёт значения ячеек всех листов книги.
 * Формат — zip-архив с XML. Нужны только три части: список листов,
 * таблица общих строк и сами листы. Оформление, формулы и объекты не читаются.
 * Даты остаются числами (порядковый номер дня Excel) — их разбирает ядро.
 */

function decodeXml(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, entity: string) => {
    switch (entity) {
      case 'lt': return '<';
      case 'gt': return '>';
      case 'amp': return '&';
      case 'quot': return '"';
      case 'apos': return "'";
      default: {
        const code = entity[1] === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return String.fromCodePoint(code);
      }
    }
  });
}

/** Excel кодирует управляющие символы в строках как `_x000D_`. */
function decodeEscapes(text: string): string {
  if (!text.includes('_x')) return text;
  return text.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    result[m[1]!] = decodeXml(m[2] ?? m[3] ?? '');
  }
  return result;
}

/** Собирает текст из всех `<t>` фрагмента, пропуская фонетические подсказки. */
function richText(xml: string): string {
  let text = '';
  for (const m of xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) {
    text += m[1] ?? '';
  }
  return decodeEscapes(decodeXml(text));
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  for (const m of xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) strings.push(richText(m[1] ?? ''));
  return strings;
}

function columnIndex(ref: string): number {
  let index = 0;
  for (let i = 0; i < ref.length; i++) {
    const code = ref.charCodeAt(i);
    if (code < 65 || code > 90) break;
    index = index * 26 + (code - 64);
  }
  return index - 1;
}

function parseSheet(xml: string, sharedStrings: string[]): Cell[][] {
  const rows: Cell[][] = [];
  let nextRow = 0;
  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowAttrs = attributes(rowMatch[1] ?? '');
    const rowIndex = rowAttrs.r ? Number(rowAttrs.r) - 1 : nextRow;
    nextRow = rowIndex + 1;
    const body = rowMatch[2];
    if (!body) continue;

    const cells: Cell[] = [];
    let nextColumn = 0;
    for (const cellMatch of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = attributes(cellMatch[1] ?? '');
      const column = attrs.r ? columnIndex(attrs.r) : nextColumn;
      nextColumn = column + 1;
      const inner = cellMatch[2];
      if (inner === undefined) continue;

      const type = attrs.t ?? 'n';
      let value: Cell = null;
      if (type === 'inlineStr') {
        value = richText(inner);
      } else {
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        if (v !== undefined) {
          if (type === 's') value = sharedStrings[Number(v)] ?? null;
          else if (type === 'str' || type === 'd') value = decodeEscapes(decodeXml(v));
          else if (type === 'b') value = v === '1';
          else if (type === 'e') value = null;
          else value = v === '' ? null : Number(v);
        }
      }
      if (value === null || value === '') continue;
      while (cells.length < column) cells.push(null);
      cells[column] = value;
    }
    if (cells.length === 0) continue;
    while (rows.length < rowIndex) rows.push([]);
    rows[rowIndex] = cells;
  }
  return rows;
}

/** Приводит ссылку из связей книги к пути внутри архива. */
function resolveTarget(target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts: string[] = ['xl'];
  for (const part of target.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return parts.join('/');
}

/**
 * Читает книгу .xlsx / .xlsm и возвращает листы в порядке вкладок.
 * Бросает ошибку, если файл не является такой книгой (например, защищён паролем или это старый .xls).
 */
export function readWorkbook(data: Uint8Array): SheetData[] {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data, { filter: (file) => /^xl\/.*\.(xml|rels)$/i.test(file.name) });
  } catch {
    throw new Error('Файл не читается как книга Excel (.xlsx). Возможно, он защищён паролем или сохранён в формате .xls.');
  }
  const text = (name: string): string | null => {
    const entry = entries[name];
    // Как и положено разборщику XML, переводы строк приводятся к `\n`.
    return entry ? strFromU8(entry).replace(/\r\n?/g, '\n') : null;
  };

  const workbookXml = text('xl/workbook.xml');
  const relsXml = text('xl/_rels/workbook.xml.rels');
  if (!workbookXml || !relsXml) throw new Error('В файле нет структуры книги Excel.');

  const targets = new Map<string, string>();
  let sharedStringsPath = 'xl/sharedStrings.xml';
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const attrs = attributes(m[1] ?? '');
    if (!attrs.Id || !attrs.Target) continue;
    const path = resolveTarget(attrs.Target);
    targets.set(attrs.Id, path);
    if (attrs.Type?.endsWith('/sharedStrings')) sharedStringsPath = path;
  }

  const sharedStringsXml = text(sharedStringsPath);
  const sharedStrings = sharedStringsXml ? parseSharedStrings(sharedStringsXml) : [];

  const sheets: SheetData[] = [];
  for (const m of workbookXml.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const attrs = attributes(m[1] ?? '');
    const path = targets.get(attrs['r:id'] ?? '');
    const xml = path ? text(path) : null;
    // Листы-диаграммы и прочие нетабличные листы пропускаются.
    if (!xml || !path?.includes('worksheets/')) continue;
    sheets.push({ name: attrs.name ?? '', rows: parseSheet(xml, sharedStrings) });
  }
  return sheets;
}
