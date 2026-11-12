/*
 * Доступ к папке с файлами. Браузер не может прочитать папку сам:
 * пользователь выбирает её в системном диалоге, после чего страница читает файлы.
 */

export interface SourceFile {
  /** Путь относительно выбранной папки, с разделителем `/`. */
  path: string;
  /** Содержимое и время последнего изменения файла (мс). */
  read(): Promise<{ data: Uint8Array; modified: number }>;
}

export interface SourceFolder {
  name: string;
  files: SourceFile[];
  /** Перечитать ту же папку без повторного выбора (только при выборе через `pickFolder`). */
  reload?: () => Promise<SourceFolder>;
  /**
   * Записать файл в корень папки (только при выборе через `pickFolder`).
   * Браузер спросит разрешение на изменение файлов; при отказе бросает ошибку.
   */
  save?: (name: string, data: Uint8Array) => Promise<void>;
}

// Минимальные описания File System Access API: в стандартных типах DOM его нет.
interface WritableStream {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}
interface FileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<WritableStream>;
}
interface DirectoryHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<FileHandle | DirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandle>;
  requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
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
      out.push({
        path,
        read: async () => {
          const file = await entry.getFile();
          return { data: new Uint8Array(await file.arrayBuffer()), modified: file.lastModified };
        },
      });
    }
  }
}

async function saveToHandle(handle: DirectoryHandle, name: string, data: Uint8Array): Promise<void> {
  const permission = handle.requestPermission ? await handle.requestPermission({ mode: 'readwrite' }) : 'granted';
  if (permission !== 'granted') throw new Error('Нет разрешения на запись в папку.');
  const writable = await (await handle.getFileHandle(name, { create: true })).createWritable();
  await writable.write(data);
  await writable.close();
}

async function readHandle(handle: DirectoryHandle): Promise<SourceFolder> {
  const files: SourceFile[] = [];
  await walk(handle, '', files);
  return {
    name: handle.name,
    files,
    reload: () => readHandle(handle),
    save: (name, data) => saveToHandle(handle, name, data),
  };
}

/** Отдаёт файл на скачивание: запасной путь, когда записать в папку нельзя. */
export function downloadFile(name: string, data: Uint8Array, type: string): void {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
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
      read: async () => ({ data: new Uint8Array(await file.arrayBuffer()), modified: file.lastModified }),
    });
  }
  return { name, files };
}
