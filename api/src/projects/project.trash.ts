import { Action } from '../auth/policy';
import { InventoryMovement } from '../inventory/inventory.entities';
import type { TrashableType } from '../trash/trash-registry';
import { Project, ProjectFile, ProjectMember } from './project.entities';

/**
 * Projects in the trash. History — stock taken for it (and editor
 * documents, checked by the trash). Deleted for good, its members and
 * files go; with history the title stays.
 */
export const PROJECT_TRASH: TrashableType = {
  entity: Project,
  manage: Action.ProjectsManage,
  hasHistory: (id, m) => m.existsBy(InventoryMovement, { projectId: id }),
  async purge(id, keep, m) {
    const files = await m.findBy(ProjectFile, { projectId: id });
    await m.delete(ProjectFile, { projectId: id });
    await m.delete(ProjectMember, { projectId: id });
    if (keep) {
      await m.update(
        Project,
        { id },
        { description: '', accomplishments: '', sources: [] },
      );
    }
    return files.map((f) => `projects/${f.storedName}`);
  },
};
