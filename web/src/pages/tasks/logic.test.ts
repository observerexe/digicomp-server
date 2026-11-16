import { describe, expect, it } from 'vitest';
import type { Me, Task } from '../../api/types';
import { member, moderator } from '../../test/render';
import { actionsFor, dropAction, dueState, predict, shareLabel, splitPoints } from './logic';

export const task = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  title: 'Зняти репортаж',
  description: null,
  status: 'todo',
  points: 40,
  maxAssignees: 3,
  dueDate: null,
  createdById: 'm1',
  extra: {},
  createdAt: '2026-11-01T10:00:00Z',
  updatedAt: '2026-11-01T10:00:00Z',
  submittedAt: null,
  completedAt: null,
  acceptedById: null,
  archivedAt: null,
  archivedById: null,
  assignees: [],
  paper: null,
  ...over,
});

const staff: Me = { ...moderator, permissions: [...moderator.permissions, 'tasks.accept', 'tasks.create', 'tasks.manage'] };
const canOf = (me: Me) => (a: string) => me.permissions.includes(a);
const as = (u: Me) => ({ id: u.id, name: u.name, avatarUrl: null, takenAt: '2026-11-02T10:00:00Z' });

describe('Дії над ТЗ', () => {
  it('учасник: взяти, приєднатися, ліміт', () => {
    expect(actionsFor(task(), member, canOf(member))).toEqual(['take']);
    expect(actionsFor(task({ assignees: [as(staff)] }), member, canOf(member))).toEqual(['take']);
    expect(actionsFor(task({ maxAssignees: 1, assignees: [as(staff)] }), member, canOf(member))).toEqual([]);
    expect(actionsFor(task({ status: 'in_progress', assignees: [as(staff)] }), member, canOf(member))).toEqual([]);
  });
  it('виконавець: почати, здати, відмовитися', () => {
    expect(actionsFor(task({ assignees: [as(member)] }), member, canOf(member))).toEqual(['start', 'leave']);
    // Усі місця зайняті — завдання чекає «Почати» у «Вільне».
    expect(actionsFor(task({ maxAssignees: 1, assignees: [as(member)] }), member, canOf(member))).toEqual(['start', 'leave']);
    expect(actionsFor(task({ status: 'in_progress', assignees: [as(member)] }), member, canOf(member))).toEqual(['submit', 'leave']);
    expect(actionsFor(task({ status: 'review', assignees: [as(member)] }), member, canOf(member))).toEqual([]);
  });
  it('модератор приймає чуже, але не своє', () => {
    expect(actionsFor(task({ status: 'review', assignees: [as(member)] }), staff, canOf(staff))).toEqual(['accept', 'return']);
    expect(actionsFor(task({ status: 'review', assignees: [as(staff)] }), staff, canOf(staff))).toEqual([]);
    expect(actionsFor(task({ status: 'review', assignees: [as(staff)] }), member, canOf(member))).toEqual([]);
  });
  it('архів: виконане — «В архів», архівне — «Повернути з архіву»; лише staff', () => {
    const archiver: Me = { ...staff, permissions: [...staff.permissions, 'tasks.archive'] };
    const done = task({ status: 'done', assignees: [as(member)] });
    expect(actionsFor(done, archiver, canOf(archiver))).toEqual(['archive']);
    expect(actionsFor({ ...done, archivedAt: '2026-11-10T10:00:00Z' }, archiver, canOf(archiver))).toEqual(['unarchive']);
    expect(actionsFor(done, member, canOf(member))).toEqual([]);
    expect(actionsFor(task({ status: 'review', assignees: [as(member)] }), archiver, canOf(archiver))).toEqual(['accept', 'return']);
    expect(predict(done, 'archive', archiver)).toMatchObject({ archivedById: archiver.id, archivedAt: expect.any(String) });
    expect(predict({ ...done, archivedAt: 'x', archivedById: 'm1' }, 'unarchive', archiver)).toMatchObject({ archivedAt: null, archivedById: null });
  });
  it('перетягування: лише дозволені переходи', () => {
    const t = task({ status: 'in_progress', assignees: [as(member)] });
    expect(dropAction(t, 'review', member, canOf(member))).toBe('submit');
    expect(dropAction(t, 'done', member, canOf(member))).toBeNull();
    // Вільне → «В роботі»: своє — «Почати»; чуже — лише останнім місцем, «взяти й почати».
    expect(dropAction(task(), 'in_progress', member, canOf(member))).toBeNull();
    expect(dropAction(task({ maxAssignees: 1 }), 'in_progress', member, canOf(member))).toBe('takeStart');
    expect(dropAction(task({ maxAssignees: 2, assignees: [as(staff)] }), 'in_progress', member, canOf(member))).toBe('takeStart');
    expect(dropAction(task({ maxAssignees: 2, assignees: [as(staff)] }), 'in_progress', staff, canOf(staff))).toBe('start');
    expect(dropAction(task({ maxAssignees: 1, assignees: [as(staff)] }), 'in_progress', member, canOf(member))).toBeNull();
    expect(dropAction(task(), 'todo', member, canOf(member))).toBeNull();
    expect(dropAction(task({ assignees: [as(member)] }), 'review', member, canOf(member))).toBeNull();
    const r = task({ status: 'review', assignees: [as(member)] });
    expect(dropAction(r, 'done', staff, canOf(staff))).toBe('accept');
    expect(dropAction(r, 'in_progress', staff, canOf(staff))).toBe('return');
    expect(dropAction(r, 'done', member, canOf(member))).toBeNull();
  });
  it('передбачений стан після дії', () => {
    const taken = predict(task(), 'take', member);
    expect(taken.status).toBe('todo');
    expect(taken.assignees.map((a) => a.id)).toEqual([member.id]);
    expect(predict(taken, 'leave', member)).toMatchObject({ status: 'todo', assignees: [] });
    expect(predict(task({ maxAssignees: 1 }), 'takeStart', member)).toMatchObject({ status: 'in_progress', assignees: [{ id: member.id }] });
    const working = task({ status: 'in_progress', assignees: [as(staff), as(member)] });
    expect(predict(working, 'leave', member)).toMatchObject({ status: 'in_progress', assignees: [{ id: staff.id }] });
    expect(predict(task({ status: 'in_progress', assignees: [as(member)] }), 'leave', member).status).toBe('todo');
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
  it('частка: рівні — одним числом, нерівні — кожна', () => {
    expect(shareLabel(splitPoints(20, 2))).toBe('кожному 10');
    expect(shareLabel(splitPoints(40, 3))).toBe('кожному 14 · 13 · 13');
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
