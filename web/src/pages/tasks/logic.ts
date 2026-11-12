import type { Me, Task, TaskStatus } from '../../api/types';
import { formatDate } from '../../lib/format';
import { addDays, kyivParts } from '../../lib/kyiv';

export const COLUMNS: { status: TaskStatus; title: string }[] = [
  { status: 'todo', title: 'Вільне' },
  { status: 'queued', title: 'В черзі' },
  { status: 'in_progress', title: 'В роботі' },
  { status: 'review', title: 'На перевірці' },
  { status: 'done', title: 'Виконано' },
];

export type ActionKind = 'take' | 'leave' | 'start' | 'submit' | 'return' | 'accept';

export const ACTION_LABEL: Record<ActionKind, string> = {
  take: 'Взяти',
  leave: 'Відмовитися',
  start: 'Почати',
  submit: 'Здати на перевірку',
  return: 'Повернути',
  accept: 'Прийняти',
};

type Can = (action: string) => boolean;

export const isAssignee = (t: Task, me: Me) => t.assignees.some((a) => a.id === me.id);

/**
 * What this person can do with the task now (the API checks it again):
 * docs/tech/API.md «ТЗ», policy: TasksAccept is staff and never one's own task.
 */
export function actionsFor(t: Task, me: Me, can: Can): ActionKind[] {
  const mine = isAssignee(t, me);
  const out: ActionKind[] = [];
  const open = t.status === 'todo' || t.status === 'queued';
  if (open && !mine && t.assignees.length < t.maxAssignees && can('tasks.take')) out.push('take');
  if (mine && t.status === 'queued') out.push('start');
  if (mine && t.status === 'in_progress') out.push('submit');
  if (t.status === 'review' && !mine && can('tasks.accept')) out.push('accept', 'return');
  if (mine && (t.status === 'queued' || t.status === 'in_progress')) out.push('leave');
  return out;
}

/** Short labels for cards: «Приєднатися» when someone already took it, «Здати». */
export function actionLabel(kind: ActionKind, t: Task): string {
  if (kind === 'take' && t.assignees.length > 0) return 'Приєднатися';
  return kind === 'submit' ? 'Здати' : ACTION_LABEL[kind];
}

/** Dragging a card to a column: the action it means, or null if not allowed. */
export function dropAction(t: Task, to: TaskStatus, me: Me, can: Can): ActionKind | null {
  const allowed = actionsFor(t, me, can);
  const want: ActionKind | null =
    t.status === 'todo' && to === 'queued'
      ? 'take'
      : t.status === 'queued' && to === 'queued'
        ? 'take'
        : t.status === 'queued' && to === 'in_progress'
          ? 'start'
          : t.status === 'in_progress' && to === 'review'
            ? 'submit'
            : t.status === 'review' && to === 'done'
              ? 'accept'
              : t.status === 'review' && to === 'in_progress'
                ? 'return'
                : null;
  return want && allowed.includes(want) && !(t.status === to && want !== 'take') ? want : null;
}

/** The task as it will be after the action (optimistic update). */
export function predict(t: Task, kind: ActionKind, me: Me, now = new Date()): Task {
  const iso = now.toISOString();
  switch (kind) {
    case 'take':
      return {
        ...t,
        status: t.status === 'todo' ? 'queued' : t.status,
        assignees: [...t.assignees, { id: me.id, name: me.name, avatarUrl: me.avatarUrl, takenAt: iso }],
      };
    case 'leave': {
      const assignees = t.assignees.filter((a) => a.id !== me.id);
      return { ...t, assignees, status: assignees.length ? t.status : 'todo' };
    }
    case 'start':
    case 'return':
      return { ...t, status: 'in_progress' };
    case 'submit':
      return { ...t, status: 'review', updatedAt: iso };
    case 'accept':
      return { ...t, status: 'done', completedAt: iso };
  }
}

/** Same rule as the API (api/src/tasks/split-points.ts): remainder to the earliest. */
export function splitPoints(total: number, n: number): number[] {
  if (n === 0 || total <= 0) return [];
  const base = Math.floor(total / n);
  const rest = total % n;
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0)).filter((x) => x > 0);
}

export type DueTone = 'late' | 'soon' | 'normal' | 'done';

/** Deadline label and colour: «прострочено», «сьогодні», «завтра», a date. */
export function dueState(t: Pick<Task, 'dueDate' | 'status'>, now = new Date()): { label: string; tone: DueTone } {
  if (!t.dueDate) return { label: 'без дедлайну', tone: 'normal' };
  const due = new Date(t.dueDate);
  if (t.status === 'done') return { label: formatDate(due, now), tone: 'done' };
  if (due.getTime() < now.getTime()) return { label: 'прострочено', tone: 'late' };
  const today = kyivParts(now).date;
  const day = kyivParts(due).date;
  if (day === today) return { label: 'сьогодні', tone: 'soon' };
  if (day === addDays(today, 1)) return { label: 'завтра', tone: 'soon' };
  return { label: formatDate(due, now), tone: day <= addDays(today, 3) ? 'soon' : 'normal' };
}

/** The deadline is the end of the chosen Kyiv day. */
export const DUE_TIME = '23:59';
