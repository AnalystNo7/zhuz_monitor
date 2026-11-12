import { strToU8, zipSync } from 'fflate';

/*
 * Минимальная запись .xlsx без оформления: строки и числа.
 * Используется для выгрузки результатов и для генерации демонстрационных данных.
 * Локальных зависимостей у модуля нет намеренно: его запускает и Node напрямую.
 */

export type WriteCell = string | number | boolean | null | undefined;

export interface WriteSheet {
  name: string;
  rows: WriteCell[][];
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Символы, недопустимые в XML 1.0, Excel не откроет.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

function sheetXml(rows: WriteCell[][]): string {
  let body = '';
  rows.forEach((row, r) => {
    let cells = '';
    row.forEach((value, c) => {
      if (value === null || value === undefined || value === '') return;
      const ref = `${columnName(c)}${r + 1}`;
      if (typeof value === 'number') {
        if (Number.isFinite(value)) cells += `<c r="${ref}"><v>${value}</v></c>`;
      } else if (typeof value === 'boolean') {
        cells += `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
      } else {
        cells += `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
      }
    });
    if (cells) body += `<row r="${r + 1}">${cells}</row>`;
  });
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${body}</sheetData></worksheet>`
  );
}

/** Имя листа в Excel: до 31 символа, без `\ / ? * [ ] :`. */
function sheetName(name: string, index: number): string {
  return name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || `Лист${index + 1}`;
}

export function writeWorkbook(sheets: WriteSheet[]): Uint8Array {
  const NS = 'http://schemas.openxmlformats.org';
  const files: Record<string, Uint8Array> = {};
  const add = (path: string, xml: string) => {
    files[path] = strToU8(xml);
  };
  const header = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

  add(
    '[Content_Types].xml',
    `${header}<Types xmlns="${NS}/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join('') +
      '</Types>',
  );
  add(
    '_rels/.rels',
    `${header}<Relationships xmlns="${NS}/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${NS}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      '</Relationships>',
  );
  add(
    'xl/workbook.xml',
    `${header}<workbook xmlns="${NS}/spreadsheetml/2006/main" xmlns:r="${NS}/officeDocument/2006/relationships"><sheets>` +
      sheets.map((s, i) => `<sheet name="${escapeXml(sheetName(s.name, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      '</sheets></workbook>',
  );
  add(
    'xl/_rels/workbook.xml.rels',
    `${header}<Relationships xmlns="${NS}/package/2006/relationships">` +
      sheets
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join('') +
      '</Relationships>',
  );
  sheets.forEach((sheet, i) => add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet.rows)));
  return zipSync(files, { level: 6 });
}
