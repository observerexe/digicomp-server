import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Me, Task, TaskDetail, TemplateItem } from '../../api/types';
import { dictionary, fieldDef, json, member, mockApi, moderator, renderApp } from '../../test/render';
import { drawSignature, stubPointerEvents } from '../../test/signature';
import { task } from './logic.test';

const staff: Me = { ...moderator, permissions: [...moderator.permissions, 'tasks.accept', 'tasks.create', 'tasks.manage'] };
const ref = (u: { id: string; name: string }, takenAt = '2026-11-02T10:00:00Z') => ({ id: u.id, name: u.name, avatarUrl: null, color: 'blue' as const, takenAt });
const iryna = { id: 'u3', name: 'Ірина Бойко' };
const andrii = { id: 'u4', name: 'Андрій Шевчук' };

function boardApi(me: Me, tasks: Task[], extra: Record<string, (req: Request) => Response | Promise<Response>> = {}) {
  return {
    'GET /api/auth/me': () => json(200, me),
    'GET /api/work-sessions': () => json(200, { items: [], total: 0, page: 1, limit: 1 }),
    'GET /api/records/task/field-defs': () => json(200, []),
    'GET /api/links': () => json(200, { canLink: false, items: [] }),
    'GET /api/tasks': (req: Request) => {
      const q = new URL(req.url).searchParams;
      let list = tasks.filter((t) => t.status === q.get('status') && !t.archivedAt);
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
            release = () => r(json(200, { ...t, assignees: [ref(member)] }));
          }),
      }),
    );
    renderApp('/tasks');
    await screen.findByRole('region', { name: 'Вільне' });
    const card = await within(column('Вільне')).findByText('Зняти репортаж');
    expect(within(column('Вільне')).getByText('0 з 3')).toBeInTheDocument();
    await userEvent.click(within(card.closest('article')!).getByRole('button', { name: 'Взяти' }));
    // Optimistic: taken at once, stays free — others may join.
    expect(within(column('Вільне')).getByText('1 з 3 · можна приєднатися')).toBeInTheDocument();
    expect(within(card.closest('article')!).getByRole('button', { name: 'Почати' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'В черзі' })).not.toBeInTheDocument();
    expect(calls.some((c) => c.path === '/api/tasks/t1/take')).toBe(true);
    release();
  });

  it('перетягування вільного на «В роботі»: останнє місце — взяти й почати', async () => {
    const t = task({ id: 't1', title: 'Зняти репортаж', maxAssignees: 2, assignees: [ref(iryna)] });
    const { calls } = mockApi(
      boardApi(member, [t], {
        'POST /api/tasks/t1/take': () => {
          Object.assign(t, { status: 'in_progress', assignees: [ref(iryna), ref(member)] });
          return json(200, t);
        },
      }),
    );
    renderApp('/tasks');
    await screen.findByRole('region', { name: 'Вільне' });
    const card = (await within(column('Вільне')).findByText('Зняти репортаж')).closest('article')!;
    const dt = { setData: () => undefined, effectAllowed: '' };
    fireEvent.dragStart(card, { dataTransfer: dt });
    expect(column('В роботі')).toHaveAttribute('data-droppable', 'true');
    fireEvent.dragOver(column('В роботі'), { dataTransfer: dt });
    fireEvent.drop(column('В роботі'), { dataTransfer: dt });
    expect(await within(column('В роботі')).findByText('Зняти репортаж')).toBeInTheDocument();
    await waitFor(() => expect(calls.find((c) => c.path === '/api/tasks/t1/take')?.body).toBe(JSON.stringify({ start: true })));
  });

  it('сервер відмовив — картка повертається, текст за кодом', async () => {
    const t = task({ id: 't1', title: 'Зняти репортаж' });
    mockApi(boardApi(member, [t], { 'POST /api/tasks/t1/take': () => json(409, { errorCode: 'TASK_FULL' }) }));
    renderApp('/tasks');
    await screen.findByRole('region', { name: 'Вільне' });
    const card = await within(column('Вільне')).findByText('Зняти репортаж');
    await userEvent.click(within(card.closest('article')!).getByRole('button', { name: 'Взяти' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Усі місця в цьому технічному завданні вже зайняті.');
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

  it('«Прийняти», коли документ ТЗ чекає підпису того, хто приймає: без підпису не прийнято; вікно → «Підписати» — прийнято з малюнком', async () => {
    stubPointerEvents();
    const t = task({ id: 't1', title: 'Банер', status: 'review', assignees: [ref(iryna)], paper: { id: 'p1', number: 'ТЗ-2026-003' } });
    const wanted = { statusCode: 409, message: 'Paper signature required', errorCode: 'PAPER_SIGNATURE_REQUIRED', paperId: 'p1', number: 'ТЗ-2026-003', title: 'Банер', lines: ['Роботу прийняв'] };
    const { calls } = mockApi(
      boardApi(staff, [t], {
        'POST /api/tasks/t1/accept': async (req: Request) => {
          if (!(await req.text()).includes('strokes')) return json(409, wanted);
          t.status = 'done';
          return json(200, t);
        },
      }),
    );
    const accepts = () => calls.filter((c) => c.path === '/api/tasks/t1/accept');
    renderApp('/tasks');
    const card = (await within(await screen.findByRole('region', { name: 'На перевірці' })).findByText('Банер')).closest('article')!;
    await userEvent.click(within(card).getByRole('button', { name: 'Прийняти' }));
    const dialog = await screen.findByRole('dialog', { name: 'Підписати документ' });
    expect(dialog).toHaveAccessibleDescription('«Роботу прийняв» · № ТЗ-2026-003. Підпис не можна зняти.');
    // Not accepted yet: the card is back on review.
    expect(within(column('На перевірці')).getByText('Банер')).toBeInTheDocument();
    expect(screen.queryByText('Документ чекає вашого підпису: спершу підпишіть його.')).not.toBeInTheDocument();
    drawSignature(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Підписати' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(accepts()).toHaveLength(2);
    expect(JSON.parse(accepts()[1]!.body)).toEqual({ strokes: [[10, 10, 20, 20]] });
    expect(await within(column('Виконано')).findByText('Банер')).toBeInTheDocument();
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
    expect(within(col).getAllByText('+14 / +13 / +13')).toHaveLength(30);
    expect(within(col).getAllByText('+14 / +13 / +13')[0]).toHaveAttribute(
      'title',
      `${member.name} +14, Ірина Бойко +13, Андрій Шевчук +13`,
    );
    await userEvent.click(within(col).getByRole('button', { name: 'Показати ще' }));
    await waitFor(() => expect(within(col).getAllByRole('article')).toHaveLength(31));
    expect(within(col).queryByRole('button', { name: 'Показати ще' })).not.toBeInTheDocument();
  });

  it('додаткові поля: смужка з першого поля вибору, фільтри за пунктами', async () => {
    const level = fieldDef({ key: 'level', label: 'Складність', dictionary: 'level' });
    const tags = fieldDef({ key: 'tags', label: 'Теги', type: 'list<enum>', dictionary: 'tags' });
    mockApi(
      boardApi(
        member,
        [
          task({ id: 't1', title: 'Банер', extra: { typ: 'dyzain', level: 'easy', tags: ['print'] } }),
          task({ id: 't2', title: 'Ролик', extra: { typ: 'video', tags: ['web', 'print'] } }),
          task({ id: 't3', title: 'Без типу' }),
        ],
        {
          'GET /api/records/task/field-defs': () => json(200, [fieldDef({ key: 'old', archived: true }), fieldDef(), level, tags]),
          ...dictionary('typ_tz', [
            { key: 'dyzain', title: 'Дизайн', color: 'purple' },
            { key: 'video', title: 'Відео', color: 'blue' as const },
          ]),
          ...dictionary('level', [{ key: 'easy', title: 'Легке' }]),
          ...dictionary('tags', [
            { key: 'web', title: 'Сайт' },
            { key: 'print', title: 'Друк' },
          ]),
        },
      ),
    );
    renderApp('/tasks');
    const banner = (await within(await screen.findByRole('region', { name: 'Вільне' })).findByText('Банер')).closest('article')!;
    await waitFor(() => expect(banner).toHaveClass('pal-purple'));
    expect(within(banner).getByText('Дизайн')).toBeInTheDocument();
    expect(within(column('Вільне')).getByText('Без типу').closest('article')).not.toHaveClass('pal-purple');

    const byType = screen.getByRole('group', { name: 'Тип' });
    // «Складність»: one item on the board — nothing to choose between.
    expect(screen.queryByRole('group', { name: 'Складність' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Теги' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Усі', 'Сайт', 'Друк']);
    await userEvent.click(within(byType).getByRole('button', { name: 'Відео' }));
    expect(within(column('Вільне')).queryByText('Банер')).not.toBeInTheDocument();
    expect(within(column('Вільне')).getByText('Ролик')).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('group', { name: 'Теги' })).getByRole('button', { name: 'Сайт' }));
    expect(within(column('Вільне')).getByText('Ролик')).toBeInTheDocument();
    await userEvent.click(within(byType).getByRole('button', { name: 'Дизайн' }));
    expect(within(column('Вільне')).getByText('Нічого не знайдено.')).toBeInTheDocument();
  });

  it('модератор: «В архів» на виконаній картці — картка зникає з дошки; «Усі виконані — в архів» з підтвердженням', async () => {
    const archiver: Me = { ...staff, permissions: [...staff.permissions, 'tasks.archive'] };
    const one = task({ id: 'd1', title: 'Готове 1', status: 'done', assignees: [ref(iryna)] });
    const two = task({ id: 'd2', title: 'Готове 2', status: 'done', assignees: [ref(iryna)] });
    const { calls } = mockApi(
      boardApi(archiver, [one, two], {
        'POST /api/tasks/d1/archive': () => json(200, Object.assign(one, { archivedAt: '2026-11-16T10:00:00Z' })),
        'POST /api/tasks/archive-done': () => json(200, { count: 1 }),
      }),
    );
    renderApp('/tasks');
    const col = await screen.findByRole('region', { name: 'Виконано' });
    const card = (await within(col).findByText('Готове 1')).closest('article')!;
    await userEvent.click(within(card).getByRole('button', { name: 'В архів' }));
    await waitFor(() => expect(within(col).queryByText('Готове 1')).not.toBeInTheDocument());
    expect(calls.some((c) => c.path === '/api/tasks/d1/archive')).toBe(true);

    await userEvent.click(within(col).getByRole('button', { name: 'Усі виконані — в архів' }));
    expect(calls.some((c) => c.path === '/api/tasks/archive-done')).toBe(false);
    await userEvent.click(within(col).getByRole('button', { name: 'Так, в архів' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/tasks/archive-done' && c.method === 'POST')).toBe(true));
  });

  it('учасник: без кнопок архіву; «Архів» — список з пошуком, роком і «Показати ще»', async () => {
    const archived = (i: number) =>
      task({ id: `a${i}`, title: `Архівне ${i}`, status: 'done', assignees: [ref(iryna)], completedAt: '2026-10-01T10:00:00Z', archivedAt: '2026-11-01T10:00:00Z' });
    const { calls } = mockApi(
      boardApi(member, [task({ id: 'd1', title: 'Готове', status: 'done', assignees: [ref(member)] })], {
        'GET /api/tasks/archive': (req: Request) => {
          const q = new URL(req.url).searchParams;
          const page = Number(q.get('page'));
          const items = q.get('search') ? [archived(99)] : page === 1 ? Array.from({ length: 30 }, (_, i) => archived(i)) : [archived(30)];
          return json(200, { items, total: q.get('search') ? 1 : 31, page, limit: 30, years: [2026, 2025] });
        },
      }),
    );
    renderApp('/tasks');
    const col = await screen.findByRole('region', { name: 'Виконано' });
    const card = (await within(col).findByText('Готове')).closest('article')!;
    expect(within(card).queryByRole('button', { name: 'В архів' })).not.toBeInTheDocument();
    expect(within(col).queryByRole('button', { name: 'Усі виконані — в архів' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Архів' }));
    expect(await screen.findByText('31 технічне завдання')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Виконано' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(30);
    expect(screen.getAllByText('прийнято 1 жовт.')[0]).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Повернути з архіву' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Показати ще' }));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(31));
    expect(screen.queryByRole('button', { name: 'Показати ще' })).not.toBeInTheDocument();

    await userEvent.click(within(screen.getByRole('group', { name: 'Рік прийняття' })).getByRole('button', { name: '2025' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/tasks/archive' && c.url.includes('year=2025'))).toBe(true));
    await userEvent.type(screen.getByRole('searchbox'), 'відео');
    expect(await screen.findByText('Архівне 99')).toBeInTheDocument();
  });

  it('«Нове ТЗ» бачить лише модератор', async () => {
    mockApi(boardApi(member, []));
    renderApp('/tasks');
    await screen.findByRole('tab', { name: /Вільне/ });
    expect(screen.queryByRole('button', { name: 'Нове технічне завдання' })).not.toBeInTheDocument();
  });

  it('картка показує номер документа ТЗ', async () => {
    mockApi(boardApi(member, [task({ id: 't1', title: 'Банер', paper: { id: 'p1', number: 'ТЗ-2026-014' } })]));
    renderApp('/tasks');
    const card = (await within(await screen.findByRole('region', { name: 'Вільне' })).findByText('Банер')).closest('article')!;
    expect(within(card).getByText('ТЗ-2026-014')).toBeInTheDocument();
  });
});

const detail = (over: Partial<TaskDetail> = {}): TaskDetail => ({ ...task(), comments: [], files: [], ...over });

describe('Сторінка ТЗ', () => {
  it('коментар повернення виділено; новий коментар; відмовитися', async () => {
    const t = detail({
      id: 't1',
      status: 'in_progress',
      assignees: [ref(member), ref(iryna, '2026-11-03T10:00:00Z')],
      comments: [{ id: 'c1', kind: 'return', body: 'Збільшити шрифт', author: { id: 'm1', name: 'Олег Петренко', avatarUrl: null, color: 'blue' as const }, createdAt: '2026-11-04T10:00:00Z' }],
    });
    const { calls } = mockApi({
      ...boardApi(member, []),
      'GET /api/tasks/t1': () => json(200, t),
      'POST /api/tasks/t1/comments': () => json(201, {}),
      'POST /api/tasks/t1/leave': () => json(200, { ...t, assignees: [ref(iryna)] }),
    });
    renderApp('/tasks/t1');
    expect(await screen.findByText('Повернуто на допрацювання')).toBeInTheDocument();
    expect(screen.getByText(/кожному 20$/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Новий коментар'), 'Виправила');
    await userEvent.click(screen.getByRole('button', { name: 'Надіслати' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/tasks/t1/comments')).toBe(true));
    await userEvent.click(screen.getByRole('button', { name: 'Відмовитися' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/tasks/t1/leave')).toBe(true));
  });

  it('додаткові поля: заповнені видно, порожні й невідомі — ні', async () => {
    mockApi({
      ...boardApi(member, []),
      'GET /api/records/task/field-defs': () =>
        json(200, [
          fieldDef(),
          fieldDef({ key: 'hours', label: 'Години', type: 'int', dictionary: null }),
          fieldDef({ key: 'urgent', label: 'Терміново', type: 'bool', dictionary: null }),
          fieldDef({ key: 'old', label: 'Старе', type: 'text', dictionary: null, archived: true }),
        ]),
      ...dictionary('typ_tz', [{ key: 'dyzain', title: 'Дизайн', color: 'purple' }]),
      'GET /api/tasks/t1': () => json(200, detail({ id: 't1', extra: { typ: 'dyzain', urgent: true, old: 'Було' } })),
    });
    renderApp('/tasks/t1');
    const typ = (await screen.findByText('Тип')).closest('div')!;
    await waitFor(() => expect(within(typ).getByText('Дизайн')).toHaveClass('pal-purple'));
    expect((screen.getByText('Терміново').closest('div')!).textContent).toBe('ТерміновоТак');
    expect((screen.getByText('Старе').closest('div')!).textContent).toBe('СтареБуло');
    expect(screen.queryByText('Години')).not.toBeInTheDocument();
  });

  it('ТЗ з документом: «Відкрити документ»; модератор скасовує з причиною — документ', async () => {
    const t = detail({ id: 't1', paper: { id: 'p1', number: 'ТЗ-2026-014' } });
    const { calls } = mockApi({
      ...boardApi(staff, []),
      'GET /api/tasks/t1': () => json(200, t),
      'POST /api/papers/p1/cancel': () => json(200, {}),
    });
    const { router } = renderApp('/tasks/t1');
    expect(await screen.findByText('ТЗ-2026-014')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Відкрити документ' })).toHaveAttribute('href', '/editor/p1');
    expect(screen.queryByRole('button', { name: 'Редагувати' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Скасувати технічне завдання' }));
    expect(screen.getByText(/документ стане «Скасовано»/)).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Скасувати технічне завдання' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Причина скасування'), 'Не потрібно');
    await userEvent.click(confirm);
    await waitFor(() => expect(router.state.location.pathname).toBe('/tasks'));
    expect(JSON.parse(calls.find((c) => c.path === '/api/papers/p1/cancel')!.body)).toEqual({ reason: 'Не потрібно' });
  });

  it('прийняте ТЗ: документ чекає мого підпису — «Підписати документ» (необов’язково)', async () => {
    const reader: Me = { ...staff, permissions: [...staff.permissions, 'papers.read'] };
    const done = detail({ id: 't1', status: 'done', paper: { id: 'p1', number: 'ТЗ-2026-014' } });
    mockApi({ ...boardApi(reader, []), 'GET /api/tasks/t1': () => json(200, done), 'GET /api/papers/p1': () => json(200, { canSignDrawn: true }) });
    renderApp('/tasks/t1');
    expect(await screen.findByRole('link', { name: 'Підписати документ' })).toHaveAttribute('href', '/editor/p1');
    expect(screen.getByText(/чекає вашого підпису/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Відкрити документ' })).toBeInTheDocument();
  });

  it('прийняте ТЗ, підпис не чекає — лише «Відкрити документ»', async () => {
    const reader: Me = { ...staff, permissions: [...staff.permissions, 'papers.read'] };
    const done = detail({ id: 't1', status: 'done', paper: { id: 'p1', number: 'ТЗ-2026-014' } });
    const { calls } = mockApi({ ...boardApi(reader, []), 'GET /api/tasks/t1': () => json(200, done), 'GET /api/papers/p1': () => json(200, { canSignDrawn: false }) });
    renderApp('/tasks/t1');
    await screen.findByRole('link', { name: 'Відкрити документ' });
    await waitFor(() => expect(calls.some((c) => c.path === '/api/papers/p1')).toBe(true));
    expect(screen.queryByRole('link', { name: 'Підписати документ' })).not.toBeInTheDocument();
  });

  it('учасник бачить «Відкрити документ», але не «Скасувати ТЗ»', async () => {
    mockApi({ ...boardApi(member, []), 'GET /api/tasks/t1': () => json(200, detail({ id: 't1', paper: { id: 'p1', number: null } })) });
    renderApp('/tasks/t1');
    expect(await screen.findByRole('link', { name: 'Відкрити документ' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Скасувати технічне завдання' })).not.toBeInTheDocument();
  });

  it('старе ТЗ без документа: скасування з причиною — саме ТЗ', async () => {
    const { calls } = mockApi({
      ...boardApi(staff, []),
      'GET /api/tasks/t1': () => json(200, detail({ id: 't1' })),
      'GET /api/papers/templates': () => json(200, []),
      'POST /api/tasks/t1/cancel': () => json(200, { ok: true }),
    });
    const { router } = renderApp('/tasks/t1');
    await userEvent.click(await screen.findByRole('button', { name: 'Скасувати технічне завдання' }));
    await userEvent.type(screen.getByLabelText('Причина скасування'), 'Дубль');
    await userEvent.click(screen.getByRole('button', { name: 'Скасувати технічне завдання' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/tasks'));
    expect(JSON.parse(calls.find((c) => c.path === '/api/tasks/t1/cancel')!.body)).toEqual({ reason: 'Дубль' });
  });
});

const template = (over: Partial<TemplateItem> = {}): TemplateItem => ({
  id: 'tz',
  title: 'Технічне завдання',
  kind: 'creates',
  target: 'task',
  numberPrefix: 'ТЗ',
  autoFreeze: true,
  creators: 'staff',
  visibility: 'members',
  archived: false,
  currentVersion: 1,
  draftVersion: null,
  needsUpdate: false,
  about: [],
  createdAt: '2026-11-01T10:00:00Z',
  updatedAt: '2026-11-01T10:00:00Z',
  ...over,
});

describe('Архівне ТЗ', () => {
  it('мітка «В архіві з …»; модератор повертає з архіву', async () => {
    const archiver: Me = { ...staff, permissions: [...staff.permissions, 'tasks.archive'] };
    const t = detail({ id: 't1', status: 'done', assignees: [ref(iryna)], archivedAt: '2026-11-10T10:00:00Z', archivedById: 'm1' });
    const { calls } = mockApi({
      ...boardApi(archiver, []),
      'GET /api/tasks/t1': () => json(200, t),
      'POST /api/tasks/t1/unarchive': () => json(200, { ...t, archivedAt: null, archivedById: null }),
    });
    renderApp('/tasks/t1');
    expect(await screen.findByText(/В архіві з 10 лист/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Повернути з архіву' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/tasks/t1/unarchive')).toBe(true));
  });
});

describe('ТЗ через документ', () => {
  it('один шаблон, що створює ТЗ, — «Нове ТЗ» одразу відкриває документ', async () => {
    const { calls } = mockApi({
      ...boardApi(staff, []),
      'GET /api/papers/templates': () => json(200, [template(), template({ id: 'free', title: 'Заява', kind: 'free', target: null })]),
      'POST /api/papers': () => json(201, { id: 'n1' }),
    });
    const { router } = renderApp('/tasks');
    const button = await screen.findByRole('button', { name: 'Нове технічне завдання' });
    await waitFor(() => expect(button).toBeEnabled());
    expect(button).not.toHaveAttribute('aria-haspopup');
    await userEvent.click(button);
    await waitFor(() => expect(router.state.location.pathname).toBe('/editor/n1'));
    expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body)).toEqual({ templateId: 'tz' });
  });

  it('кілька — короткий вибір', async () => {
    const { calls } = mockApi({
      ...boardApi(staff, []),
      'GET /api/papers/templates': () => json(200, [template(), template({ id: 'short', title: 'Коротке ТЗ' })]),
      'POST /api/papers': () => json(201, { id: 'n1' }),
    });
    const { router } = renderApp('/tasks');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Нове технічне завдання' })).toHaveAttribute('aria-haspopup', 'menu'));
    const button = screen.getByRole('button', { name: 'Нове технічне завдання' });
    await userEvent.click(button);
    // A menu: the focus on its first item, ↓ to the next, Escape back to the button.
    const items = within(screen.getByRole('menu', { name: 'Нове технічне завдання' })).getAllByRole('menuitem');
    expect(items[0]).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(items[1]).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(items[0]).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    await userEvent.click(button);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Коротке ТЗ' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/editor/n1'));
    expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body)).toEqual({ templateId: 'short' });
  });

  it('без шаблону, що створює ТЗ, «Нове ТЗ» неактивне з підказкою', async () => {
    mockApi({ ...boardApi(staff, []), 'GET /api/papers/templates': () => json(200, [template({ archived: true })]) });
    renderApp('/tasks');
    const button = await screen.findByRole('button', { name: 'Нове технічне завдання' });
    await waitFor(() => expect(button).toHaveAttribute('title', expect.stringContaining('Немає шаблону')));
    expect(button).toBeDisabled();
  });

  it('«Редагувати» старого ТЗ створює його документ і відкриває одразу для зміни', async () => {
    const { calls } = mockApi({
      ...boardApi(staff, []),
      'GET /api/tasks/t1': () => json(200, detail({ id: 't1' })),
      'GET /api/papers/templates': () => json(200, [template()]),
      'POST /api/papers/for-record': () => json(201, { id: 'p9' }),
    });
    const { router } = renderApp('/tasks/t1');
    const edit = await screen.findByRole('button', { name: 'Редагувати' });
    await waitFor(() => expect(edit).toBeEnabled());
    await userEvent.click(edit);
    await waitFor(() => expect(router.state.location.pathname).toBe('/editor/p9'));
    expect(router.state.location.state).toEqual({ change: true });
    expect(JSON.parse(calls.find((c) => c.path === '/api/papers/for-record')!.body)).toEqual({ templateId: 'tz', targetId: 't1' });
  });

  it('старі адреси форми ТЗ не відкриваються', async () => {
    mockApi(boardApi(staff, []));
    renderApp('/tasks/t1/edit');
    expect(await screen.findByRole('heading', { name: 'Сторінку не знайдено' })).toBeInTheDocument();
  });
});
