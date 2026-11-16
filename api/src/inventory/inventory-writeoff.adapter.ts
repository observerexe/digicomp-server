import { ForbiddenException } from '@nestjs/common';
import { recordInput, type PaperAdapter } from '../paperwork/adapters';
import { WriteOffDto } from './dto';
import { InventoryMovement } from './inventory.entities';
import type { InventoryService } from './inventory.service';

/**
 * «Акт списання»: a row — a write-off (the item, how much, why). Publishing
 * takes the stock down as «Взяти» does, and the movement refers to the act;
 * a write-off never changes after. Cancelling the act (staff) returns what
 * it wrote off by new movements. Stock is seen by everyone, so are its acts.
 * Movements made before documents get no act.
 */
export function inventoryWriteOffAdapter(
  inventory: InventoryService,
): PaperAdapter {
  return {
    async publish(values, actor, m, paperId) {
      const dto = await recordInput(WriteOffDto, values);
      return inventory.writeOff(m, dto, actor, paperId);
    },

    canUpdate: () => Promise.resolve(false),

    adopt() {
      return Promise.reject(new ForbiddenException());
    },

    update() {
      return Promise.reject(new ForbiddenException());
    },

    async cancel(id, reason, actor, m) {
      await inventory.returnWriteOff(m, id, reason, actor);
    },

    async resolve(id, m) {
      const w = await m.findOneBy(InventoryMovement, { id });
      if (!w) return null;
      return {
        values: {
          itemId: w.itemId,
          quantity: -w.delta,
          note: w.note,
          quantityAfter: w.quantityAfter,
          actorId: w.actorId,
          createdAt: w.createdAt.toISOString(),
        },
        ready: true,
      };
    },

    canView: () => true,
  };
}
