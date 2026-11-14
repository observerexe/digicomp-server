import { ILike, In } from 'typeorm';
import { containsLike } from '../common/like';
import { Action, check } from '../auth/policy';
import type { LinkableType } from '../links/link-registry';
import { Task } from './task.entities';

/** Tasks: everyone sees them; staff edit them. */
export const TASK_LINKS: LinkableType = {
  checkEdit: (actor) => Promise.resolve(check(actor, Action.TasksManage)),
  async find(ids, _actor, m) {
    const rows = await m.findBy(Task, { id: In(ids) });
    return new Map(
      rows.map((t) => [t.id, { title: t.title, archived: false }]),
    );
  },
  async search(q, limit, _actor, m) {
    const rows = await m.find(Task, {
      where: { title: ILike(containsLike(q)) },
      order: { title: 'ASC', id: 'ASC' },
      take: limit,
    });
    return rows.map((t) => ({ id: t.id, title: t.title, archived: false }));
  },
};
