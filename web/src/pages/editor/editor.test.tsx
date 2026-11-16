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
  refs: [],
  canEdit: true,
  number: null,
  publishedAt: null,
  targetType: null,
  targetId: null,
  cancelReason: null,
  canPublish: false,
  canCancel: false,
  canChange: false,
  canFreeze: false,
  canSign: false,
  snapshot: null,
  snapshots: [],
  tables: {},
  ...over,
});
const item = (p: Paper) => {
  const { content: _c, canEdit: _e, values: _v, template: _t, refs: _r, ...rest } = p;
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
          const items = mine
            ? [item(paper({ author: { id: 'm1', name: 'Олег Петренко', avatarUrl: null } }))]
            : [item(paper()), item(paper({ id: 'p2', title: 'Наказ', status: 'published' }))];
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
    const { calls } = mockApi(
      base(writer, {
        'GET /api/papers/p1': () => json(200, paper()),
        'PATCH /api/papers/p1': () => json(200, { ...item(paper()), revision: 2, updatedAt: '2026-11-14T12:30:00Z' }),
      }),
    );
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
    expect(screen.getByText('Документ опубліковано: текст не змінюється.')).toBeInTheDocument();
  });

  it('«Зафіксувати для підпису» з підтвердженням; після — «Друк» зі знімка', async () => {
    const published = paper({ status: 'published', canEdit: false, canFreeze: true, canCancel: true, publishedAt: '2026-11-15T10:00:00Z' });
    const frozen = {
      ...published,
      status: 'frozen' as const,
      canFreeze: false,
      revision: 2,
      snapshot: { n: 1, sha256: 'a'.repeat(64), createdAt: '2026-11-15T11:00:00Z', signed: null },
    };
    const { calls } = mockApi(base(writer, { 'GET /api/papers/p1': () => json(200, published), 'POST /api/papers/p1/freeze': () => json(200, frozen) }));
    renderApp('/editor/p1');
    await userEvent.click(await screen.findByRole('button', { name: 'Зафіксувати для підпису' }));
    expect(screen.getByText('Зафіксувати документ? Він стане остаточним: друк і PDF — з цього знімка, з QR-кодом перевірки.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Зафіксувати' }));
    expect(await screen.findByText('Документ зафіксовано: друк і PDF — зі знімка, з QR-кодом перевірки.')).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/api/papers/p1/freeze')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Друк' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Попередній перегляд' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Зафіксувати для підпису' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Зафіксовано').length).toBeGreaterThan(0);
  });

  it('без права чи поки запис не готовий — кнопки фіксації немає', async () => {
    mockApi(base(writer, { 'GET /api/papers/p1': () => json(200, paper({ status: 'published', canEdit: false })) }));
    renderApp('/editor/p1');
    await screen.findByLabelText('Текст документа');
    expect(screen.queryByRole('button', { name: 'Зафіксувати для підпису' })).not.toBeInTheDocument();
  });

  it('помилка фіксації показується текстом', async () => {
    mockApi(
      base(writer, {
        'GET /api/papers/p1': () => json(200, paper({ status: 'published', canEdit: false, canFreeze: true })),
        'POST /api/papers/p1/freeze': () => json(409, { statusCode: 409, message: 'Paper record is not ready', errorCode: 'PAPER_TARGET_NOT_READY' }),
      }),
    );
    renderApp('/editor/p1');
    await userEvent.click(await screen.findByRole('button', { name: 'Зафіксувати для підпису' }));
    await userEvent.click(screen.getByRole('button', { name: 'Зафіксувати' }));
    expect(await screen.findByText('Зафіксувати можна, коли запис завершено: наприклад, технічне завдання прийнято.')).toBeInTheDocument();
  });

  it('підписаний скан: форма з файлом, «Підписано» і посилання на скан; далі — «Інший скан»', async () => {
    const snapshot = { n: 1, sha256: 'a'.repeat(64), createdAt: '2026-11-15T11:00:00Z', signed: null };
    const frozen = paper({ status: 'frozen', canEdit: false, canSign: true, publishedAt: '2026-11-15T10:00:00Z', snapshot });
    const signed = {
      ...frozen,
      status: 'signed' as const,
      revision: 2,
      snapshot: { ...snapshot, signed: { version: 1, fileName: 'скан.pdf', mimeType: 'application/pdf', size: 9, uploadedAt: '2026-11-15T12:00:00Z' } },
    };
    const { calls } = mockApi(
      base(writer, {
        'GET /api/papers/p1': () => json(200, frozen),
        'POST /api/papers/p1/signed': () => json(200, signed),
      }),
    );
    renderApp('/editor/p1');
    await userEvent.click(await screen.findByRole('button', { name: 'Завантажити підписаний скан' }));
    const upload = screen.getByRole('button', { name: 'Завантажити' });
    expect(upload).toBeDisabled();
    const input = document.querySelector<HTMLInputElement>('#paper-scan')!;
    expect(input.accept).toBe('.pdf,.png,.jpg,.jpeg,.webp');
    await userEvent.upload(input, new File(['%PDF-1.4'], 'скан.pdf', { type: 'application/pdf' }));
    await userEvent.click(upload);
    const link = await screen.findByRole('link', { name: 'Відкрити скан' });
    expect(link).toHaveAttribute('href', '/api/papers/p1/signed?inline=1');
    expect(calls.find((c) => c.path === '/api/papers/p1/signed')!.headers.get('content-type')).toMatch(/^multipart\/form-data/);
    expect(screen.getAllByText('Підписано').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Завантажити підписаний скан' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Інший скан' })).toBeInTheDocument();
  });

  it('скан-фото завантажується; без права — кнопки скану немає', async () => {
    const snapshot = {
      n: 1,
      sha256: 'a'.repeat(64),
      createdAt: '2026-11-15T11:00:00Z',
      signed: { version: 2, fileName: 'фото.png', mimeType: 'image/png', size: 9, uploadedAt: '2026-11-15T12:00:00Z' },
    };
    mockApi(base(writer, { 'GET /api/papers/p1': () => json(200, paper({ status: 'signed', canEdit: false, snapshot })) }));
    renderApp('/editor/p1');
    expect(await screen.findByRole('link', { name: 'Завантажити скан' })).toHaveAttribute('href', '/api/papers/p1/signed');
    expect(screen.queryByRole('button', { name: 'Інший скан' })).not.toBeInTheDocument();
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
    about: [],
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
    dictionary: null,
    plain: false,
    binding: null,
    canFill: true,
    auto: false,
    columns: null,
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
  const fromTemplate = (over: Partial<Paper> = {}) =>
    paper({ title: 'Заява', content, values: {}, template: { id: 't1', title: 'Заява', version: 2, kind: 'free', target: null, fields: FIELDS }, ...over });
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

  it('запис у полі: пошук у панелі, назва на аркуші, id у збереженні; підказки Tab і @', async () => {
    const ivan = { type: 'user' as const, id: 'u-ivan', title: 'Іван Петренко', archived: false };
    const fields = FIELDS.map((x) => (x.key === 'who' ? { ...x, canFill: true } : x));
    const doc = fromTemplate({ template: { id: 't1', title: 'Заява', version: 2, kind: 'free', target: null, fields } });
    const { calls } = mockApi(
      base(writer, {
        'GET /api/papers/p1': () => json(200, doc),
        'GET /api/links/candidates': () => json(200, [ivan]),
        'PATCH /api/papers/p1': () => json(200, { ...doc, revision: 2 }),
      }),
    );
    renderApp('/editor/p1');
    const panel = await screen.findByRole('complementary', { name: 'Поля документа' });
    expect(screen.getByText('Tab — наступне поле · @ — посилання на запис')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('combobox', { name: 'Відповідальний' }));
    await userEvent.click(await within(panel).findByRole('option', { name: 'Іван Петренко' }));
    await waitFor(() => expect(sheetField('who').textContent).toBe('Іван Петренко'));
    expect(within(panel).getByRole('link', { name: 'Іван Петренко' })).toHaveAttribute('href', '/team/u-ivan');
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true), { timeout: 4000 });
    expect(JSON.parse(calls.find((c) => c.method === 'PATCH')!.body)).toEqual({ revision: 1, values: { who: 'u-ivan' } });
  });

  it('назви записів — з відповіді сервера', async () => {
    const values = { who: 'u-ivan' };
    mockApi(
      base(writer, {
        'GET /api/papers/p1': () => json(200, fromTemplate({ values, refs: [{ type: 'user', id: 'u-ivan', title: 'Іван Петренко', archived: false }] })),
      }),
    );
    renderApp('/editor/p1');
    await waitFor(() => expect(sheetField('who').textContent).toBe('Іван Петренко'));
  });

  describe('телефон (вужче за 900 px)', () => {
    const narrow = () => vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
    const zone = (key: string) => document.querySelector(`.ProseMirror .paper-zone[data-field="${key}"]`)!;

    it('«Форма»: поля на весь екран без панелі; проста зона пишеться у формі — на аркуші й у збереженні', async () => {
      narrow();
      const { calls } = mockApi(
        base(writer, {
          'GET /api/papers/p1': () => json(200, fromTemplate()),
          'PATCH /api/papers/p1': () => json(200, { ...fromTemplate({ revision: 2 }), updatedAt: '2026-11-14T12:30:00Z' }),
        }),
      );
      renderApp('/editor/p1');
      const form = await screen.findByRole('region', { name: 'Форма документа' });
      expect(screen.getByRole('button', { name: 'Форма' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.queryByRole('complementary', { name: 'Поля документа' })).not.toBeInTheDocument();
      // Стрічки немає, у шапці — шаблон і стан.
      expect(screen.queryByRole('tablist', { name: 'Стрічка' })).not.toBeInTheDocument();
      expect(screen.getByText('Заява · чернетка')).toBeInTheDocument();
      expect(within(form).getByText("0 з 2 обов'язкових")).toBeInTheDocument();
      await userEvent.type(within(form).getByLabelText(/^Мета/), 'Зібрати{Enter}стенд');
      await waitFor(() => expect(zone('goal').querySelectorAll('p')).toHaveLength(2));
      expect(zone('goal').textContent).toBe('Зібратистенд');
      expect(within(form).getByLabelText(/^Мета/)).toHaveValue('Зібрати\nстенд');
      expect(within(form).getByText("1 з 2 обов'язкових")).toBeInTheDocument();
      await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true), { timeout: 4000 });
      expect(calls.find((c) => c.method === 'PATCH')!.body).toContain('стенд');
    });

    it('«Сторінка»: мінімальна панель, поза зоною вимкнена; перехід до поля відкриває його у «Формі»', async () => {
      narrow();
      mockApi(base(writer, { 'GET /api/papers/p1': () => json(200, fromTemplate()) }));
      renderApp('/editor/p1');
      await screen.findByRole('region', { name: 'Форма документа' });
      await userEvent.click(screen.getByRole('button', { name: 'Сторінка' }));
      expect(screen.queryByRole('region', { name: 'Форма документа' })).not.toBeInTheDocument();
      const bar = screen.getByRole('toolbar', { name: 'Форматування' });
      expect(within(bar).getByRole('button', { name: 'Жирний' })).toBeDisabled();
      expect(within(bar).getByText(/пишіть у рамках, поля — у «Формі»/)).toBeInTheDocument();
      // Дотик до поля й Tab ведуть однаково (jsdom не знає координат дотику — тут Tab).
      await userEvent.click(document.querySelector('.ProseMirror')!);
      await userEvent.keyboard('{Tab}');
      const form = await screen.findByRole('region', { name: 'Форма документа' });
      await waitFor(() => expect(within(form).getByLabelText(/^Ім’я/)).toHaveFocus());
    });

    it('зона з форматуванням: початок тексту у «Формі», «Писати на сторінці» — на «Сторінку»', async () => {
      narrow();
      const fields = FIELDS.map((x) => (x.key === 'goal' ? { ...x, plain: false } : x));
      const filled = {
        ...content,
        content: [
          ...content.content.slice(0, -1),
          { type: 'fieldZone', attrs: { key: 'goal' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Стенд для пайки' }] }] },
        ],
      };
      mockApi(
        base(writer, {
          'GET /api/papers/p1': () => json(200, fromTemplate({ content: filled, template: { id: 't1', title: 'Заява', version: 2, kind: 'free', target: null, fields } })),
        }),
      );
      renderApp('/editor/p1');
      const form = await screen.findByRole('region', { name: 'Форма документа' });
      expect(await within(form).findByText('Стенд для пайки')).toBeInTheDocument();
      await userEvent.click(within(form).getByRole('button', { name: 'Писати на сторінці' }));
      expect(screen.getByRole('button', { name: 'Сторінка' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.queryByRole('region', { name: 'Форма документа' })).not.toBeInTheDocument();
    });

    it('вільний документ: без перемикача, мінімальна панель працює; дії шапки — у «Ще»', async () => {
      narrow();
      mockApi(base(writer, { 'GET /api/papers/p1': () => json(200, paper()) }));
      renderApp('/editor/p1');
      await screen.findByLabelText('Назва документа');
      expect(screen.queryByRole('button', { name: 'Форма' })).not.toBeInTheDocument();
      expect(within(screen.getByRole('toolbar', { name: 'Форматування' })).getByRole('button', { name: 'Жирний' })).toBeEnabled();
      expect(screen.queryByRole('button', { name: 'Попередній перегляд' })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Ще' }));
      expect(screen.getByRole('button', { name: 'Попередній перегляд' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Видалити чернетку' })).toBeInTheDocument();
    });
  });

  it('вільний документ — без панелі й без блокування стрічки', async () => {
    mockApi(base(writer, { 'GET /api/papers/p1': () => json(200, paper()) }));
    renderApp('/editor/p1');
    await screen.findByLabelText('Назва документа');
    expect(screen.queryByRole('complementary', { name: 'Поля документа' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Тут текст шаблону/)).not.toBeInTheDocument();
  });

  describe('публікація і скасування', () => {
    const numbered = {
      ...content,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '№ ' }, { type: 'paperNumber' }] }, ...content.content],
    };
    const filled = { name: 'Іван' };

    it('«Опублікувати» з підтвердженням; номер на аркуші й у шапці, посилання на створений запис', async () => {
      const draft = fromTemplate({
        content: numbered,
        values: filled,
        canPublish: true,
        template: { id: 't1', title: 'Технічне завдання', version: 2, kind: 'creates', target: 'task', fields: FIELDS },
      });
      const done = {
        ...draft,
        status: 'published' as const,
        number: 'ТЗ-2026-014',
        canEdit: false,
        canPublish: false,
        canCancel: true,
        targetType: 'task' as const,
        targetId: 'task-1',
        revision: 2,
      };
      const { calls } = mockApi(base(writer, { 'GET /api/papers/p1': () => json(200, draft), 'POST /api/papers/p1/publish': () => json(200, done) }));
      renderApp('/editor/p1');
      await waitFor(() => expect(document.querySelector('.ProseMirror .paper-field.is-auto')).toHaveTextContent('з’явиться після публікації'));
      await userEvent.click(screen.getByRole('button', { name: 'Опублікувати' }));
      expect(screen.getByText('Опублікувати документ? Буде створено запис «Технічне завдання». Після публікації текст не змінюється.')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Опублікувати' }));
      expect(await screen.findByText('№ ТЗ-2026-014')).toBeInTheDocument();
      expect(calls.filter((c) => c.method === 'POST' && c.path === '/api/papers/p1/publish')).toHaveLength(1);
      expect(screen.getByLabelText('Текст документа')).toHaveAttribute('contenteditable', 'false');
      await waitFor(() => expect(document.querySelector('.ProseMirror .paper-field.is-fixed')).toHaveTextContent('ТЗ-2026-014'));
      expect(screen.getByRole('link', { name: 'Відкрити' })).toHaveAttribute('href', '/tasks/task-1');
      expect(screen.queryByRole('button', { name: 'Опублікувати' })).not.toBeInTheDocument();
    });

    it('незаповнене обов’язкове поле: текст помилки і поле підсвічено', async () => {
      mockApi(
        base(writer, {
          'GET /api/papers/p1': () => json(200, fromTemplate({ canPublish: true })),
          'POST /api/papers/p1/publish': () => json(400, { errorCode: 'PAPER_REQUIRED_MISSING', field: 'name' }),
        }),
      );
      renderApp('/editor/p1');
      await userEvent.click(await screen.findByRole('button', { name: 'Опублікувати' }));
      await userEvent.click(screen.getByRole('button', { name: 'Опублікувати' }));
      expect(await screen.findByText('Заповніть обов’язкове поле — його підсвічено.')).toBeInTheDocument();
      await waitFor(() => expect(sheetField('name')).toHaveClass('is-active'));
    });

    it('«Скасувати документ» — з причиною; скасований показує причину', async () => {
      const published = fromTemplate({ status: 'published', canEdit: false, canCancel: true, targetType: 'task', targetId: 'task-1' });
      const cancelled = { ...published, status: 'cancelled' as const, canCancel: false, cancelReason: 'Замовник відмовився' };
      const { calls } = mockApi(base(writer, { 'GET /api/papers/p1': () => json(200, published), 'POST /api/papers/p1/cancel': () => json(200, cancelled) }));
      renderApp('/editor/p1');
      await userEvent.click(await screen.findByRole('button', { name: 'Скасувати документ' }));
      expect(screen.getByText('Разом із документом буде знято запис «Технічне завдання».')).toBeInTheDocument();
      const submit = screen.getByRole('button', { name: 'Скасувати документ' });
      expect(submit).toBeDisabled();
      await userEvent.type(screen.getByLabelText('Причина скасування'), 'Замовник відмовився');
      await userEvent.click(submit);
      expect(await screen.findByText('Документ скасовано: Замовник відмовився.')).toBeInTheDocument();
      expect(JSON.parse(calls.find((c) => c.path === '/api/papers/p1/cancel')!.body)).toEqual({ reason: 'Замовник відмовився' });
      expect(screen.queryByRole('button', { name: 'Скасувати документ' })).not.toBeInTheDocument();
    });
  });

  describe('авто-поля й зміна опублікованого', () => {
    const AUTO: PaperField[] = [
      ...FIELDS,
      f({ key: 'team', label: 'Виконавці', type: 'list<ref:user>', binding: 'assignees', auto: true, canFill: false }),
      f({ key: 'split', label: 'Розподіл балів', binding: 'pointsSplit', auto: true, canFill: false }),
    ];
    const withAuto = {
      ...content,
      content: [...content.content, ...['team', 'split'].map((key) => ({ type: 'paragraph', content: [{ type: 'field', attrs: { key } }] }))],
    };
    const task = (over: Partial<Paper> = {}) =>
      fromTemplate({ content: withAuto, template: { id: 't1', title: 'Технічне завдання', version: 1, kind: 'creates', target: 'task', fields: AUTO }, ...over });

    it('чернетка: авто-поля сірі «заповниться після публікації», у панелі — «Підставить система»', async () => {
      mockApi(base(writer, { 'GET /api/papers/p1': () => json(200, task()) }));
      renderApp('/editor/p1');
      const panel = await screen.findByRole('complementary', { name: 'Поля документа' });
      expect(within(panel).getByText('Підставить система')).toBeInTheDocument();
      expect(within(panel).getAllByText('після публікації')).toHaveLength(2);
      // Авто-поля не рахуються в прогресі: їх ніхто не заповнює.
      expect(within(panel).getByText('0 з 4')).toBeInTheDocument();
      await waitFor(() => expect(sheetField('team')).toHaveClass('is-auto'));
      expect(sheetField('team')).toHaveTextContent('заповниться після публікації');
    });

    it('опубліковане: авто-поля показують запис; «Змінити» → «Зберегти зміни» одним запитом', async () => {
      const values = { name: 'Логотип', team: ['u-ivan'], split: 'Іван ПЕТРЕНКО — 6' };
      const fields = AUTO.map((x) => ({ ...x, canFill: x.key === 'name' || x.key === 'count' }));
      const published = task({
        status: 'published',
        canEdit: false,
        canChange: true,
        revision: 3,
        values,
        refs: [{ type: 'user', id: 'u-ivan', title: 'Іван Петренко', archived: false }],
        targetType: 'task',
        targetId: 'task-1',
        template: { id: 't1', title: 'Технічне завдання', version: 1, kind: 'creates', target: 'task', fields },
      });
      const { calls } = mockApi(
        base(writer, {
          'GET /api/papers/p1': () => json(200, published),
          'PATCH /api/papers/p1': () => json(200, { ...item(published), revision: 4 }),
        }),
      );
      renderApp('/editor/p1');
      await waitFor(() => expect(sheetField('split')).toHaveClass('is-fixed'));
      expect(sheetField('split')).toHaveTextContent('Іван ПЕТРЕНКО — 6');
      const panel = screen.getByRole('complementary', { name: 'Поля документа' });
      expect(within(panel).getByText('Іван ПЕТРЕНКО — 6')).toBeInTheDocument();
      expect(screen.getByLabelText('Текст документа')).toHaveAttribute('contenteditable', 'false');
      expect(screen.getByText('Документ опубліковано. Деякі поля можна змінити: «Змінити».')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Змінити' }));
      const changing = await screen.findByRole('complementary', { name: 'Поля документа' });
      expect(within(changing).getByText('Можна змінити')).toBeInTheDocument();
      expect(within(changing).getByText('Не змінюється')).toBeInTheDocument();
      expect(screen.getByText(/змінять і сам запис/)).toBeInTheDocument();
      const save = screen.getByRole('button', { name: 'Зберегти зміни' });
      expect(save).toBeDisabled();
      const count = within(changing).getByLabelText('Кількість');
      await userEvent.type(count, '3');
      await userEvent.click(save);
      await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1));
      const body = JSON.parse(calls.find((c) => c.method === 'PATCH')!.body);
      expect(body).toEqual({ revision: 3, values: { ...values, count: 3 } });
      // Збережено: знову перегляд (документ з сервера).
      expect(await screen.findByRole('button', { name: 'Змінити' })).toBeInTheDocument();
    });

    describe('звіт', () => {
      const REPORT: PaperField[] = [
        f({ key: 'place', label: 'Обладнання', type: 'ref:place', required: true }),
        f({ key: 'code', label: 'Код', binding: 'code', auto: true, canFill: false }),
        f({ key: 'note', label: 'Примітка' }),
      ];
      const reportContent = {
        type: 'doc',
        content: ['place', 'code', 'note'].map((key) => ({ type: 'paragraph', content: [{ type: 'field', attrs: { key } }] })),
      };
      const report = (over: Partial<Paper> = {}) =>
        paper({ title: 'Паспорт', content: reportContent, template: { id: 't2', title: 'Паспорт', version: 1, kind: 'report', target: 'place', fields: REPORT }, ...over });
      const lathe = { type: 'place' as const, id: 'pl1', title: 'Фрезер', archived: false, code: 'CNC-1' };

      it('запис не вибрано — «коли виберете запис»; вибрали — після збереження поля запису підставляються', async () => {
        const chosen = report({ revision: 2, values: { place: 'pl1', code: 'CNC-1' }, refs: [lathe] });
        let gets = 0;
        const { calls } = mockApi(
          base(writer, {
            'GET /api/papers/p1': () => json(200, gets++ === 0 ? report() : chosen),
            'GET /api/links/candidates': () => json(200, [lathe]),
            'PATCH /api/papers/p1': () => json(200, { ...item(chosen), updatedAt: '2026-11-16T12:30:00Z' }),
          }),
        );
        renderApp('/editor/p1');
        const panel = await screen.findByRole('complementary', { name: 'Поля документа' });
        expect(within(panel).getByText('коли виберете запис')).toBeInTheDocument();
        await waitFor(() => expect(sheetField('code')).toHaveTextContent('з’явиться, коли виберете запис'));
        await userEvent.click(within(panel).getByRole('combobox', { name: /^Обладнання/ }));
        await userEvent.click(await within(panel).findByRole('option', { name: /Фрезер/ }));
        await waitFor(() => expect(sheetField('code')).toHaveTextContent('CNC-1'), { timeout: 4000 });
        expect(JSON.parse(calls.find((c) => c.method === 'PATCH')!.body)).toEqual({ revision: 1, values: { place: 'pl1' } });
      });

      it('авто-таблиця: поле порожнє — підказка; вибрали — після збереження рядки з сервера', async () => {
        const content = { ...reportContent, content: [...reportContent.content, { type: 'autoTable', attrs: { source: 'place_sessions', field: 'place' } }] };
        const empty = { 'place_sessions:place': { columns: ['Учасник', 'Початок'], caption: null, rows: null, more: 0 } };
        const filled = { 'place_sessions:place': { columns: ['Учасник', 'Початок'], caption: null, rows: [['Олена', '01.10.2026']], more: 0 } };
        const chosen = report({ content, revision: 2, values: { place: 'pl1', code: 'CNC-1' }, refs: [lathe], tables: filled });
        let gets = 0;
        mockApi(
          base(writer, {
            'GET /api/papers/p1': () => json(200, gets++ === 0 ? report({ content, tables: empty }) : chosen),
            'GET /api/links/candidates': () => json(200, [lathe]),
            'PATCH /api/papers/p1': () => json(200, { ...item(chosen), updatedAt: '2026-11-16T12:30:00Z' }),
          }),
        );
        renderApp('/editor/p1');
        const panel = await screen.findByRole('complementary', { name: 'Поля документа' });
        const sheet = screen.getByLabelText('Текст документа');
        await waitFor(() => expect(sheet.querySelector('.paper-table')).toHaveTextContent('УчасникПочатокз’явиться, коли виберете «Обладнання»'));
        await userEvent.click(within(panel).getByRole('combobox', { name: /^Обладнання/ }));
        await userEvent.click(await within(panel).findByRole('option', { name: /Фрезер/ }));
        await waitFor(() => expect(sheet.querySelector('.paper-table')).toHaveTextContent('УчасникПочатокОлена01.10.2026'), { timeout: 4000 });
      });

      it('чернетка не надсилає того, що показує запис', async () => {
        const doc = report({ values: { place: 'pl1', code: 'CNC-1' }, refs: [lathe] });
        const { calls } = mockApi(
          base(writer, {
            'GET /api/papers/p1': () => json(200, doc),
            'PATCH /api/papers/p1': () => json(200, { ...item(doc), revision: 2 }),
          }),
        );
        renderApp('/editor/p1');
        const panel = await screen.findByRole('complementary', { name: 'Поля документа' });
        await waitFor(() => expect(sheetField('code')).toHaveTextContent('CNC-1'));
        await userEvent.type(within(panel).getByLabelText('Примітка'), 'Так');
        await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true), { timeout: 4000 });
        expect(JSON.parse(calls.find((c) => c.method === 'PATCH')!.body)).toEqual({ revision: 1, values: { place: 'pl1', note: 'Так' } });
      });

      it('зафіксований звіт: «Зафіксувати нову версію» з підтвердженням; «Версії» ведуть на друк знімків', async () => {
        const snapshot = { n: 1, sha256: 'a'.repeat(64), createdAt: '2026-11-15T11:00:00Z', signed: null };
        const frozen = report({ status: 'frozen', canEdit: false, canFreeze: true, values: { place: 'pl1', code: 'CNC-1' }, refs: [lathe], snapshot, snapshots: [snapshot] });
        const again = { ...frozen, revision: 2, snapshot: { ...snapshot, n: 2 }, snapshots: [snapshot, { n: 2, createdAt: '2026-11-16T11:00:00Z' }] };
        const { calls } = mockApi(base(writer, { 'GET /api/papers/p1': () => json(200, frozen), 'POST /api/papers/p1/freeze': () => json(200, again) }));
        renderApp('/editor/p1');
        expect(await screen.findByText(/«Зафіксувати нову версію» візьме дані запису/)).toBeInTheDocument();
        expect(screen.queryByText(/^Версії:/)).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Зафіксувати нову версію' }));
        expect(screen.getByText('Зафіксувати нову версію? Вона візьме дані запису, які є зараз; попередні версії лишаються.')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Зафіксувати' }));
        expect(await screen.findByRole('link', { name: '2' })).toHaveAttribute('href', '/api/papers/p1/print?snapshot=2');
        expect(screen.getByRole('link', { name: '1' })).toHaveAttribute('href', '/api/papers/p1/print?snapshot=1');
        expect(calls.filter((c) => c.method === 'POST' && c.path === '/api/papers/p1/freeze')).toHaveLength(1);
      });
    });

    it('«Скасувати» — без запиту; помилка запису підсвічує поле', async () => {
      const published = task({ status: 'published', canEdit: false, canChange: true, values: { name: 'Логотип' } });
      const { calls } = mockApi(
        base(writer, {
          'GET /api/papers/p1': () => json(200, published),
          'PATCH /api/papers/p1': () => json(409, { errorCode: 'MAX_ASSIGNEES_TOO_LOW', field: 'count' }),
        }),
      );
      renderApp('/editor/p1');
      await userEvent.click(await screen.findByRole('button', { name: 'Змінити' }));
      await userEvent.click(screen.getByRole('button', { name: 'Скасувати' }));
      expect(await screen.findByRole('button', { name: 'Змінити' })).toBeInTheDocument();
      expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);

      await userEvent.click(screen.getByRole('button', { name: 'Змінити' }));
      const panel = await screen.findByRole('complementary', { name: 'Поля документа' });
      await userEvent.type(within(panel).getByLabelText('Кількість'), '1');
      await userEvent.click(screen.getByRole('button', { name: 'Зберегти зміни' }));
      await waitFor(() => expect(sheetField('count')).toHaveClass('is-active'));
    });
  });
});
