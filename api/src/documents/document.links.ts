import { In } from 'typeorm';
import { Action, can, check } from '../auth/policy';
import type { LinkableType } from '../links/link-registry';
import { AccessScope, Doc } from './doc.entity';

/**
 * Archive documents: members see those open to members and not archived
 * (as in the Archive); staff see and edit all.
 */
export const DOCUMENT_LINKS: LinkableType = {
  checkEdit: (actor) => Promise.resolve(check(actor, Action.DocumentsManage)),
  async find(ids, actor, m) {
    const staff = can(actor, Action.DocumentsManage);
    const rows = await m.findBy(Doc, { id: In(ids) });
    return new Map(
      rows
        .filter(
          (d) =>
            staff || (!d.archivedAt && d.accessScope === AccessScope.Members),
        )
        .map((d) => [d.id, { title: d.title, archived: !!d.archivedAt }]),
    );
  },
};
