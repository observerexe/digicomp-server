import { ILike, In } from 'typeorm';
import { Action, can } from '../auth/policy';
import { containsLike } from '../common/like';
import type { LinkableType } from '../links/link-registry';
import { User } from './user.entity';

/**
 * Members: referred to from documents (fields `ref:user`, «@»). Same
 * visibility as the team list: a blocked member — only for staff, as
 * archived; search offers active ones. Links from a member are not made by
 * hand.
 */
export const USER_LINKS: LinkableType = {
  checkEdit: () => Promise.resolve('FORBIDDEN'),
  async find(ids, actor, m) {
    const extended = can(actor, Action.UsersReadExtended);
    const rows = await m.findBy(User, {
      id: In(ids),
      ...(extended ? {} : { active: true }),
    });
    return new Map(
      rows.map((u) => [u.id, { title: u.name, archived: !u.active }]),
    );
  },
  async search(q, limit, _actor, m) {
    const rows = await m.find(User, {
      where: { name: ILike(containsLike(q)), active: true },
      order: { name: 'ASC', id: 'ASC' },
      take: limit,
    });
    return rows.map((u) => ({ id: u.id, title: u.name, archived: false }));
  },
};
