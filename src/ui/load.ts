import { DEFAULT_CONFIG, type Config } from '../core/config.ts';
import { evaluate, type InputWorkbook } from '../core/pipeline.ts';
import type { Evaluation } from '../core/types.ts';
import type { SourceFolder } from '../io/folder.ts';
import { readWorkbook } from '../io/xlsx.ts';

/** Читает все книги папки и выполняет расчёт. Нечитаемые файлы попадают в журнал загрузки. */
export async function loadFolder(folder: SourceFolder, cfg: Config = DEFAULT_CONFIG): Promise<Evaluation> {
  const workbooks: InputWorkbook[] = [];
  const failed: { path: string; message: string }[] = [];
  for (const file of folder.files) {
    try {
      const { data, modified } = await file.read();
      workbooks.push({ path: file.path, sheets: readWorkbook(data), modified });
    } catch (error) {
      failed.push({ path: file.path, message: error instanceof Error ? error.message : String(error) });
    }
  }
  const result = evaluate(workbooks, cfg);
  for (const { path, message } of failed) {
    result.files.push({ path, kind: 'skipped', note: message });
    result.issues.push({ level: 'error', file: path, message });
  }
  result.files.sort((a, b) => a.path.localeCompare(b.path, 'ru'));
  return result;
}
