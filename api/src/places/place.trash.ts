import { ConflictException } from '@nestjs/common';
import { IsNull, MoreThan } from 'typeorm';
import type { AuditService } from '../audit/audit.service';
import { Action } from '../auth/policy';
import { Booking } from '../bookings/booking.entity';
import { FaultReport } from '../faults/fault.entities';
import type { TrashableType } from '../trash/trash-registry';
import { PlaceAuthorization } from './place-authorization.entity';
import { Place } from './place.entity';
import { WorkSession } from './work-session.entity';

/** Reason of the bookings cancelled with their equipment. */
export const PLACE_DELETED_REASON = 'Обладнання видалено';

/**
 * Equipment in the trash: not while someone works on it; its bookings
 * ahead are cancelled. History — sessions, faults, authorizations.
 */
export function placeTrash(audit: AuditService): TrashableType {
  return {
    entity: Place,
    manage: Action.PlacesManage,
    async beforeDelete(id, actor, m) {
      if (await m.existsBy(WorkSession, { placeId: id, endedAt: IsNull() })) {
        throw new ConflictException('Place is in use');
      }
      const ahead = await m.find(Booking, {
        where: {
          placeId: id,
          cancelledAt: IsNull(),
          endsAt: MoreThan(new Date()),
        },
        lock: { mode: 'pessimistic_write' },
      });
      for (const b of ahead) {
        await m.update(
          Booking,
          { id: b.id },
          {
            cancelledAt: new Date(),
            cancelledById: actor.id,
            cancelReason: PLACE_DELETED_REASON,
          },
        );
        await audit.log(
          {
            actorId: actor.id,
            action: 'booking.cancelled',
            entity: 'booking',
            entityId: b.id,
            meta: {
              forced: b.userId !== actor.id,
              userId: b.userId,
              reason: PLACE_DELETED_REASON,
            },
          },
          m,
        );
      }
    },
    async hasHistory(id, m) {
      return (
        (await m.existsBy(WorkSession, { placeId: id })) ||
        (await m.existsBy(FaultReport, { placeId: id })) ||
        (await m.existsBy(PlaceAuthorization, { placeId: id }))
      );
    },
    async purge(id, keep, m) {
      await m.delete(Booking, { placeId: id });
      if (keep)
        await m.update(Place, { id }, { location: '', description: '' });
      return [];
    },
  };
}
