/*
 * Доступ к папке с файлами. Браузер не может прочитать папку сам:
 * пользователь выбирает её в системном диалоге, после чего страница читает файлы.
 */

export interface SourceFile {
  /** Путь относительно выбранной папки, с разделителем `/`. */
  path: string;
  read(): Promise<Uint8Array>;
}

export interface SourceFolder {
  name: string;
  files: SourceFile[];
  /** Перечитать ту же папку без повторного выбора (только при выборе через `pickFolder`). */
  reload?: () => Promise<SourceFolder>;
}

// Минимальные описания File System Access API: в стандартных типах DOM его нет.
interface FileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
}
interface DirectoryHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<FileHandle | DirectoryHandle>;
}
type PickerWindow = Window & { showDirectoryPicker?: (options?: { mode?: 'read' }) => Promise<DirectoryHandle> };

/** Книги Excel, кроме временных файлов, которые Excel создаёт рядом с открытым документом. */
export function isWorkbookName(name: string): boolean {
  return /\.(xlsx|xlsm)$/i.test(name) && !name.startsWith('~$');
}

export function canPickFolder(): boolean {
  return typeof window !== 'undefined' && typeof (window as PickerWindow).showDirectoryPicker === 'function';
}

async function walk(dir: DirectoryHandle, prefix: string, out: SourceFile[]): Promise<void> {
  for await (const entry of dir.values()) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') {
      await walk(entry, path, out);
    } else if (isWorkbookName(entry.name)) {
      out.push({ path, read: async () => new Uint8Array(await (await entry.getFile()).arrayBuffer()) });
    }
  }
}

async function readHandle(handle: DirectoryHandle): Promise<SourceFolder> {
  const files: SourceFile[] = [];
  await walk(handle, '', files);
  return { name: handle.name, files, reload: () => readHandle(handle) };
}

/** Системный диалог выбора папки (Chrome, Edge, Яндекс Браузер). Бросает `AbortError`, если пользователь отменил выбор. */
export async function pickFolder(): Promise<SourceFolder> {
  const picker = (window as PickerWindow).showDirectoryPicker;
  if (!picker) throw new Error('Браузер не поддерживает выбор папки.');
  return readHandle(await picker.call(window, { mode: 'read' }));
}

/** Запасной путь для браузеров без диалога выбора папки: `<input type="file" webkitdirectory>`. */
export function folderFromFileList(list: FileList): SourceFolder {
  const files: SourceFile[] = [];
  let name = '';
  for (const file of Array.from(list)) {
    const relative = file.webkitRelativePath || file.name;
    const slash = relative.indexOf('/');
    if (slash > 0) name ||= relative.slice(0, slash);
    if (!isWorkbookName(file.name)) continue;
    files.push({
      path: slash > 0 ? relative.slice(slash + 1) : relative,
      read: async () => new Uint8Array(await file.arrayBuffer()),
    });
  }
  return { name, files };
}
