import { ForbiddenException } from '@nestjs/common';
import { Action, can } from '../auth/policy';
import { recordInput, type PaperAdapter } from '../paperwork/adapters';
import { GrantAuthorizationDto } from './dto';
import { PlaceAuthorization } from './place-authorization.entity';
import type { PlacesService } from './places.service';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * Documents that grant допуски («Запис про інструктаж і допуск»).
 * Publishing grants the допуск (staff); a repeat briefing renews the one the
 * member has and becomes its document. It never changes after; cancelling
 * the document that granted the current term revokes the допуск (an earlier
 * briefing's document leaves it). Staff may give an old допуск its
 * document. A member sees the documents that refer to them (the допуск may
 * be gone since).
 */
export function placeAuthorizationAdapter(places: PlacesService): PaperAdapter {
  return {
    // The right is checked by the service.
    async publish(values, actor, m, paperId) {
      // Empty — not given («Діє до» empty — no end date).
      const plain = Object.fromEntries(
        Object.entries(values).filter(([, v]) => v !== null),
      );
      const dto = await recordInput(GrantAuthorizationDto, plain);
      return (await places.grant(dto, actor, m, paperId)).id;
    },

    canUpdate: () => Promise.resolve(false),

    adopt: (id, paperId, actor, m) => places.adopt(m, id, paperId, actor),

    update() {
      return Promise.reject(new ForbiddenException());
    },

    cancel: (id, reason, actor, m, paperId) =>
      places.revokeByPaper(m, id, paperId, reason, actor),

    async resolve(id, m) {
      const a = await m.findOneBy(PlaceAuthorization, { id });
      if (!a) return null;
      return {
        values: {
          userId: a.userId,
          placeId: a.placeId,
          expiresAt: iso(a.expiresAt),
          note: a.note,
          grantedById: a.grantedById,
          grantedAt: iso(a.grantedAt),
        },
        ready: true,
      };
    },

    canView: (actor) =>
      can(actor, Action.PlacesAuthorize) || {
        sql: `p.id IN (SELECT rl.from_id FROM record_links rl WHERE rl.from_type = 'paper' AND rl.to_type = 'user' AND rl.to_id = :authorization_me AND rl.role <> '')`,
        params: { authorization_me: actor.id },
      },
  };
}
