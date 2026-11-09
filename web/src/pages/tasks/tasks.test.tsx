import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Me, Task, TaskDetail } from '../../api/types';
import { json, member, mockApi, moderator, renderApp } from '../../test/render';
import { task } from './logic.test';

const staff: Me = { ...moderator, permissions: [...moderator.permissions, 'tasks.accept', 'tasks.create', 'tasks.manage'] };
const ref = (u: { id: string; name: string }, takenAt = '2026-11-02T10:00:00Z') => ({ id: u.id, name: u.name, avatarUrl: null, takenAt });
const iryna = { id: 'u3', name: 'Ірина Бойко' };
const andrii = { id: 'u4', name: 'Андрій Шевчук' };

function boardApi(me: Me, tasks: Task[], extra: Record<string, (req: Request) => Response | Promise<Response>> = {}) {
  return {
    'GET /api/auth/me': () => json(200, me),
    'GET /api/work-sessions': () => json(200, { items: [], total: 0, page: 1, limit: 1 }),
    'GET /api/tasks': (req: Request) => {
      const q = new URL(req.url).searchParams;
      let list = tasks.filter((t) => t.status === q.get('status'));
      if (q.get('mine') === 'true') list = list.filter((t) => t.assignees.some((a) => a.id === me.id));
      if (q.get('limit')) list = list.slice(0, Number(q.get('limit')));
      return json(200, list);
    },
    ...extra,
  };
}

const column = (name: string) => screen.getByRole('region', { name });

describe('Дошка ТЗ', () => {
  it('учасник бере ТЗ: картка переїжджає одразу, ще до відповіді сервера', async () => {
    let release!: () => void;
    const t = task({ id: 't1', title: 'Зняти репортаж' });
    const { calls } = mockApi(
      boardApi(member, [t], {
        'POST /api/tasks/t1/take': () =>
          new Promise<Response>((r) => {
            release = () => r(json(200, { ...t, status: 'queued', assignees: [ref(member)] }));
          }),
      }),
    );
    renderApp('/tasks');
    await screen.findByRole('region', { name: 'Вільне' });
    const card = await within(column('Вільне')).findByText('Зняти репортаж');
    expect(within(column('Вільне')).getByText('0 з 3')).toBeInTheDocument();
    await userEvent.click(within(card.closest('article')!).getByRole('button', { name: 'Взяти' }));
    // Optimistic: already in «В черзі».
    expect(within(column('В черзі')).getByText('Зняти репортаж')).toBeInTheDocument();
    expect(within(column('В черзі')).getByText('1 з 3 · можна приєднатися')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/api/tasks/t1/take')).toBe(true);
    release();
  });

  it('сервер відмовив — картка повертається, текст за кодом', async () => {
    const t = task({ id: 't1', title: 'Зняти репортаж' });
    mockApi(boardApi(member, [t], { 'POST /api/tasks/t1/take': () => json(409, { errorCode: 'TASK_FULL' }) }));
    renderApp('/tasks');
    await screen.findByRole('region', { name: 'Вільне' });
    const card = await within(column('Вільне')).findByText('Зняти репортаж');
    await userEvent.click(within(card.closest('article')!).getByRole('button', { name: 'Взяти' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Усі місця в цьому ТЗ уже зайняті.');
    expect(within(column('Вільне')).getByText('Зняти репортаж')).toBeInTheDocument();
  });

  it('вкладки на телефоні й «Мої»', async () => {
    const { calls } = mockApi(
      boardApi(member, [
        task({ id: 't1', title: 'Вільне ТЗ' }),
        task({ id: 't2', title: 'Моє в роботі', status: 'in_progress', assignees: [ref(member)] }),
      ]),
    );
    renderApp('/tasks');
    const tab = await screen.findByRole('tab', { name: /В роботі/ });
    await waitFor(() => expect(tab).toHaveTextContent('1'));
    await userEvent.click(tab);
    expect(tab).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Мої' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/tasks' && c.headers && c.method === 'GET')).toBe(true));
    await waitFor(() => expect(within(column('Вільне')).queryByText('Вільне ТЗ')).not.toBeInTheDocument());
    expect(within(column('В роботі')).getByText('Моє в роботі')).toBeInTheDocument();
  });

  it('модератор приймає чуже ТЗ і повертає з коментарем; своє — без кнопок', async () => {
    const theirs = task({ id: 't1', title: 'Банер', status: 'review', assignees: [ref(iryna)], updatedAt: new Date().toISOString() });
    const own = task({ id: 't2', title: 'Моє на перевірці', status: 'review', assignees: [ref(staff)] });
    const { calls } = mockApi(
      boardApi(staff, [theirs, own], { 'POST /api/tasks/t1/return': () => json(200, { ...theirs, status: 'in_progress' }) }),
    );
    renderApp('/tasks');
    await screen.findByRole('region', { name: 'На перевірці' });
    const card = (await within(column('На перевірці')).findByText('Банер')).closest('article')!;
    expect(within(card).getByText(/здано сьогодні о/)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Прийняти' })).toBeInTheDocument();
    const ownCard = within(column('На перевірці')).getByText('Моє на перевірці').closest('article')!;
    expect(within(ownCard).queryByRole('button')).not.toBeInTheDocument();

    await userEvent.click(within(card).getByRole('button', { name: 'Повернути' }));
    const submit = within(card).getByRole('button', { name: 'Повернути на допрацювання' });
    expect(submit).toBeDisabled();
    await userEvent.type(within(card).getByLabelText('Що виправити'), 'Збільшити шрифт');
    await userEvent.click(submit);
    await waitFor(() => expect(calls.some((c) => c.path === '/api/tasks/t1/return')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.path === '/api/tasks/t1/return')!.body)).toEqual({ body: 'Збільшити шрифт' });
  });

  it('перетягування: дозволений перехід виконується, заборонений — ні', async () => {
    const t = task({ id: 't1', title: 'Моє в роботі', status: 'in_progress', assignees: [ref(member)] });
    const { calls } = mockApi(
      boardApi(member, [t], {
        'POST /api/tasks/t1/submit': () => {
          t.status = 'review';
          return json(200, t);
        },
      }),
    );
    renderApp('/tasks');
    await screen.findByRole('region', { name: 'В роботі' });
    const card = (await within(column('В роботі')).findByText('Моє в роботі')).closest('article')!;
    expect(card).toHaveAttribute('draggable', 'true');
    const dt = { setData: () => undefined, effectAllowed: '' };

    fireEvent.dragStart(card, { dataTransfer: dt });
    expect(column('Виконано')).not.toHaveAttribute('data-droppable');
    fireEvent.drop(column('Виконано'), { dataTransfer: dt });
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    fireEvent.dragStart(card, { dataTransfer: dt });
    expect(column('На перевірці')).toHaveAttribute('data-droppable', 'true');
    fireEvent.dragOver(column('На перевірці'), { dataTransfer: dt });
    fireEvent.drop(column('На перевірці'), { dataTransfer: dt });
    await waitFor(() => expect(calls.some((c) => c.path === '/api/tasks/t1/submit')).toBe(true));
    expect(within(column('На перевірці')).getByText('Моє в роботі')).toBeInTheDocument();
  });

  it('виконані: поділ балів і «Показати ще»', async () => {
    const done = Array.from({ length: 31 }, (_, i) =>
      task({ id: `d${i}`, title: `Готове ${i}`, status: 'done', points: 40, assignees: [ref(member), ref(iryna), ref(andrii)] }),
    );
    mockApi(boardApi(member, done));
    renderApp('/tasks');
    const col = await screen.findByRole('region', { name: 'Виконано' });
    await waitFor(() => expect(within(col).getAllByRole('article')).toHaveLength(30));
    expect(within(col).getAllByText('14 · 13 · 13')).toHaveLength(30);
    await userEvent.click(within(col).getByRole('button', { name: 'Показати ще' }));
    await waitFor(() => expect(within(col).getAllByRole('article')).toHaveLength(31));
    expect(within(col).queryByRole('button', { name: 'Показати ще' })).not.toBeInTheDocument();
  });

  it('«Нове ТЗ» бачить лише модератор', async () => {
    mockApi(boardApi(member, []));
    renderApp('/tasks');
    await screen.findByRole('tab', { name: /Вільне/ });
    expect(screen.queryByRole('link', { name: 'Нове ТЗ' })).not.toBeInTheDocument();
  });
});

const detail = (over: Partial<TaskDetail> = {}): TaskDetail => ({ ...task(), comments: [], files: [], ...over });

describe('Сторінка ТЗ', () => {
  it('коментар повернення виділено; новий коментар; відмовитися', async () => {
    const t = detail({
      id: 't1',
      status: 'in_progress',
      assignees: [ref(member), ref(iryna, '2026-11-03T10:00:00Z')],
      comments: [{ id: 'c1', kind: 'return', body: 'Збільшити шрифт', author: { id: 'm1', name: 'Олег Петренко', avatarUrl: null }, createdAt: '2026-11-04T10:00:00Z' }],
    });
    const { calls } = mockApi({
      ...boardApi(member, []),
      'GET /api/tasks/t1': () => json(200, t),
      'POST /api/tasks/t1/comments': () => json(201, {}),
      'POST /api/tasks/t1/leave': () => json(200, { ...t, assignees: [ref(iryna)] }),
    });
    renderApp('/tasks/t1');
    expect(await screen.findByText('Повернуто на допрацювання')).toBeInTheDocument();
    expect(screen.getByText(/кожному 20 · 20/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Новий коментар'), 'Виправила');
    await userEvent.click(screen.getByRole('button', { name: 'Надіслати' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/tasks/t1/comments')).toBe(true));
    await userEvent.click(screen.getByRole('button', { name: 'Відмовитися' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/tasks/t1/leave')).toBe(true));
  });

  it('модератор видаляє вільне ТЗ після підтвердження', async () => {
    const { calls } = mockApi({
      ...boardApi(staff, []),
      'GET /api/tasks/t1': () => json(200, detail({ id: 't1' })),
      'DELETE /api/tasks/t1': () => json(200, { ok: true }),
    });
    const { router } = renderApp('/tasks/t1');
    await userEvent.click(await screen.findByRole('button', { name: 'Видалити' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Так, видалити ТЗ' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/tasks'));
  });
});

describe('Нове ТЗ', () => {
  it('дедлайн — кінець дня за Києвом; перевірка полів', async () => {
    const { calls } = mockApi({
      ...boardApi(staff, []),
      'POST /api/tasks': async (req) => json(201, { ...task(), ...(await req.json()), id: 'new1' }),
      'GET /api/tasks/new1': () => json(200, detail({ id: 'new1', title: 'Друк кріплень' })),
    });
    const { router } = renderApp('/tasks/new');
    await userEvent.type(await screen.findByLabelText('Назва'), 'Друк кріплень');
    const max = screen.getByLabelText('Максимум виконавців');
    await userEvent.clear(max);
    await userEvent.type(max, '25');
    expect(screen.getByRole('alert')).toHaveTextContent('Виконавців — від 1 до 20.');
    await userEvent.clear(max);
    await userEvent.type(max, '2');
    fireEvent.change(screen.getByLabelText('Дедлайн'), { target: { value: '2026-12-15' } });
    await userEvent.click(screen.getByRole('button', { name: 'Створити' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/tasks/new1'));
    expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body)).toEqual({
      title: 'Друк кріплень',
      description: '',
      points: 10,
      maxAssignees: 2,
      dueDate: '2026-12-15T21:59:00.000Z',
    });
  });

  it('учаснику форма закрита', async () => {
    mockApi(boardApi(member, []));
    renderApp('/tasks/new');
    expect(await screen.findByRole('heading', { name: 'Немає доступу' })).toBeInTheDocument();
  });
});
