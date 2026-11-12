import { documentKey, documentTitle, MANUAL_FILE_NAME, projectKey } from '../core/manual.ts';
import { norm } from '../core/text.ts';
import type { DocumentState, ManualData } from '../core/types.ts';

export interface DocumentRow {
  key: string;
  project: string;
  document: string;
  /** Статус из перечня документов; пусто, если перечня нет. */
  registryStatus: string;
  /** Число циклов без ручного ввода и откуда оно взято. */
  autoCycles: number;
  autoCyclesSource: 'registry' | 'journal';
}

export interface ProjectGroup {
  key: string;
  project: string;
  /** РП из перечня документов, если он там указан. */
  registryManager: string;
  documents: DocumentRow[];
}

/** Проекты и документы для формы. Принимает состояния без ручного ввода: из них берутся подсказки. */
export function manualRows(states: DocumentState[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const state of states) {
    const { doc } = state;
    const key = projectKey(doc.project);
    const group = groups.get(key) ?? { key, project: doc.project || 'Проект не указан', registryManager: '', documents: [] };
    if (doc.managerSource === 'registry' && !group.registryManager) group.registryManager = doc.manager;
    const title = documentTitle(doc);
    group.documents.push({
      key: documentKey(doc.project, title),
      project: doc.project,
      document: title,
      registryStatus: state.status,
      autoCycles: state.cycles,
      autoCyclesSource: state.cyclesSource === 'registry' ? 'registry' : 'journal',
    });
    groups.set(key, group);
  }
  const byName = (a: string, b: string) => a.localeCompare(b, 'ru');
  for (const group of groups.values()) group.documents.sort((a, b) => byName(a.document, b.document));
  return [...groups.values()].sort((a, b) => byName(a.project, b.project));
}

interface Props {
  groups: ProjectGroup[];
  data: ManualData;
  statuses: string[];
  onManager: (group: ProjectGroup, manager: string) => void;
  onStatus: (row: DocumentRow, status: string) => void;
  onCycles: (row: DocumentRow, cycles: string) => void;
  dirty: boolean;
  /** `true` — файл можно записать прямо в папку; иначе он скачивается. */
  canSave: boolean;
  saving: boolean;
  message: string | null;
  onSave: () => void;
}

/** Форма ручного ввода: РП проекта, статус и число циклов документа. */
export function ManualForm(props: Props) {
  const { groups, data } = props;
  if (groups.length === 0) return null;
  const names = [
    ...new Set([...data.managers.values()].map((a) => a.manager.trim()).concat(groups.map((g) => g.registryManager))),
  ]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'ru'));
  const unassigned = groups.filter((g) => !data.managers.get(g.key)?.manager.trim() && !g.registryManager).length;

  return (
    <section>
      <h2>Ручной ввод</h2>
      <p class="muted">
        РП задаётся для проекта, статус и число циклов — для документа. Введённое вручную важнее перечня документов
        и оценки по журналу. Статус и циклы действуют с даты ввода: на конец прошлых периодов берутся прежние данные.
        Всё сохраняется в папку файлом «{MANUAL_FILE_NAME}» — его увидят все, кто открывает эту папку.
        {unassigned > 0 && <strong class="over"> Проектов без РП: {unassigned}.</strong>}
      </p>
      <div class="scroll">
        <table class="manual">
          <thead>
            <tr>
              <th>Проект / документ</th>
              <th>РП</th>
              <th>Статус документа</th>
              <th>Циклы согласования</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <>
                <tr key={group.key} class="group">
                  <td class="wide">
                    <strong>{group.project}</strong> <span class="muted small">документов: {group.documents.length}</span>
                  </td>
                  <td>
                    <input
                      class="text"
                      type="text"
                      list="manager-names"
                      aria-label={`РП проекта ${group.project}`}
                      placeholder={group.registryManager || 'не назначен'}
                      value={data.managers.get(group.key)?.manager ?? ''}
                      onInput={(e) => props.onManager(group, e.currentTarget.value)}
                    />
                    {group.registryManager && <div class="muted small">в перечне: {group.registryManager}</div>}
                  </td>
                  <td />
                  <td />
                </tr>
                {group.documents.map((row) => {
                  const override = data.documents.get(row.key);
                  const status = override?.status ?? '';
                  // Статус из файла мог быть записан иначе — сопоставляем без учёта регистра.
                  const selected = props.statuses.find((s) => norm(s) === norm(status)) ?? status;
                  return (
                    <tr key={`${group.key}:${row.key}`}>
                      <td class="indent">{row.document}</td>
                      <td />
                      <td>
                        <select aria-label={`Статус документа ${row.document}`} value={selected} onChange={(e) => props.onStatus(row, e.currentTarget.value)}>
                          <option value="">{row.registryStatus ? `из перечня: ${row.registryStatus}` : 'не указан'}</option>
                          {props.statuses.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                          {selected && !props.statuses.includes(selected) && <option value={selected}>{selected}</option>}
                        </select>
                      </td>
                      <td>
                        <input
                          class="text cycles"
                          type="number"
                          min={1}
                          step={1}
                          inputMode="numeric"
                          aria-label={`Циклы согласования ${row.document}`}
                          placeholder={String(row.autoCycles)}
                          value={override?.cycles ?? ''}
                          onInput={(e) => props.onCycles(row, e.currentTarget.value)}
                        />
                        <div class="muted small">
                          {override?.cycles != null
                            ? `вручную; без ввода — ${row.autoCycles}`
                            : row.autoCyclesSource === 'registry' ? 'из перечня' : 'по журналу'}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </>
            ))}
          </tbody>
        </table>
      </div>
      <datalist id="manager-names">
        {names.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <div class="form-actions">
        <button type="button" class="primary" disabled={props.saving || !props.dirty} onClick={props.onSave}>
          {props.saving ? 'Сохранение…' : props.canSave ? 'Сохранить в папку' : 'Скачать файл ручного ввода'}
        </button>
        {props.dirty && !props.saving && <span class="muted">Есть несохранённые изменения</span>}
        {props.message && <span class={props.message.startsWith('Не удалось') ? 'over' : 'muted'}>{props.message}</span>}
      </div>
    </section>
  );
}
