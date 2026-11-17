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
  about: [],
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
    { key: 'pointsSplit', label: 'Розподіл балів', type: 'text', nullable: true, source: 'computed' },
  ],
};
/** Schemas of every record type: only tasks are made by templates here, the rest — read only. */
const schemas = Object.fromEntries(
  RECORD_TYPES.map((type) => [
    `GET /api/records/${type}/schema`,
    () =>
      json(
        200,
        type === 'task'
          ? TASK
          : { type, label: type === 'session' ? 'Сеанс' : type === 'place' ? 'Обладнання' : type, extensible: false, version: 'v', fields: [{ key: 'id', label: 'Id', type: 'text' }] },
      ),
  ]),
);

const base = (me: Me, extra: Record<string, (r: Request) => Response | Promise<Response>> = {}) => ({
  'GET /api/auth/me': () => json(200, me),
  'GET /api/work-sessions': () => json(200, { items: [], total: 0, page: 1, limit: 1 }),
  'GET /api/papers': () => json(200, { items: [], total: 0, page: 1, limit: 100 }),
  'GET /api/papers/templates': () => json(200, []),
  'GET /api/papers/templates/targets': () => json(200, { creates: ['task'], report: ['task', 'place'] }),
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

  it('«Новий шаблон»: «Створює запис» і «Звіт» — лише типи зі списку API (модуль створює чи читає); шаблон відкривається в конструкторі', async () => {
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
    expect(within(target).queryByRole('option', { name: 'Обладнання' })).not.toBeInTheDocument();
    await userEvent.selectOptions(within(form).getByLabelText('Призначення'), 'report');
    expect(within(target).getByRole('option', { name: 'Обладнання' })).toBeInTheDocument();
    expect(within(target).queryByRole('option', { name: 'Сеанс' })).not.toBeInTheDocument();
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

  it('блок «Авто: номер»: у групі «Авто», на аркуші — {Номер} у рамці з міткою; полів не додає', async () => {
    let rev = 1;
    const { calls } = mockApi(builder(version(), template(), { 'PATCH /api/papers/templates/t1/versions/1': () => saved(++rev) }));
    renderApp('/editor/templates/t1');
    const sheet = await screen.findByLabelText('Аркуш шаблону');
    const palette = within(screen.getByRole('complementary', { name: 'Конструктор' })).getByRole('tabpanel');
    await userEvent.click(within(within(palette).getByRole('region', { name: 'Авто' })).getByRole('button', { name: 'Номер' }));
    await waitFor(() => expect(sheet.querySelector('.paper-field.is-auto')).toHaveTextContent('{Номер}'));
    expect(sheet.querySelector('.paper-block.is-auto')).toHaveAttribute('data-label', 'Авто: номер');
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH').length).toBeGreaterThan(0), { timeout: 4000 });
    const last = JSON.parse(calls.filter((c) => c.method === 'PATCH').at(-1)!.body) as { body: unknown; fields: unknown[] };
    expect(JSON.stringify(last.body)).toContain('"type":"paperNumber"');
    expect(last.fields).toEqual([]);
  });

  it('авто-таблиця з «Авто»: на аркуші — стовпці джерела й мітка; нове обов’язкове поле його типу; «Звідки» й підпис поля', async () => {
    let rev = 1;
    const targets = {
      creates: ['task'],
      report: ['task', 'place'],
      tables: [{ key: 'points_month', label: 'Рейтинг за місяць', input: 'date', columns: ['Місце', 'Учасник', 'Бали'] }],
    };
    const { calls } = mockApi(
      builder(version(), template(), {
        'GET /api/papers/templates/targets': () => json(200, targets),
        'PATCH /api/papers/templates/t1/versions/1': () => saved(++rev),
      }),
    );
    renderApp('/editor/templates/t1');
    const sheet = await screen.findByLabelText('Аркуш шаблону');
    const palette = within(screen.getByRole('complementary', { name: 'Конструктор' })).getByRole('tabpanel');
    await userEvent.click(await within(within(palette).getByRole('region', { name: 'Авто' })).findByRole('button', { name: 'Рейтинг за місяць' }));
    await waitFor(() => expect(sheet.querySelector('.paper-table')).toHaveTextContent('МісцеУчасникБали'));
    expect(sheet.querySelector('.paper-block.is-auto')).toHaveAttribute('data-label', 'Авто: рейтинг за місяць · Дата');
    // Placed — selected, its properties open: where from, the field's label.
    expect(screen.getByRole('tab', { name: 'Властивості' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Звідки')).toHaveDisplayValue('Поле «Дата»');
    const label = screen.getByLabelText('Підпис у формі');
    await userEvent.clear(label);
    await userEvent.type(label, 'Місяць');
    await waitFor(() => expect(sheet.querySelector('.paper-block.is-auto')).toHaveAttribute('data-label', 'Авто: рейтинг за місяць · Місяць'));
    await waitFor(() => expect(JSON.parse(calls.filter((c) => c.method === 'PATCH').at(-1)?.body ?? '{}').fields?.[0]?.label).toBe('Місяць'), { timeout: 4000 });
    const all = calls.filter((c) => c.method === 'PATCH').map((c) => JSON.parse(c.body) as { body?: unknown; fields?: { key: string; type: string; required: boolean }[] });
    expect(JSON.stringify(all.filter((c) => c.body).at(-1)!.body)).toContain('{"type":"autoTable","attrs":{"source":"points_month","field":"date1"}}');
    expect(all.at(-1)!.fields).toMatchObject([{ key: 'date1', type: 'date', required: true }]);
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

  it('«Документ» — спроба: поля заповнюються як у документі, нічого не зберігається; назад — конструктор', async () => {
    const v = version({
      body: {
        type: 'doc',
        content: [
          heading,
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Бали: ' },
              { type: 'field', attrs: { key: 'points' } },
            ],
          },
        ],
      },
      fields: [{ key: 'points', label: 'Бали', type: 'int', required: true, fill: 'author', editable: false, print: true, min: 0, max: 100 }],
    });
    const trial = {
      id: 't1',
      title: 'Технічне завдання',
      version: 1,
      fields: [
        {
          key: 'points',
          label: 'Бали',
          type: 'int',
          required: true,
          fill: 'author',
          editable: false,
          print: true,
          min: 0,
          max: 100,
          maxLength: null,
          maxItems: null,
          scale: null,
          options: null,
          plain: false,
          canFill: true,
        },
      ],
    };
    const { calls } = mockApi(builder(v, template(), { 'GET /api/papers/templates/t1/versions/1/fields': () => json(200, trial) }));
    renderApp('/editor/templates/t1');
    const sheet = await screen.findByLabelText('Аркуш шаблону');
    await waitFor(() => expect(sheet.querySelector('.paper-block')).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Документ' }));
    const tried = await screen.findByLabelText('Спроба документа');
    expect(screen.getByText(/Нічого не зберігається/)).toBeInTheDocument();
    expect(tried.querySelector('.paper-block')).toBeNull();
    await waitFor(() => expect(tried.querySelector('.paper-field')).toHaveClass('is-missing'));
    const panel = screen.getByRole('complementary', { name: 'Поля документа' });
    await userEvent.type(within(panel).getByLabelText(/Бали/), '40');
    await waitFor(() => expect(tried.querySelector('.paper-field')).toHaveTextContent('40'));
    expect(calls.some((c) => c.path.startsWith('/api/papers') && c.method !== 'GET' && !c.path.endsWith('/versions'))).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Конструктор шаблону' }));
    expect(screen.queryByLabelText('Спроба документа')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Аркуш шаблону')).toBeVisible();
  });

  it('«Поля запису «ТЗ»»: поле вставляється прив’язаним, з ключем і обов’язковістю запису; удруге не пропонується', async () => {
    let rev = 1;
    const { calls } = mockApi(builder(version(), template(), { 'PATCH /api/papers/templates/t1/versions/1': () => saved(++rev) }));
    renderApp('/editor/templates/t1');
    const sheet = await screen.findByLabelText('Аркуш шаблону');
    const group = await screen.findByRole('region', { name: 'Поля запису «ТЗ»' });
    await userEvent.click(within(group).getByRole('button', { name: 'Назва' }));
    await waitFor(() => expect(sheet.querySelector('.paper-field')).toHaveTextContent('{Назва}'));
    expect(screen.getByLabelText('Ключ')).toHaveValue('title');
    expect(screen.getByLabelText('Зв’язок із записом')).toHaveValue('title');
    expect(screen.getByRole('switch', { name: 'Обов’язкове' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('tab', { name: 'Блоки' }));
    expect(within(screen.getByRole('region', { name: 'Поля запису «ТЗ»' })).getByRole('button', { name: 'Назва' })).toBeDisabled();
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && JSON.parse(c.body).fields)).toBe(true), { timeout: 4000 });
    const fields = JSON.parse(calls.filter((c) => c.method === 'PATCH' && JSON.parse(c.body).fields).at(-1)!.body).fields;
    expect(fields).toEqual([expect.objectContaining({ key: 'title', label: 'Назва', type: 'text', binding: 'title', required: true })]);
  });

  it('авто-поле з «Поля запису «ТЗ»»: зелене, ніхто не заповнює — без «Обов’язкове» й «Можна змінити»', async () => {
    let rev = 1;
    const { calls } = mockApi(builder(version(), template(), { 'PATCH /api/papers/templates/t1/versions/1': () => saved(++rev) }));
    renderApp('/editor/templates/t1');
    const sheet = await screen.findByLabelText('Аркуш шаблону');
    const group = await screen.findByRole('region', { name: 'Поля запису «ТЗ»' });
    await userEvent.click(within(group).getByRole('button', { name: 'Розподіл балів' }));
    await waitFor(() => expect(sheet.querySelector('.paper-field')).toHaveClass('is-auto'));
    expect(screen.getByText('Заповниться із запису «Розподіл балів» після публікації; ніхто не заповнює.')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Обов’язкове' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Можна змінити після публікації' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Хто заповнює')).not.toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && JSON.parse(c.body).fields)).toBe(true), { timeout: 4000 });
    const fields = JSON.parse(calls.filter((c) => c.method === 'PATCH' && JSON.parse(c.body).fields).at(-1)!.body).fields;
    expect(fields).toEqual([expect.objectContaining({ key: 'pointsSplit', type: 'text', binding: 'pointsSplit', required: false, editable: false })]);
  });

  it('«Опублікувати v1»: з підтвердженням; після — опублікована версія лише для читання, «Змінити» робить чернетку', async () => {
    let published = false;
    const { calls } = mockApi(
      builder(version(), template(), {
        'GET /api/papers/templates/t1': () => json(200, published ? template({ currentVersion: 1, draftVersion: null }) : template()),
        'POST /api/papers/templates/t1/versions/1/publish': () => {
          published = true;
          return json(201, template({ currentVersion: 1, draftVersion: null }));
        },
        'GET /api/papers/templates/t1/versions/1': () => json(200, version({ publishedAt: '2026-11-15T13:00:00Z' })),
        'POST /api/papers/templates/t1/versions': () => json(201, published ? version({ number: 2 }) : version()),
      }),
    );
    renderApp('/editor/templates/t1');
    await screen.findByLabelText('Аркуш шаблону');
    await userEvent.click(screen.getByRole('button', { name: 'Опублікувати v1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Опублікувати' }));
    expect(await screen.findByRole('button', { name: 'Змінити' })).toBeInTheDocument();
    expect(calls.filter((c) => c.path.endsWith('/publish'))).toHaveLength(1);
    const sheet = screen.getByLabelText('Аркуш шаблону');
    expect(sheet).toHaveAttribute('contenteditable', 'false');
    expect(screen.getByText(/Це опублікована версія v1/)).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Шаблон']);
    expect(sheet.querySelector('.paper-end')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Змінити' }));
    expect(await screen.findByText('v2 чернетка')).toBeInTheDocument();
    expect(screen.getByLabelText('Аркуш шаблону')).toHaveAttribute('contenteditable', 'true');
  });

  it('публікацію відхилено: поле — виділене з «Властивостями»; бракує поля запису — підказка з його назвою', async () => {
    const v = version({
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'field', attrs: { key: 'number1' } }] }] },
      fields: [{ key: 'number1', label: 'Число', type: 'int', required: false, fill: 'author', editable: false, print: true, dictionary: null }],
    });
    let answer: object = { errorCode: 'TEMPLATE_FIELD_INVALID', field: 'number1' };
    mockApi(builder(v, template(), { 'POST /api/papers/templates/t1/versions/1/publish': () => json(400, answer) }));
    renderApp('/editor/templates/t1');
    await screen.findByLabelText('Аркуш шаблону');
    await userEvent.click(screen.getByRole('button', { name: 'Опублікувати v1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Опублікувати' }));
    expect(await screen.findByText(/Перевірте підсвічене поле/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Властивості' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Ключ')).toHaveValue('number1');

    answer = { errorCode: 'TEMPLATE_FIELD_INVALID', binding: 'title' };
    await userEvent.click(screen.getByRole('button', { name: 'Опублікувати v1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Опублікувати' }));
    expect(await screen.findByText(/Запис не створиться без поля «Назва»/)).toBeInTheDocument();
  });

  it('«Шаблон»: налаштування зберігаються одразу; версії з кількістю документів; відкинути чернетку', async () => {
    const t = template({ currentVersion: 1, draftVersion: 2 });
    t.versions = [
      { number: 2, revision: 1, publishedAt: null, publishedBy: null, updatedAt: '2026-11-15T10:00:00Z', documents: 0 },
      {
        number: 1,
        revision: 3,
        publishedAt: '2026-11-14T10:00:00Z',
        publishedBy: { id: 'm', name: 'Артур Машталер', avatarUrl: null, color: 'blue' },
        updatedAt: '2026-11-14T10:00:00Z',
        documents: 12,
      },
    ];
    const { calls } = mockApi(
      builder(version({ number: 2 }), t, {
        'PATCH /api/papers/templates/t1': async (r) => json(200, { ...t, ...((await r.json()) as object) }),
        'DELETE /api/papers/templates/t1/versions/2': () => json(200, { ok: true }),
        'GET /api/papers/templates/t1/versions/1': () => json(200, version({ publishedAt: '2026-11-14T10:00:00Z' })),
      }),
    );
    renderApp('/editor/templates/t1');
    await screen.findByLabelText('Аркуш шаблону');
    expect(screen.getByText('12 документів на v1 не зміняться')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Шаблон' }));
    const panel = within(screen.getByRole('complementary', { name: 'Конструктор' })).getByRole('tabpanel');
    expect(within(panel).getByText('Створює запис · ТЗ')).toBeInTheDocument();
    const prefix = within(panel).getByLabelText('Префікс номера');
    await userEvent.type(prefix, 'тз{Enter}');
    expect(prefix).toHaveValue('ТЗ');
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.path === '/api/papers/templates/t1')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.method === 'PATCH' && c.path === '/api/papers/templates/t1')!.body)).toEqual({ numberPrefix: 'ТЗ' });
    await userEvent.selectOptions(within(panel).getByLabelText('Хто створює документи'), 'all');
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH' && c.path === '/api/papers/templates/t1').at(-1)!.body).toBe('{"creators":"all"}'));
    expect(within(panel).getByRole('switch', { name: 'Фіксувати, коли запис готовий' })).toBeInTheDocument();
    expect(within(panel).getByText(/опубліковано .* · Артур Машталер · 12 документів/)).toBeInTheDocument();

    await userEvent.click(within(panel).getByRole('button', { name: 'Відкинути чернетку' }));
    await userEvent.click(within(panel).getByRole('button', { name: 'Відкинути' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
  });

  it('без чернетки — поточна версія лише для читання, чернетка не створюється', async () => {
    const { calls } = mockApi(
      builder(version(), template({ currentVersion: 2, draftVersion: null }), {
        'GET /api/papers/templates/t1/versions/2': () => json(200, version({ number: 2, publishedAt: '2026-11-15T13:00:00Z' })),
      }),
    );
    renderApp('/editor/templates/t1');
    const sheet = await screen.findByLabelText('Аркуш шаблону');
    expect(sheet).toHaveAttribute('contenteditable', 'false');
    expect(screen.getByRole('button', { name: 'Змінити' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Опублікувати/ })).not.toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
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
