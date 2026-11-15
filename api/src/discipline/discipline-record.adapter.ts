import { ForbiddenException } from '@nestjs/common';
import { Action, can } from '../auth/policy';
import { recordInput, type PaperAdapter } from '../paperwork/adapters';
import { DisciplineRecord } from './discipline.entity';
import type { DisciplineService } from './discipline.service';
import { IssueDisciplineDto } from './dto';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * Documents that issue discipline («Подання про стягнення»). Publishing
 * issues the record (staff, a moderator not to self); it never changes
 * after; cancelling the document revokes it (admin any, a moderator only
 * their own; a fine returns its points). A member sees only documents
 * about themselves.
 */
export function disciplineAdapter(discipline: DisciplineService): PaperAdapter {
  return {
    // The right is checked by the service, with the member it is about.
    async publish(values, actor, m) {
      // Empty — not given (a fine's size is off unless it is a fine).
      const plain = Object.fromEntries(
        Object.entries(values).filter(([, v]) => v !== null),
      );
      const dto = await recordInput(IssueDisciplineDto, plain);
      return (await discipline.issue(dto, actor, m)).id;
    },

    canUpdate: () => Promise.resolve(false),

    update() {
      return Promise.reject(new ForbiddenException());
    },

    async cancel(id, reason, actor, m) {
      if (!(await m.existsBy(DisciplineRecord, { id }))) return;
      await discipline.revokeByPaper(m, id, reason, actor);
    },

    async resolve(id, m) {
      const r = await m.findOneBy(DisciplineRecord, { id });
      if (!r) return null;
      return {
        values: {
          userId: r.userId,
          type: r.type,
          reason: r.reason,
          amount: r.amount,
          issuedById: r.issuedById,
          createdAt: iso(r.createdAt),
          revokedAt: iso(r.revokedAt),
          revokedById: r.revokedById,
          revokeReason: r.revokeReason,
        },
        ready: true,
      };
    },

    canView: (actor) =>
      can(actor, Action.DisciplineReadAll) || {
        sql: 'p.target_id IN (SELECT dr.id FROM discipline_records dr WHERE dr.user_id = :discipline_me)',
        params: { discipline_me: actor.id },
      },
  };
}
