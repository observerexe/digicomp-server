import { ILike, In, IsNull, type FindOptionsWhere } from 'typeorm';
import { containsLike } from '../common/like';
import { Action, can, check } from '../auth/policy';
import type { LinkableType } from '../links/link-registry';
import { AccessScope, Doc } from './doc.entity';

/**
 * Archive documents: members see those open to members and not archived
 * (as in the Archive); staff see and edit all; deleted ones nobody.
 */
export const DOCUMENT_LINKS: LinkableType = {
  checkEdit: (actor) => Promise.resolve(check(actor, Action.DocumentsManage)),
  async find(ids, actor, m) {
    const staff = can(actor, Action.DocumentsManage);
    const rows = await m.findBy(Doc, { id: In(ids), deletedAt: IsNull() });
    return new Map(
      rows
        .filter(
          (d) =>
            staff || (!d.archivedAt && d.accessScope === AccessScope.Members),
        )
        .map((d) => [d.id, { title: d.title, archived: !!d.archivedAt }]),
    );
  },
  async search(q, limit, actor, m) {
    const scope: FindOptionsWhere<Doc> = can(actor, Action.DocumentsManage)
      ? { deletedAt: IsNull() }
      : {
          deletedAt: IsNull(),
          archivedAt: IsNull(),
          accessScope: AccessScope.Members,
        };
    const rows = await m.find(Doc, {
      where: { ...scope, title: ILike(containsLike(q)) },
      order: { title: 'ASC', id: 'ASC' },
      take: limit,
    });
    return rows.map((d) => ({
      id: d.id,
      title: d.title,
      archived: !!d.archivedAt,
    }));
  },
};
