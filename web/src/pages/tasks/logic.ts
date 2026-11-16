import type { Me, Task, TaskStatus } from '../../api/types';
import { formatDate } from '../../lib/format';
import { addDays, kyivParts } from '../../lib/kyiv';

export const COLUMNS: { status: TaskStatus; title: string }[] = [
  { status: 'todo', title: 'Вільне' },
  { status: 'in_progress', title: 'В роботі' },
  { status: 'review', title: 'На перевірці' },
  { status: 'done', title: 'Виконано' },
];

/**
 * `takeStart` — dragging a free task onto «В роботі» by the one taking its
 * last slot; `archive`, `unarchive` — a done task to the archive and back (staff).
 */
export type ActionKind = 'take' | 'takeStart' | 'leave' | 'start' | 'submit' | 'return' | 'accept' | 'archive' | 'unarchive';

export const ACTION_LABEL: Record<ActionKind, string> = {
  take: 'Взяти',
  takeStart: 'Взяти й почати',
  leave: 'Відмовитися',
  start: 'Почати',
  submit: 'Здати на перевірку',
  return: 'Повернути',
  accept: 'Прийняти',
  archive: 'В архів',
  unarchive: 'Повернути з архіву',
};

type Can = (action: string) => boolean;

export const isAssignee = (t: Task, me: Me) => t.assignees.some((a) => a.id === me.id);

/**
 * What this person can do with the task now (the API checks it again):
 * docs/tech/API.md «Технічні завдання», policy: TasksAccept is staff and never
 * one's own task. A free task stays free until an assignee presses «Почати».
 */
export function actionsFor(t: Task, me: Me, can: Can): ActionKind[] {
  const mine = isAssignee(t, me);
  const out: ActionKind[] = [];
  const free = t.status === 'todo';
  if (free && !mine && t.assignees.length < t.maxAssignees && can('tasks.take')) out.push('take');
  if (mine && free) out.push('start');
  if (mine && t.status === 'in_progress') out.push('submit');
  if (t.status === 'review' && !mine && can('tasks.accept')) out.push('accept', 'return');
  if (mine && (free || t.status === 'in_progress')) out.push('leave');
  if (t.status === 'done' && can('tasks.archive')) out.push(t.archivedAt ? 'unarchive' : 'archive');
  return out;
}

/** Short labels for cards: «Приєднатися» when someone already took it, «Здати». */
export function actionLabel(kind: ActionKind, t: Task): string {
  if (kind === 'take' && t.assignees.length > 0) return 'Приєднатися';
  return kind === 'submit' ? 'Здати' : ACTION_LABEL[kind];
}

/**
 * Dragging a card to a column: the action it means, or null if not allowed.
 * Free → «В роботі»: one's own task — «Почати»; someone else's — «взяти й
 * почати», only by taking its last slot (nobody is left out).
 */
export function dropAction(t: Task, to: TaskStatus, me: Me, can: Can): ActionKind | null {
  const allowed = actionsFor(t, me, can);
  if (t.status === 'todo' && to === 'in_progress') {
    if (allowed.includes('start')) return 'start';
    return allowed.includes('take') && t.assignees.length + 1 === t.maxAssignees ? 'takeStart' : null;
  }
  const want: ActionKind | null =
    t.status === 'in_progress' && to === 'review' ? 'submit' : t.status === 'review' && to === 'done' ? 'accept' : t.status === 'review' && to === 'in_progress' ? 'return' : null;
  return want && allowed.includes(want) ? want : null;
}

/** The task as it will be after the action (optimistic update). */
export function predict(t: Task, kind: ActionKind, me: Me, now = new Date()): Task {
  const iso = now.toISOString();
  switch (kind) {
    case 'take':
    case 'takeStart':
      return {
        ...t,
        status: kind === 'takeStart' ? 'in_progress' : t.status,
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
    case 'archive':
      return { ...t, archivedAt: iso, archivedById: me.id };
    case 'unarchive':
      return { ...t, archivedAt: null, archivedById: null };
  }
}

/** Same rule as the API (api/src/tasks/split-points.ts): remainder to the earliest. */
export function splitPoints(total: number, n: number): number[] {
  if (n === 0 || total <= 0) return [];
  const base = Math.floor(total / n);
  const rest = total % n;
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0)).filter((x) => x > 0);
}

/** Each assignee's share: «кожному 10» when equal, «кожному 14 · 13 · 13» otherwise. */
export function shareLabel(split: number[]): string {
  return `кожному ${new Set(split).size === 1 ? split[0] : split.join(' · ')}`;
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
