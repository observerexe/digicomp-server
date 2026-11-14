import { In } from 'typeorm';
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
};
