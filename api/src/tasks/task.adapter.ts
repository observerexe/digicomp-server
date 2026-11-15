import { In, type EntityManager } from 'typeorm';
import { Action, assertCan, can } from '../auth/policy';
import { recordInput, type PaperAdapter } from '../paperwork/adapters';
import { fieldInvalid } from '../paperwork/paper-fields';
import { signName } from '../paperwork/content';
import { User } from '../users/user.entity';
import { CreateTaskDto, UpdateTaskDto } from './dto';
import { splitPoints } from './split-points';
import { Task, TaskAssignee, TaskStatus } from './task.entities';
import { TASK_SCHEMA } from './task.schema';
import type { TasksService } from './tasks.service';

/** Keys of the task's own fields; any other bound key is an extra field. */
const OWN = new Set(TASK_SCHEMA.fields.map((f) => f.key));
/** Own fields that may be emptied. */
const NULLABLE = new Set(
  TASK_SCHEMA.fields.filter((f) => f.nullable).map((f) => f.key),
);

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** The DTO's own fields and `extra` from values by the schema's keys. */
function split(values: Record<string, unknown>, keepNull: boolean) {
  const plain: Record<string, unknown> = {};
  const extra: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(values)) {
    if (v === null && !keepNull) continue;
    if (OWN.has(key)) {
      if (v === null && !NULLABLE.has(key)) throw fieldInvalid(key);
      plain[key] = v;
    } else extra[key] = v;
  }
  if (Object.keys(extra).length) plain.extra = extra;
  return plain;
}

/** «Ім'я ПРІЗВИЩЕ — 6; …» in the order the assignees took the task. */
async function pointsSplit(
  m: EntityManager,
  points: number,
  assignees: TaskAssignee[],
) {
  const shares = splitPoints(points, assignees);
  if (!shares.length) return null;
  const users = await m.findBy(User, {
    id: In(shares.map((s) => s.assignee.userId)),
  });
  const name = (id: string) => users.find((u) => u.id === id)?.name ?? null;
  return shares
    .map((s) => {
      const n = name(s.assignee.userId);
      return `${n ? signName(n) : 'Учасник'} — ${s.amount}`;
    })
    .join('; ');
}

/**
 * Documents that create tasks («Технічне завдання»). Publishing creates the
 * task (staff: TasksCreate); bound fields change it as PATCH does (staff,
 * until it is done); cancelling takes it off while it is free without
 * assignees, as DELETE does. Everyone sees tasks, so everyone sees their
 * published documents.
 */
export function taskAdapter(tasks: TasksService): PaperAdapter {
  return {
    async publish(values, actor, m) {
      assertCan(actor, Action.TasksCreate);
      const dto = await recordInput(CreateTaskDto, split(values, false));
      return (await tasks.create(dto, actor, m)).id;
    },

    async canUpdate(id, actor, m) {
      if (!can(actor, Action.TasksManage)) return false;
      const t = await m.findOneBy(Task, { id });
      return !!t && t.status !== TaskStatus.Done;
    },

    async update(id, values, actor, m) {
      assertCan(actor, Action.TasksManage);
      const dto = await recordInput(UpdateTaskDto, split(values, true));
      await tasks.update(id, dto, actor, m);
    },

    async cancel(id, reason, actor, m) {
      if (!(await m.existsBy(Task, { id }))) return;
      return tasks.cancelByPaper(m, id, reason, actor);
    },

    async resolve(id, m: EntityManager) {
      const t = await m.findOneBy(Task, { id });
      if (!t) return null;
      const assignees = await m.find(TaskAssignee, {
        where: { taskId: id },
        order: { takenAt: 'ASC', userId: 'ASC' },
      });
      return {
        values: {
          ...t.extra,
          title: t.title,
          description: t.description,
          points: t.points,
          maxAssignees: t.maxAssignees,
          dueDate: iso(t.dueDate),
          status: t.status,
          assignees: assignees.map((a) => a.userId),
          pointsSplit: await pointsSplit(m, t.points, assignees),
          createdById: t.createdById,
          createdAt: iso(t.createdAt),
          submittedAt: iso(t.submittedAt),
          completedAt: iso(t.completedAt),
          acceptedById: t.acceptedById,
        },
        ready: t.status === TaskStatus.Done,
      };
    },

    canView: () => true,
  };
}
