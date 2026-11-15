import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Me, RecordSchema, Template, TemplateItem, TemplateVersion } from '../../api/types';
import { RECORD_TYPES } from '../../lib/records';
import { json, member, mockApi, moderator, renderApp } from '../../test/render';

const staff: Me = {
  ...moderator,
  permissions: [...moderator.permissions, 'papers.read', 'papers.read_all', 'papers.create', 'papers.edit', 'paper_templates.read', 'paper_templates.manage', 'dictionaries.read'],
};
const writer: Me = { ...member, permissions: [...member.permissions, 'papers.read', 'papers.create', 'paper_templates.read'] };

const item = (over: Partial<TemplateItem> = {}): TemplateItem => ({
  id: 't1',
  title: 'Технічне завдання',
  kind: 'creates',
  target: 'task',
  numberPrefix: null,
  autoFreeze: false,
  creators: 'staff',
  visibility: 'author',
  archived: false,
  currentVersion: null,
  draftVersion: 1,
  needsUpdate: false,
  createdAt: '2026-11-15T10:00:00Z',
  updatedAt: '2026-11-15T10:00:00Z',
  ...over,
});
const template = (over: Partial<TemplateItem> = {}): Template => ({ ...item(over), versions: [] });

const heading = { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '1. Назва роботи' }] };
const version = (over: Partial<TemplateVersion> = {}): TemplateVersion => ({
  templateId: 't1',
  number: 1,
  revision: 1,
  publishedAt: null,
  publishedBy: null,
  updatedAt: '2026-11-15T10:00:00Z',
  schemaVersion: null,
  body: { type: 'doc', content: [heading, { type: 'paragraph' }] },
  fields: [],
  ...over,
});
const saved = (revision: number) => json(200, { number: 1, revision, publishedAt: null, publishedBy: null, updatedAt: '2026-11-15T12:30:00Z' });

const TASK: RecordSchema = {
  type: 'task',
  label: 'ТЗ',
  extensible: true,
  version: 'v1',
  fields: [
    { key: 'title', label: 'Назва', type: 'text', required: true, create: true, maxLength: 200 },
    { key: 'points', label: 'Бали', type: 'int', required: true, create: true, min: 0, max: 1000 },
  ],
};
/** Schemas of every record type: only tasks are made by templates here, the rest — read only. */
const schemas = Object.fromEntries(
  RECORD_TYPES.map((type) => [
    `GET /api/records/${type}/schema`,
    () =>
      json(200, type === 'task' ? TASK : { type, label: type === 'session' ? 'Сеанс' : type, extensible: false, version: 'v', fields: [{ key: 'id', label: 'Id', type: 'text' }] }),
  ]),
);

const base = (me: Me, extra: Record<string, (r: Request) => Response | Promise<Response>> = {}) => ({
  'GET /api/auth/me': () => json(200, me),
  'GET /api/work-sessions': () => json(200, { items: [], total: 0, page: 1, limit: 1 }),
  'GET /api/papers': () => json(200, { items: [], total: 0, page: 1, limit: 100 }),
  'GET /api/papers/templates': () => json(200, []),
  ...schemas,
  ...extra,
});

/** The constructor of template t1 with the draft `v`. */
const builder = (v: TemplateVersion, t: Template = template(), extra: Record<string, (r: Request) => Response | Promise<Response>> = {}) =>
  base(staff, {
    'GET /api/papers/templates/t1': () => json(200, t),
    'POST /api/papers/templates/t1/versions': () => json(201, v),
    'GET /api/dictionaries': () => json(200, []),
    ...extra,
  });

describe('Редактор: вкладка «Шаблони»', () => {
  it('модератор бачить шаблони з версіями; учасник — вкладки немає', async () => {
    mockApi(
      base(staff, {
        'GET /api/papers/templates': () => json(200, [item(), item({ id: 't2', title: 'Протокол', kind: 'free', target: null, currentVersion: 2, draftVersion: null })]),
      }),
    );
    renderApp('/editor?tab=templates');
    const list = await screen.findByRole('list', { name: 'Шаблони документів' });
    const rows = within(list).getAllByRole('link');
    expect(rows[0]).toHaveAttribute('href', '/editor/templates/t1');
    expect(rows[0]).toHaveTextContent('Не опубліковано');
    expect(rows[0]).toHaveTextContent('v1 чернетка');
    await waitFor(() => expect(rows[0]).toHaveTextContent('Створює запис · ТЗ'));
    expect(rows[1]).toHaveTextContent('v2 опубліковано');
    expect(rows[1]).toHaveTextContent('Вільний документ');
  });

  it('учасник вкладки «Шаблони» не має', async () => {
    mockApi(base(writer));
    renderApp('/editor?tab=templates');
    expect(await screen.findByText('У вас ще немає документів.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Шаблони' })).not.toBeInTheDocument();
  });

  it('«Новий шаблон»: «Створює запис» — лише типи, записи яких можна створити; шаблон відкривається в конструкторі', async () => {
    const { calls } = mockApi(
      builder(version(), template(), {
        'POST /api/papers/templates': () => json(201, template()),
      }),
    );
    const { router } = renderApp('/editor?tab=templates');
    await userEvent.click(await screen.findByRole('button', { name: 'Новий шаблон' }));
    const form = screen.getByRole('form', { name: 'Новий шаблон' });
    const create = within(form).getByRole('button', { name: 'Створити й відкрити' });
    await userEvent.type(within(form).getByLabelText('Назва'), 'Технічне завдання');
    expect(create).toBeEnabled();
    await userEvent.selectOptions(within(form).getByLabelText('Призначення'), 'creates');
    expect(create).toBeDisabled();
    const target = within(form).getByLabelText('Запис');
    await waitFor(() => expect(within(target).getByRole('option', { name: 'ТЗ' })).toBeInTheDocument());
    expect(within(target).queryByRole('option', { name: 'Сеанс' })).not.toBeInTheDocument();
    await userEvent.selectOptions(within(form).getByLabelText('Призначення'), 'report');
    expect(within(target).getByRole('option', { name: 'Сеанс' })).toBeInTheDocument();
    await userEvent.selectOptions(within(form).getByLabelText('Призначення'), 'creates');
    await userEvent.selectOptions(target, 'task');
    await userEvent.click(create);
    await waitFor(() => expect(router.state.location.pathname).toBe('/editor/templates/t1'));
    expect(JSON.parse(calls.find((c) => c.method === 'POST' && c.path === '/api/papers/templates')!.body)).toEqual({ title: 'Технічне завдання', kind: 'creates', target: 'task' });
    expect(await screen.findByLabelText('Аркуш шаблону')).toBeInTheDocument();
  });
});

describe('Конструктор шаблону', () => {
  it('відкриває чернетку: блоки в рамках з мітками, палітра за групами, мітка версії', async () => {
    mockApi(builder(version(), template({ currentVersion: 3, draftVersion: 4 }), { 'POST /api/papers/templates/t1/versions': () => json(201, version({ number: 4 })) }));
    renderApp('/editor/templates/t1');
    const sheet = await screen.findByLabelText('Аркуш шаблону');
    await waitFor(() => expect(sheet.querySelector('.paper-block')).toHaveAttribute('data-label', 'Заголовок'));
    expect(screen.getByText('v3 опубліковано')).toBeInTheDocument();
    expect(screen.getByText('v4 чернетка')).toBeInTheDocument();
    const palette = within(screen.getByRole('complementary', { name: 'Конструктор' })).getByRole('tabpanel');
    expect(within(palette).getByRole('region', { name: 'Поля' })).toBeInTheDocument();
    expect(within(palette).getByRole('button', { name: 'Число' })).toHaveAttribute('draggable', 'true');
  });

  it('блок «Число» з палітри: поле на аркуші, «Властивості»; ключ і підпис зберігаються з тілом і revision', async () => {
    let rev = 1;
    const { calls } = mockApi(builder(version(), template(), { 'PATCH /api/papers/templates/t1/versions/1': () => saved(++rev) }));
    renderApp('/editor/templates/t1');
    const sheet = await screen.findByLabelText('Аркуш шаблону');
    await userEvent.click(await screen.findByRole('button', { name: 'Число' }));
    await waitFor(() => expect(sheet.querySelector('.paper-field')).toHaveTextContent('{Число}'));
    expect(screen.getByRole('tab', { name: 'Властивості' })).toHaveAttribute('aria-selected', 'true');
    const key = screen.getByLabelText('Ключ');
    expect(key).toHaveValue('number1');
    await userEvent.clear(key);
    await userEvent.type(key, 'Бали');
    expect(key).toHaveAttribute('aria-invalid', 'true');
    await userEvent.clear(key);
    await userEvent.type(key, 'points{Enter}');
    const label = screen.getByLabelText('Підпис у формі');
    await userEvent.clear(label);
    await userEvent.type(label, 'Бали за виконання');
    await userEvent.click(screen.getByRole('switch', { name: 'Обов’язкове' }));
    await waitFor(() => expect(sheet.querySelector('.paper-block.is-active')).toHaveAttribute('data-label', 'Число · points · обов’язкове'));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH').length).toBeGreaterThan(0), { timeout: 4000 });
    await waitFor(() => expect(screen.getByText(/^Збережено о /)).toBeInTheDocument(), { timeout: 4000 });
    const last = JSON.parse(calls.filter((c) => c.method === 'PATCH').at(-1)!.body);
    const all = calls.filter((c) => c.method === 'PATCH').map((c) => JSON.parse(c.body) as { revision: number; body?: unknown });
    expect(all.map((c) => c.revision)).toEqual(all.map((_, i) => i + 1));
    const body = all.filter((c) => c.body).at(-1)!.body;
    expect(JSON.stringify(body)).toContain('"key":"points"');
    expect(last.fields).toEqual([
      {
        key: 'points',
        label: 'Бали за виконання',
        type: 'int',
        required: true,
        fill: 'author',
        editable: false,
        print: true,
        binding: null,
        min: null,
        max: null,
        maxLength: null,
        maxItems: null,
        dictionary: null,
      },
    ]);
  });

  it('зв’язок із записом: поля запису того самого типу; прив’язка бере назву й обов’язковість поля запису', async () => {
    const v = version({
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'field', attrs: { key: 'number1' } }] }] },
      fields: [{ key: 'number1', label: 'Число', type: 'int', required: false, fill: 'author', editable: false, print: true }],
    });
    mockApi(builder(v));
    renderApp('/editor/templates/t1');
    const sheet = await screen.findByLabelText('Аркуш шаблону');
    await waitFor(() => expect(sheet.querySelector('.paper-field')).toBeInTheDocument());
    // The cursor is in the block of the field: «Властивості» show it (jsdom has no layout to click the field itself).
    await userEvent.click(screen.getByRole('tab', { name: 'Властивості' }));
    const binding = await screen.findByLabelText('Зв’язок із записом');
    await waitFor(() => expect(within(binding).getByRole('option', { name: 'ТЗ → Бали' })).toBeInTheDocument());
    expect(within(binding).queryByRole('option', { name: 'ТЗ → Назва' })).not.toBeInTheDocument();
    await userEvent.selectOptions(binding, 'points');
    expect(screen.getByLabelText('Підпис у формі')).toHaveValue('Бали');
    expect(screen.getByRole('switch', { name: 'Обов’язкове' })).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(sheet.querySelector('.paper-block')).toHaveAttribute('data-label', 'Число · number1 → Бали · обов’язкове'));
    // Another kind of the field — no binding (a binding is to a field of the same type).
    await userEvent.click(screen.getByRole('button', { name: 'Дробове' }));
    expect(screen.getByLabelText('Зв’язок із записом')).toHaveValue('');
  });

  it('«Документ» показує аркуш без рамок і панелі; назад — «Конструктор шаблону»', async () => {
    mockApi(builder(version()));
    renderApp('/editor/templates/t1');
    const sheet = await screen.findByLabelText('Аркуш шаблону');
    await waitFor(() => expect(sheet.querySelector('.paper-block')).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Документ' }));
    await waitFor(() => expect(sheet.querySelector('.paper-block')).toBeNull());
    expect(sheet).toHaveAttribute('contenteditable', 'false');
    expect(screen.queryByRole('complementary', { name: 'Конструктор' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Конструктор шаблону' }));
    await waitFor(() => expect(sheet.querySelector('.paper-block')).not.toBeNull());
    expect(sheet).toHaveAttribute('contenteditable', 'true');
  });

  it('конфлікт: банер «Відкрити останню версію» бере чернетку з сервера знову', async () => {
    let drafts = 0;
    mockApi(
      builder(version(), template(), {
        'POST /api/papers/templates/t1/versions': () => json(201, version({ revision: ++drafts })),
        'PATCH /api/papers/templates/t1/versions/1': () => json(409, { errorCode: 'PAPER_CONFLICT' }),
      }),
    );
    renderApp('/editor/templates/t1');
    await screen.findByLabelText('Аркуш шаблону');
    await userEvent.click(await screen.findByRole('button', { name: 'Абзац' }));
    const banner = await screen.findByRole('alert', undefined, { timeout: 4000 });
    expect(banner).toHaveTextContent('Шаблон змінили в іншому вікні');
    await userEvent.click(within(banner).getByRole('button', { name: 'Відкрити останню версію' }));
    await waitFor(() => expect(drafts).toBe(2));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('на вузькому екрані — підказка, чернетка не створюється', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
    const { calls } = mockApi(builder(version()));
    renderApp('/editor/templates/t1');
    expect(await screen.findByText(/Конструктор шаблону відкривається на екрані від 900 px/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('учасник — «Немає доступу»', async () => {
    mockApi(base(writer));
    renderApp('/editor/templates/t1');
    expect(await screen.findByText('Немає доступу')).toBeInTheDocument();
  });
});
