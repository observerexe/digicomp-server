import { ConflictException } from '@nestjs/common';
import { Action } from '../auth/policy';
import { PaperSnapshot } from '../paperwork/paper-snapshot.entity';
import type { TrashableType } from '../trash/trash-registry';
import { Doc, DocVersion } from './doc.entity';

/**
 * Files of the Archive in the trash. A signed scan of an editor document
 * is not deleted: it is the document's proof (cancel the document instead).
 * Deleted for good, the versions and their files go; with history (editor
 * documents refer to it) the title stays.
 */
export const DOCUMENT_TRASH: TrashableType = {
  entity: Doc,
  manage: Action.DocumentsManage,
  async beforeDelete(id, _actor, m) {
    if (await m.existsBy(PaperSnapshot, { archiveDocId: id })) {
      throw new ConflictException('Document is a signed scan');
    }
  },
  hasHistory: () => Promise.resolve(false),
  async purge(id, keep, m) {
    const versions = await m.findBy(DocVersion, { docId: id });
    await m.delete(DocVersion, { docId: id });
    if (keep) await m.update(Doc, { id }, { description: '' });
    return versions.map((v) => `documents/${v.storedName}`);
  },
};
