import { In } from 'typeorm';
import { Action, check } from '../auth/policy';
import type { LinkableType } from '../links/link-registry';
import { InventoryItem } from './inventory.entities';

/** Inventory items: everyone sees them; staff edit the catalog. */
export const INVENTORY_ITEM_LINKS: LinkableType = {
  checkEdit: (actor) => Promise.resolve(check(actor, Action.InventoryManage)),
  async find(ids, _actor, m) {
    const rows = await m.findBy(InventoryItem, { id: In(ids) });
    return new Map(
      rows.map((i) => [i.id, { title: i.title, archived: false }]),
    );
  },
};
