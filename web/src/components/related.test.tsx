import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Me, RecordLink, TaskDetail } from '../api/types';
import { task } from '../pages/tasks/logic.test';
import { json, member, mockApi, moderator, renderApp } from '../test/render';

const staff: Me = {
  ...moderator,
  permissions: [...moderator.permissions, 'tasks.manage'],
};
const detail: TaskDetail = {
  ...task({ id: 't1', title: 'Корпус' }),
  comments: [],
  files: [],
};
const link = (over: Partial<RecordLink>): RecordLink => ({
  id: 'l1',
  direction: 'out',
  type: 'document',
  recordId: 'd1',
  title: 'Паспорт',
  archived: false,
  role: '',
  createdById: 'm1',
  createdAt: '',
  canRemove: false,
  ...over,
});

function taskApi(me: Me, links: { canLink: boolean; items: RecordLink[] }, extra: Record<string, (r: Request) => Response | Promise<Response>> = {}) {
  return {
    'GET /api/auth/me': () => json(200, me),
    'GET /api/work-sessions': () => json(200, { items: [], total: 0, page: 1, limit: 1 }),
    'GET /api/records/task/field-defs': () => json(200, []),
    'GET /api/tasks/t1': () => json(200, detail),
    'GET /api/links': () => json(200, links),
    ...extra,
  };
}

const related = () => screen.findByRole('heading', { name: 'Пов’язане' }).then((h) => h.closest('section')!);

describe('Блок «Пов’язане»', () => {
  it('групи за типом, документи першими; посилання за кодом; «в архіві»', async () => {
    mockApi(
      taskApi(member, {
        canLink: false,
        items: [
          link({
            id: 'l1',
            type: 'place',
            recordId: 'p1',
            title: 'Фрезер',
            code: 'CNC-1',
            archived: true,
          }),
          link({
            id: 'l2',
            type: 'project',
            recordId: 'pr1',
            title: 'Робот',
            direction: 'in',
          }),
          link({
            id: 'l3',
            type: 'document',
            recordId: 'd1',
            title: 'Паспорт',
          }),
          link({
            id: 'l5',
            type: 'paper',
            recordId: 'pp1',
            title: 'Заява на ТЗ',
            direction: 'in',
            role: 'task',
          }),
          link({
            id: 'l4',
            type: 'inventory_item',
            recordId: 'i1',
            title: 'Фанера',
            code: 'PLY-1',
          }),
        ],
      }),
    );
    renderApp('/tasks/t1');
    const block = await related();
    expect(
      within(block)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(['Документи', 'Проєкти', 'Обладнання', 'Склад']);
    expect(within(block).getByRole('link', { name: 'Паспорт' })).toHaveAttribute('href', '/docs/d1');
    // Документ редактора — у тій самій групі «Документи».
    expect(within(within(block).getByRole('region', { name: 'Документи' })).getByRole('link', { name: 'Заява на ТЗ' })).toHaveAttribute('href', '/editor/pp1');
    expect(within(block).getByRole('link', { name: 'Робот' })).toHaveAttribute('href', '/projects/pr1');
    expect(within(block).getByRole('link', { name: 'Фрезер' })).toHaveAttribute('href', '/lab/CNC-1');
    expect(within(block).getByRole('link', { name: 'Фанера' })).toHaveAttribute('href', '/inventory/PLY-1');
    expect(within(block).getByText('в архіві')).toBeInTheDocument();
    // Cannot edit the task: nothing to add or remove.
    expect(within(block).queryByRole('button')).not.toBeInTheDocument();
  });

  it('порожньо й без права зв’язувати — блоку немає', async () => {
    mockApi(taskApi(member, { canLink: false, items: [] }));
    renderApp('/tasks/t1');
    expect(await screen.findByRole('heading', { name: 'Корпус' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Пов’язане')).not.toBeInTheDocument());
  });

  it('пов’язати: тип, пошук, вибір; уже пов’язане не пропонується', async () => {
    const { calls } = mockApi(
      taskApi(
        staff,
        {
          canLink: true,
          items: [
            link({
              type: 'project',
              recordId: 'pr1',
              title: 'Робот',
              canRemove: true,
            }),
          ],
        },
        {
          'GET /api/links/candidates': (req) => {
            const q = new URL(req.url).searchParams;
            if (q.get('type') !== 'project') return json(200, []);
            return json(200, [
              { id: 'pr1', type: 'project', title: 'Робот', archived: false },
              { id: 'pr2', type: 'project', title: 'Робот-2', archived: false },
            ]);
          },
          'POST /api/links': () =>
            json(
              201,
              link({
                id: 'l9',
                type: 'project',
                recordId: 'pr2',
                title: 'Робот-2',
              }),
            ),
        },
      ),
    );
    renderApp('/tasks/t1');
    const block = await related();
    await userEvent.click(within(block).getByRole('button', { name: 'Пов’язати' }));
    await userEvent.click(within(block).getByRole('button', { name: 'Проєкт' }));
    await userEvent.type(within(block).getByRole('searchbox'), 'роб');
    const found = await within(block).findByRole('list', { name: 'Знайдено' });
    expect(
      within(found)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Робот-2']);
    await waitFor(() => expect(calls.some((c) => c.path === '/api/links/candidates' && c.method === 'GET')).toBe(true));
    await userEvent.click(within(found).getByRole('button', { name: 'Робот-2' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/links')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(JSON.parse(post.body)).toEqual({
      fromType: 'task',
      fromId: 't1',
      toType: 'project',
      toId: 'pr2',
    });
  });

  it('прибрати зв’язок — хрестик, лише де можна', async () => {
    const { calls } = mockApi(
      taskApi(
        staff,
        {
          canLink: true,
          items: [
            link({ id: 'l1', title: 'Паспорт', canRemove: true }),
            link({
              id: 'l2',
              recordId: 'd2',
              title: 'Акт',
              direction: 'in',
              canRemove: false,
            }),
          ],
        },
        { 'DELETE /api/links/l1': () => json(200, { ok: true }) },
      ),
    );
    renderApp('/tasks/t1');
    const block = await related();
    expect(within(block).queryByRole('button', { name: 'Прибрати зв’язок з «Акт»' })).not.toBeInTheDocument();
    await userEvent.click(
      within(block).getByRole('button', {
        name: 'Прибрати зв’язок з «Паспорт»',
      }),
    );
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/links/l1')).toBe(true));
  });

  it('помилка зв’язку — текст за кодом', async () => {
    mockApi(
      taskApi(
        staff,
        { canLink: true, items: [] },
        {
          'GET /api/links/candidates': () =>
            json(200, [
              {
                id: 'd5',
                type: 'document',
                title: 'Інструкція',
                archived: false,
              },
            ]),
          'POST /api/links': () => json(409, { errorCode: 'LINK_DUPLICATE' }),
        },
      ),
    );
    renderApp('/tasks/t1');
    const block = await related();
    expect(within(block).getByText('Ще нічого не пов’язано.')).toBeInTheDocument();
    await userEvent.click(within(block).getByRole('button', { name: 'Пов’язати' }));
    await userEvent.click(await within(block).findByRole('button', { name: 'Інструкція' }));
    expect(await within(block).findByText('Ці записи вже пов’язані.')).toBeInTheDocument();
  });
});
