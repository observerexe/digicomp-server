import { describe, expect, it } from 'vitest';
import type { Me, Task } from '../../api/types';
import { member, moderator } from '../../test/render';
import { actionsFor, dropAction, dueState, predict, splitPoints } from './logic';

export const task = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  title: 'Зняти репортаж',
  description: null,
  status: 'todo',
  points: 40,
  maxAssignees: 3,
  dueDate: null,
  createdById: 'm1',
  createdAt: '2026-11-01T10:00:00Z',
  updatedAt: '2026-11-01T10:00:00Z',
  completedAt: null,
  assignees: [],
  ...over,
});

const staff: Me = { ...moderator, permissions: [...moderator.permissions, 'tasks.accept', 'tasks.create', 'tasks.manage'] };
const canOf = (me: Me) => (a: string) => me.permissions.includes(a);
const as = (u: Me) => ({ id: u.id, name: u.name, avatarUrl: null, takenAt: '2026-11-02T10:00:00Z' });

describe('Дії над ТЗ', () => {
  it('учасник: взяти, приєднатися, ліміт', () => {
    expect(actionsFor(task(), member, canOf(member))).toEqual(['take']);
    expect(actionsFor(task({ status: 'queued', assignees: [as(staff)] }), member, canOf(member))).toEqual(['take']);
    expect(actionsFor(task({ status: 'queued', maxAssignees: 1, assignees: [as(staff)] }), member, canOf(member))).toEqual([]);
    expect(actionsFor(task({ status: 'in_progress', assignees: [as(staff)] }), member, canOf(member))).toEqual([]);
  });
  it('виконавець: почати, здати, відмовитися', () => {
    expect(actionsFor(task({ status: 'queued', assignees: [as(member)] }), member, canOf(member))).toEqual(['start', 'leave']);
    expect(actionsFor(task({ status: 'in_progress', assignees: [as(member)] }), member, canOf(member))).toEqual(['submit', 'leave']);
    expect(actionsFor(task({ status: 'review', assignees: [as(member)] }), member, canOf(member))).toEqual([]);
  });
  it('модератор приймає чуже, але не своє', () => {
    expect(actionsFor(task({ status: 'review', assignees: [as(member)] }), staff, canOf(staff))).toEqual(['accept', 'return']);
    expect(actionsFor(task({ status: 'review', assignees: [as(staff)] }), staff, canOf(staff))).toEqual([]);
    expect(actionsFor(task({ status: 'review', assignees: [as(staff)] }), member, canOf(member))).toEqual([]);
  });
  it('перетягування: лише дозволені переходи', () => {
    const t = task({ status: 'in_progress', assignees: [as(member)] });
    expect(dropAction(t, 'review', member, canOf(member))).toBe('submit');
    expect(dropAction(t, 'done', member, canOf(member))).toBeNull();
    expect(dropAction(task(), 'queued', member, canOf(member))).toBe('take');
    expect(dropAction(task(), 'in_progress', member, canOf(member))).toBeNull();
    const r = task({ status: 'review', assignees: [as(member)] });
    expect(dropAction(r, 'done', staff, canOf(staff))).toBe('accept');
    expect(dropAction(r, 'in_progress', staff, canOf(staff))).toBe('return');
    expect(dropAction(r, 'done', member, canOf(member))).toBeNull();
  });
  it('передбачений стан після дії', () => {
    const taken = predict(task(), 'take', member);
    expect(taken.status).toBe('queued');
    expect(taken.assignees.map((a) => a.id)).toEqual([member.id]);
    expect(predict(taken, 'leave', member).status).toBe('todo');
    expect(predict(task({ status: 'review' }), 'accept', staff).status).toBe('done');
  });
});

describe('Бали й дедлайн', () => {
  it('поділ як на сервері: 40 на трьох — 14 · 13 · 13', () => {
    expect(splitPoints(40, 3)).toEqual([14, 13, 13]);
    expect(splitPoints(10, 3)).toEqual([4, 3, 3]);
    expect(splitPoints(2, 3)).toEqual([1, 1]);
    expect(splitPoints(0, 2)).toEqual([]);
  });
  it('дедлайн: прострочено, сьогодні, завтра, дата', () => {
    const now = new Date('2026-11-10T10:00:00Z');
    expect(dueState({ dueDate: '2026-11-10T08:00:00Z', status: 'todo' }, now)).toEqual({ label: 'прострочено', tone: 'late' });
    expect(dueState({ dueDate: '2026-11-10T21:59:00Z', status: 'todo' }, now)).toEqual({ label: 'сьогодні', tone: 'soon' });
    expect(dueState({ dueDate: '2026-11-11T21:59:00Z', status: 'todo' }, now)).toEqual({ label: 'завтра', tone: 'soon' });
    expect(dueState({ dueDate: '2026-11-20T21:59:00Z', status: 'todo' }, now)).toEqual({ label: '20 лист.', tone: 'normal' });
    expect(dueState({ dueDate: null, status: 'todo' }, now).label).toBe('без дедлайну');
    expect(dueState({ dueDate: '2026-11-01T21:59:00Z', status: 'done' }, now).tone).toBe('done');
  });
});
