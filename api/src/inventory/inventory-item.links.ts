import { ILike, In } from 'typeorm';
import { containsLike } from '../common/like';
import { Action, check } from '../auth/policy';
import type { LinkableType } from '../links/link-registry';
import { InventoryItem } from './inventory.entities';

/** Inventory items: everyone sees them; staff edit the catalog. */
export const INVENTORY_ITEM_LINKS: LinkableType = {
  checkEdit: (actor) => Promise.resolve(check(actor, Action.InventoryManage)),
  async find(ids, _actor, m) {
    const rows = await m.findBy(InventoryItem, { id: In(ids) });
    return new Map(
      rows.map((i) => [
        i.id,
        { title: i.title, archived: false, code: i.code },
      ]),
    );
  },
  async search(q, limit, _actor, m) {
    const like = ILike(containsLike(q));
    const rows = await m.find(InventoryItem, {
      where: [{ title: like }, { code: like }],
      order: { title: 'ASC', id: 'ASC' },
      take: limit,
    });
    return rows.map((i) => ({
      id: i.id,
      title: i.title,
      archived: false,
      code: i.code,
    }));
  },
};
