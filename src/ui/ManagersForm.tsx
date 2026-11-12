import { projectKey } from '../core/managers.ts';
import type { ManagerAssignments, ProjectDocument } from '../core/types.ts';

export interface ProjectRow {
  key: string;
  project: string;
  documents: number;
  /** РП из перечня документов, если он там указан. */
  registryManager: string;
}

/** Проекты из загруженных журналов с РП из перечней. */
export function projectRows(documents: ProjectDocument[]): ProjectRow[] {
  const rows = new Map<string, ProjectRow>();
  for (const doc of documents) {
    const key = projectKey(doc.project);
    const row = rows.get(key) ?? { key, project: doc.project || 'Проект не указан', documents: 0, registryManager: '' };
    row.documents += 1;
    if (doc.managerSource === 'registry' && !row.registryManager) row.registryManager = doc.manager;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.project.localeCompare(b.project, 'ru'));
}

interface Props {
  projects: ProjectRow[];
  assignments: ManagerAssignments;
  onChange: (row: ProjectRow, manager: string) => void;
  dirty: boolean;
  /** `true` — файл можно записать прямо в папку; иначе он скачивается. */
  canSave: boolean;
  saving: boolean;
  message: string | null;
  onSave: () => void;
}

/** Форма назначения руководителей проектам. */
export function ManagersForm(props: Props) {
  const { projects, assignments } = props;
  if (projects.length === 0) return null;
  const names = [...new Set([...assignments.values()].map((a) => a.manager.trim()).concat(projects.map((p) => p.registryManager)))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'ru'));
  const unassigned = projects.filter((p) => !assignments.get(p.key)?.manager.trim() && !p.registryManager).length;

  return (
    <section>
      <h2>Назначение руководителей проектов</h2>
      <p class="muted">
        РП задаётся для проекта целиком и действует для всех его документов. Назначения сохраняются в папку с журналами
        файлом «РП по проектам.xlsx» — их увидят все, кто открывает эту папку.
        {unassigned > 0 && <strong class="over"> Без РП: {unassigned}.</strong>}
      </p>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>Проект</th>
              <th class="num">Документов</th>
              <th>РП</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((row) => (
              <tr key={row.key}>
                <td class="wide">{row.project}</td>
                <td class="num">{row.documents}</td>
                <td>
                  <input
                    class="text"
                    type="text"
                    list="manager-names"
                    aria-label={`РП проекта ${row.project}`}
                    placeholder={row.registryManager || 'не назначен'}
                    value={assignments.get(row.key)?.manager ?? ''}
                    onInput={(e) => props.onChange(row, e.currentTarget.value)}
                  />
                  {row.registryManager && <div class="muted small">в перечне: {row.registryManager}</div>}
                </td>
              </tr>
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
          {props.saving ? 'Сохранение…' : props.canSave ? 'Сохранить в папку' : 'Скачать файл назначений'}
        </button>
        {props.dirty && !props.saving && <span class="muted">Есть несохранённые изменения</span>}
        {props.message && <span class={props.message.startsWith('Не удалось') ? 'over' : 'muted'}>{props.message}</span>}
      </div>
    </section>
  );
}

