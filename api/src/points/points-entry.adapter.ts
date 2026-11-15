import { ForbiddenException } from '@nestjs/common';
import { Action, can } from '../auth/policy';
import { recordInput, type PaperAdapter } from '../paperwork/adapters';
import { AwardPointsDto } from './dto';
import { PointsEntry } from './points-entry.entity';
import type { PointsService } from './points.service';

/**
 * Documents that award points («Відомість балів»: a row — an award).
 * Publishing awards each row (staff, a moderator not to self) and the
 * entry refers to the document; an award never changes after; cancelling
 * the document revokes its awards (admin any, a moderator only their own)
 * — and the same may give an old manual award a sheet of its one row. A
 * member sees the documents that award them.
 */
export function pointsEntryAdapter(points: PointsService): PaperAdapter {
  return {
    // The right is checked by the service, with the member awarded.
    async publish(values, actor, m, paperId) {
      const dto = await recordInput(AwardPointsDto, values);
      return (await points.award(dto, actor, m, paperId)).id;
    },

    canUpdate: () => Promise.resolve(false),

    adopt: (id, paperId, actor, m) => points.adopt(m, id, paperId, actor),

    update() {
      return Promise.reject(new ForbiddenException());
    },

    async cancel(id, reason, actor, m) {
      if (!(await m.existsBy(PointsEntry, { id }))) return;
      await points.revokeByPaper(m, id, reason, actor);
    },

    async resolve(id, m) {
      const e = await m.findOneBy(PointsEntry, { id });
      if (!e) return null;
      return {
        values: {
          userId: e.userId,
          amount: e.amount,
          reason: e.reason,
          kind: e.kind,
          taskId: e.taskId,
          createdById: e.createdById,
          reversesId: e.reversesId,
          createdAt: e.createdAt.toISOString(),
        },
        ready: true,
      };
    },

    canView: (actor) =>
      can(actor, Action.PointsReadAll) || {
        sql: 'p.id IN (SELECT pl.paper_id FROM points_ledger pl WHERE pl.user_id = :points_me)',
        params: { points_me: actor.id },
      },
  };
}
