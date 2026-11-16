import { Action } from '../auth/policy';
import type { TrashableType } from '../trash/trash-registry';
import { InventoryItem, InventoryMovement } from './inventory.entities';
import type { InventoryService } from './inventory.service';

/**
 * Inventory items in the trash: what is left is written off first. History
 * — movements (the write-off itself too).
 */
export function inventoryItemTrash(items: InventoryService): TrashableType {
  return {
    entity: InventoryItem,
    manage: Action.InventoryManage,
    beforeDelete: (id, actor, m) => items.writeOffAll(m, id, actor),
    hasHistory: (id, m) => m.existsBy(InventoryMovement, { itemId: id }),
    async purge(id, keep, m) {
      if (keep)
        await m.update(InventoryItem, { id }, { location: '', notes: '' });
      return [];
    },
  };
}
