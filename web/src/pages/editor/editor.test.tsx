import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Me, Paper, PaperField, TemplateItem } from '../../api/types';
import { json, member, mockApi, moderator, renderApp } from '../../test/render';

const writer: Me = { ...member, permissions: [...member.permissions, 'papers.read', 'papers.create', 'papers.edit'] };
const staff: Me = { ...moderator, permissions: [...moderator.permissions, 'papers.read', 'papers.read_all', 'papers.create', 'papers.edit'] };

const text = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const paper = (over: Partial<Paper> = {}): Paper => ({
  id: 'p1',
  title: 'Протокол зборів',
  status: 'draft',
  visibility: 'author',
  author: { id: 'u1', name: 'Марта Коваль', avatarUrl: null },
  revision: 1,
  createdAt: '2026-11-14T10:00:00Z',
  updatedAt: '2026-11-14T10:00:00Z',
  content: text('Порядок денний'),
  values: {},
  template: null,
  canEdit: true,
  ...over,
});
const item = (p: Paper) => {
  const { content: _c, canEdit: _e, values: _v, template: _t, ...rest } = p;
  return rest;
};
const base = (me: Me, extra: Record<string, (r: Request) => Response | Promise<Response>> = {}) => ({
  'GET /api/auth/me': () => json(200, me),
  'GET /api/work-sessions': () => json(200, { items: [], total: 0, page: 1, limit: 1 }),
  ...extra,
});

describe('Редактор: список', () => {
  it('пункт меню бачить той, хто має papers.read', async () => {
    mockApi(base(writer, { 'GET /api/papers': () => json(200, { items: [], total: 0, page: 1, limit: 100 }) }));
    renderApp('/editor');
    expect((await screen.findAllByRole('link', { name: 'Редактор' })).length).toBeGreaterThan(0);
  });

  it('вкладки «Мої» й «Усі»: ?mine=true лише в «Моїх», автор — в «Усіх»', async () => {
    const mineParams: (string | null)[] = [];
    mockApi(
      base(staff, {
        'GET /api/papers': (r) => {
          const mine = new URL(r.url).searchParams.get('mine');
          mineParams.push(mine);
          const items = mine ? [item(paper({ author: { id: 'm1', name: 'Олег Петренко', avatarUrl: null } }))] : [item(paper()), item(paper({ id: 'p2', title: 'Наказ', status: 'published' }))];
          return json(200, { items, total: items.length, page: 1, limit: 100 });
        },
      }),
    );
    renderApp('/editor');
    const list = await screen.findByRole('list', { name: 'Документи редактора' });
    expect(within(list).getAllByRole('link')).toHaveLength(1);
    expect(within(list).getByText('Чернетка')).toBeInTheDocument();
    expect(within(list).queryByText(/Олег Петренко/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Усі' }));
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Документи редактора' })).getAllByRole('link')).toHaveLength(2));
    expect(screen.getByText('Опубліковано')).toBeInTheDocument();
    expect(screen.getAllByText(/Марта Коваль · оновлено/)).toHaveLength(2);
    expect(mineParams).toEqual(['true', null]);
  });

  it('«Новий документ» створює чернетку й відкриває її', async () => {
    const { calls } = mockApi(
      base(writer, {
        'GET /api/papers': () => json(200, { items: [], total: 0, page: 1, limit: 100 }),
        'POST /api/papers': () => json(201, paper({ id: 'n1', title: 'Без назви', content: { type: 'doc', content: [{ type: 'paragraph' }] } })),
        'GET /api/papers/n1': () => json(200, paper({ id: 'n1', title: 'Без назви', content: { type: 'doc', content: [{ type: 'paragraph' }] } })),
      }),
    );
    const { router } = renderApp('/editor');
    expect(await screen.findByText('У вас ще немає документів.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Новий документ' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/editor/n1'));
    expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body)).toEqual({});
    expect(await screen.findByLabelText('Назва документа')).toHaveValue('Без назви');
  });

  it('без papers.create кнопки немає', async () => {
    mockApi(base({ ...member, permissions: [...member.permissions, 'papers.read'] }, { 'GET /api/papers': () => json(200, { items: [], total: 0, page: 1, limit: 100 }) }));
    renderApp('/editor');
    expect(await screen.findByText('У вас ще немає документів.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Новий документ' })).not.toBeInTheDocument();
  });
});

describe('Редактор: документ', () => {
  it('відкриває вміст на аркуші; назва зберігається автоматично з revision', async () => {
    const { calls } = mockApi(base(writer, { 'GET /api/papers/p1': () => json(200, paper()), 'PATCH /api/papers/p1': () => json(200, { ...item(paper()), revision: 2, updatedAt: '2026-11-14T12:30:00Z' }) }));
    renderApp('/editor/p1');
    const sheet = await screen.findByLabelText('Текст документа');
    expect(sheet).toHaveTextContent('Порядок денний');
    expect(sheet).toHaveClass('paper');
    expect(sheet).toHaveAttribute('contenteditable', 'true');
    const title = screen.getByLabelText('Назва документа');
    await userEvent.clear(title);
    await userEvent.type(title, 'Протокол №2');
    expect(await screen.findByText(/^Збережено о /, undefined, { timeout: 4000 })).toBeInTheDocument();
    const patches = calls.filter((c) => c.method === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(JSON.parse(patches[0]!.body)).toEqual({ revision: 1, title: 'Протокол №2' });
  });

  it('порожня назва не надсилається і повертається після виходу з поля', async () => {
    const { calls } = mockApi(base(writer, { 'GET /api/papers/p1': () => json(200, paper()) }));
    renderApp('/editor/p1');
    const title = await screen.findByLabelText('Назва документа');
    await userEvent.clear(title);
    await userEvent.tab();
    expect(title).toHaveValue('Протокол зборів');
    await new Promise((r) => setTimeout(r, 1700));
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
  });

  it('конфлікт: банер; «Зберегти мою як копію» створює нову чернетку з моїм текстом', async () => {
    const { calls } = mockApi(
      base(writer, {
        'GET /api/papers/p1': () => json(200, paper()),
        'PATCH /api/papers/p1': () => json(409, { errorCode: 'PAPER_CONFLICT' }),
        'POST /api/papers/p1/copy': () => json(201, paper({ id: 'c1' })),
        'GET /api/papers/c1': () => json(200, paper({ id: 'c1', title: 'Мій протокол (копія)' })),
      }),
    );
    const { router } = renderApp('/editor/p1');
    const title = await screen.findByLabelText('Назва документа');
    await userEvent.type(title, '!');
    const banner = await screen.findByRole('alert', undefined, { timeout: 4000 });
    expect(banner).toHaveTextContent('Документ змінили в іншому вікні');
    await userEvent.click(within(banner).getByRole('button', { name: 'Зберегти мою як копію' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/editor/c1'));
    const post = JSON.parse(calls.find((c) => c.method === 'POST')!.body);
    expect(post).toEqual({
      title: 'Протокол зборів! (копія)',
      content: { type: 'doc', content: [{ type: 'paragraph', attrs: { align: null, indent: 0 }, content: [{ type: 'text', text: 'Порядок денний' }] }] },
      values: {},
    });
  });

  it('конфлікт: «Відкрити останню версію» завантажує документ знову', async () => {
    let version = 1;
    mockApi(
      base(writer, {
        'GET /api/papers/p1': () => json(200, version === 1 ? paper() : paper({ revision: 5, content: text('Чужий текст') })),
        'PATCH /api/papers/p1': () => json(409, { errorCode: 'PAPER_CONFLICT' }),
      }),
    );
    renderApp('/editor/p1');
    await userEvent.type(await screen.findByLabelText('Назва документа'), '!');
    const banner = await screen.findByRole('alert', undefined, { timeout: 4000 });
    version = 2;
    await userEvent.click(within(banner).getByRole('button', { name: 'Відкрити останню версію' }));
    expect(await screen.findByText('Чужий текст')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Назва документа')).toHaveValue('Протокол зборів');
  });

  it('«Попередній перегляд»: спершу зберігає зміни, потім відкриває сторінку друку в новій вкладці', async () => {
    const { calls } = mockApi(base(writer, { 'GET /api/papers/p1': () => json(200, paper()), 'PATCH /api/papers/p1': () => json(200, { ...item(paper()), revision: 2 }) }));
    let patchesAtOpen = -1;
    const tab = { opener: {}, location: { replace: vi.fn(() => (patchesAtOpen = calls.filter((c) => c.method === 'PATCH').length)) } };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    renderApp('/editor/p1');
    await userEvent.type(await screen.findByLabelText('Назва документа'), ' 2');
    await userEvent.click(screen.getByRole('button', { name: 'Попередній перегляд' }));
    expect(open).toHaveBeenCalledWith('', '_blank');
    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith('/api/papers/p1/print'));
    expect(patchesAtOpen).toBe(1);
    expect(tab.opener).toBeNull();
    open.mockRestore();
  });

  it('«Попередній перегляд» є й у документі лише для перегляду', async () => {
    mockApi(base(writer, { 'GET /api/papers/p1': () => json(200, paper({ status: 'published' })) }));
    renderApp('/editor/p1');
    expect(await screen.findByRole('button', { name: 'Попередній перегляд' })).toBeInTheDocument();
  });

  it('чужа чернетка (модератор) — лише перегляд, без видалення', async () => {
    mockApi(base(staff, { 'GET /api/papers/p1': () => json(200, paper({ canEdit: false })) }));
    renderApp('/editor/p1');
    const sheet = await screen.findByLabelText('Текст документа');
    expect(sheet).toHaveAttribute('contenteditable', 'false');
    expect(screen.getByRole('heading', { name: 'Протокол зборів' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Назва документа')).not.toBeInTheDocument();
    expect(screen.getByText('Це чужа чернетка: її можна лише переглядати.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Видалити чернетку' })).not.toBeInTheDocument();
  });

  it('опублікований документ не редагується', async () => {
    mockApi(base(writer, { 'GET /api/papers/p1': () => json(200, paper({ status: 'published' })) }));
    renderApp('/editor/p1');
    expect(await screen.findByLabelText('Текст документа')).toHaveAttribute('contenteditable', 'false');
    expect(screen.getByText('Документ уже не чернетка: текст не змінюється.')).toBeInTheDocument();
  });

  it('видалення чернетки з підтвердженням веде до списку', async () => {
    const { calls } = mockApi(
      base(writer, {
        'GET /api/papers/p1': () => json(200, paper()),
        'DELETE /api/papers/p1': () => json(200, { ok: true }),
        'GET /api/papers': () => json(200, { items: [], total: 0, page: 1, limit: 100 }),
      }),
    );
    const { router } = renderApp('/editor/p1');
    await userEvent.click(await screen.findByRole('button', { name: 'Видалити чернетку' }));
    await userEvent.click(screen.getByRole('button', { name: 'Видалити' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/editor'));
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/papers/p1')).toBe(true);
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
  });

  it('недоступний документ — текст помилки й шлях назад', async () => {
    mockApi(base(writer, { 'GET /api/papers/p1': () => json(404, { errorCode: 'PAPER_NOT_FOUND' }) }));
    renderApp('/editor/p1');
    expect(await screen.findByText(/Документ не знайдено/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Редактор' }).some((l) => l.getAttribute('href') === '/editor')).toBe(true);
  });
});

describe('Редактор: новий документ із шаблону', () => {
  const tpl = (over: Partial<TemplateItem> = {}): TemplateItem => ({
    id: 't1',
    title: 'Заява',
    kind: 'free',
    target: null,
    numberPrefix: null,
    autoFreeze: false,
    creators: 'all',
    visibility: 'author',
    archived: false,
    currentVersion: 1,
    draftVersion: null,
    needsUpdate: false,
    createdAt: '2026-11-14T10:00:00Z',
    updatedAt: '2026-11-14T10:00:00Z',
    ...over,
  });

  it('є шаблони — меню: порожній або з шаблону; зламаний шаблон не вибирається', async () => {
    const { calls } = mockApi(
      base(writer, {
        'GET /api/papers': () => json(200, { items: [], total: 0, page: 1, limit: 100 }),
        'GET /api/papers/templates': () =>
          json(200, [tpl(), tpl({ id: 't2', title: 'Акт', needsUpdate: true }), tpl({ id: 't3', title: 'Чернетка шаблону', currentVersion: null })]),
        'POST /api/papers': () => json(201, paper({ id: 'n1' })),
        'GET /api/papers/n1': () => json(200, paper({ id: 'n1' })),
      }),
    );
    const { router } = renderApp('/editor');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Новий документ' })).toHaveAttribute('aria-haspopup', 'true'));
    await userEvent.click(screen.getByRole('button', { name: 'Новий документ' }));
    const menu = screen.getByRole('list', { name: 'Новий документ' });
    expect(
      within(menu)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Порожній документ', 'Заява', 'АктШаблон потребує оновлення']);
    expect(within(menu).getByRole('button', { name: /Акт/ })).toBeDisabled();
    await userEvent.click(within(menu).getByRole('button', { name: 'Заява' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/editor/n1'));
    expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body)).toEqual({ templateId: 't1' });
  });
});

describe('Редактор: документ із шаблону', () => {
  const f = (over: Partial<PaperField> & Pick<PaperField, 'key' | 'label'>): PaperField => ({
    type: 'text',
    required: false,
    fill: 'author',
    editable: false,
    print: true,
    min: null,
    max: null,
    maxLength: null,
    maxItems: null,
    scale: null,
    options: null,
    plain: false,
    canFill: true,
    ...over,
  });
  const FIELDS: PaperField[] = [
    f({ key: 'name', label: 'Ім’я', required: true }),
    f({ key: 'count', label: 'Кількість', type: 'int', min: 1, max: 10 }),
    f({
      key: 'level',
      label: 'Рівень',
      type: 'enum',
      options: [
        { key: 'high', label: 'Високий' },
        { key: 'old', label: 'Старий', archived: true },
      ],
    }),
    f({ key: 'who', label: 'Відповідальний', type: 'ref:user', canFill: false }),
    f({ key: 'goal', label: 'Мета', type: 'richtext', required: true, plain: true }),
    f({ key: 'verdict', label: 'Висновок', fill: 'staff', canFill: false }),
  ];
  const content = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Заява від ' },
          { type: 'field', attrs: { key: 'name' } },
        ],
      },
      ...['count', 'level', 'who', 'verdict'].map((key) => ({ type: 'paragraph', content: [{ type: 'field', attrs: { key } }] })),
      { type: 'fieldZone', attrs: { key: 'goal' }, content: [{ type: 'paragraph' }] },
    ],
  };
  const fromTemplate = (over: Partial<Paper> = {}) => paper({ title: 'Заява', content, values: {}, template: { id: 't1', title: 'Заява', version: 2, fields: FIELDS }, ...over });
  const sheetField = (key: string) => document.querySelector(`.ProseMirror .paper-field[data-field="${key}"]`)!;

  it('панель «Поля»: шаблон, прогрес, що не заповнено, групи; стрічка поза зоною вимкнена', async () => {
    mockApi(base(writer, { 'GET /api/papers/p1': () => json(200, fromTemplate()) }));
    renderApp('/editor/p1');
    const panel = await screen.findByRole('complementary', { name: 'Поля документа' });
    expect(within(panel).getByText('Шаблон «Заява» · v2')).toBeInTheDocument();
    expect(within(panel).getByText('0 з 4')).toBeInTheDocument();
    expect(within(panel).getByText('Не заповнено: Ім’я, Мета')).toBeInTheDocument();
    expect(within(panel).getByText('Заповнюєте ви')).toBeInTheDocument();
    expect(within(panel).getByText('Заповнить модератор')).toBeInTheDocument();
    expect(within(panel).getByLabelText('Відповідальний')).toBeDisabled();
    expect(within(panel).getByLabelText('Відповідальний')).toHaveAttribute('placeholder', 'Вибір з’явиться згодом');
    expect(within(panel).getByLabelText('Висновок')).toBeDisabled();
    // Архівний пункт не пропонується.
    expect(
      within(within(panel).getByLabelText('Рівень'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['—', 'Високий']);
    // На аркуші: порожнє обов’язкове — підпис і жовтий пунктир.
    await waitFor(() => expect(sheetField('name').textContent).toBe('Ім’я'));
    expect(sheetField('name')).toHaveClass('is-missing');
    expect(sheetField('verdict')).toHaveClass('is-staff');
    expect(screen.getByText(/Тут текст шаблону/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Жирний (Ctrl+B)' })).toBeDisabled();
  });

  it('значення з панелі — на аркуші й у збереженні; невірне число не надсилається', async () => {
    const { calls } = mockApi(
      base(writer, {
        'GET /api/papers/p1': () => json(200, fromTemplate()),
        'PATCH /api/papers/p1': () => json(200, { ...fromTemplate({ revision: 2 }), updatedAt: '2026-11-14T12:30:00Z' }),
      }),
    );
    renderApp('/editor/p1');
    const panel = await screen.findByRole('complementary', { name: 'Поля документа' });
    await userEvent.type(within(panel).getByLabelText(/^Ім’я/), 'Іван');
    await userEvent.type(within(panel).getByLabelText('Кількість'), '11');
    expect(within(panel).getByText('Ціле число від 1 до 10')).toBeInTheDocument();
    await userEvent.selectOptions(within(panel).getByLabelText('Рівень'), 'high');
    await waitFor(() => expect(sheetField('name').textContent).toBe('Іван'));
    expect(sheetField('name')).toHaveClass('is-filled');
    expect(sheetField('level').textContent).toBe('Високий');
    expect(within(panel).getByText('3 з 4')).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true), { timeout: 4000 });
    const patch = JSON.parse(calls.find((c) => c.method === 'PATCH')!.body);
    // «1» з «11» пройшло, «11» — ні (поза межами): лишилось останнє правильне.
    expect(patch).toEqual({ revision: 1, values: { name: 'Іван', count: 1, level: 'high' } });
  });

  it('сервер відхилив значення — текст помилки, поле підсвічене', async () => {
    mockApi(
      base(writer, {
        'GET /api/papers/p1': () => json(200, fromTemplate()),
        'PATCH /api/papers/p1': () => json(400, { errorCode: 'PAPER_FIELD_INVALID', field: 'name' }),
      }),
    );
    renderApp('/editor/p1');
    const panel = await screen.findByRole('complementary', { name: 'Поля документа' });
    await userEvent.type(within(panel).getByLabelText(/^Ім’я/), 'І');
    expect(await screen.findByText(/Значення поля не підходить/, undefined, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => expect(sheetField('name')).toHaveClass('is-active'));
  });

  it('вільний документ — без панелі й без блокування стрічки', async () => {
    mockApi(base(writer, { 'GET /api/papers/p1': () => json(200, paper()) }));
    renderApp('/editor/p1');
    await screen.findByLabelText('Назва документа');
    expect(screen.queryByRole('complementary', { name: 'Поля документа' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Тут текст шаблону/)).not.toBeInTheDocument();
  });
});
