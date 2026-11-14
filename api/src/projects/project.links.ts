import { ILike, In, IsNull } from 'typeorm';
import { containsLike } from '../common/like';
import { Action, check } from '../auth/policy';
import type { LinkableType } from '../links/link-registry';
import { Project, ProjectMember } from './project.entities';

/** Projects: archived ones are hidden; staff and members of the project edit. */
export const PROJECT_LINKS: LinkableType = {
  async checkEdit(actor, id, m) {
    const participant = await m.existsBy(ProjectMember, {
      projectId: id,
      userId: actor.id,
    });
    // Same code as PATCH /projects/:id gives.
    return check(actor, Action.ProjectsUpdate, { participant }) === true
      ? true
      : 'PROJECT_EDIT_FORBIDDEN';
  },
  async find(ids, _actor, m) {
    const rows = await m.findBy(Project, { id: In(ids), archivedAt: IsNull() });
    return new Map(
      rows.map((p) => [p.id, { title: p.title, archived: false }]),
    );
  },
  async search(q, limit, _actor, m) {
    const rows = await m.find(Project, {
      where: { title: ILike(containsLike(q)), archivedAt: IsNull() },
      order: { title: 'ASC', id: 'ASC' },
      take: limit,
    });
    return rows.map((p) => ({ id: p.id, title: p.title, archived: false }));
  },
};
