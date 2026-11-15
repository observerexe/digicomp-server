import type { EntityManager } from 'typeorm';
import { Action, assertCan } from '../auth/policy';
import { recordInput, type PaperAdapter } from '../paperwork/adapters';
import { CreateTaskDto } from './dto';
import { Task, TaskAssignee, TaskStatus } from './task.entities';
import { TASK_SCHEMA } from './task.schema';
import type { TasksService } from './tasks.service';

/** Keys of the task's own fields; any other bound key is an extra field. */
const OWN = new Set(TASK_SCHEMA.fields.map((f) => f.key));

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * Documents that create tasks («Технічне завдання»). Publishing creates the
 * task (staff: TasksCreate); cancelling takes it off while it is free
 * without assignees, as DELETE does. Everyone sees tasks, so everyone sees
 * their published documents.
 */
export function taskAdapter(tasks: TasksService): PaperAdapter {
  return {
    async publish(values, actor, m) {
      assertCan(actor, Action.TasksCreate);
      const plain: Record<string, unknown> = {};
      const extra: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(values)) {
        if (v === null) continue;
        if (OWN.has(key)) plain[key] = v;
        else extra[key] = v;
      }
      if (Object.keys(extra).length) plain.extra = extra;
      const dto = await recordInput(CreateTaskDto, plain);
      return (await tasks.create(dto, actor, m)).id;
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
