import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Me, Paper } from '../api/types';
import { json, member, mockApi, renderApp } from '../test/render';
import { countWords } from './usePageStats';

const writer: Me = { ...member, permissions: [...member.permissions, 'papers.read', 'papers.create', 'papers.edit'] };

type Json = { type: string; attrs?: Record<string, unknown>; content?: Json[]; text?: string; marks?: { type: string; attrs?: Record<string, unknown> }[] };
const doc = (...content: Json[]): Json => ({ type: 'doc', content });
const para = (t: string, marks?: Json['marks']): Json => ({ type: 'paragraph', content: [{ type: 'text', text: t, ...(marks ? { marks } : {}) }] });

const paper = (over: Partial<Paper> = {}): Paper => ({
  id: 'p1',
  title: 'Протокол зборів',
  status: 'draft',
  visibility: 'author',
  author: { id: writer.id, name: writer.name, avatarUrl: null },
  revision: 1,
  createdAt: '2026-11-14T10:00:00Z',
  updatedAt: '2026-11-14T10:00:00Z',
  content: doc(para('Порядок денний')),
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
  ...over,
});

/** Opens a document; returns the content of each PATCH sent. */
function open(p: Paper = paper()) {
  const { calls } = mockApi({
    'GET /api/auth/me': () => json(200, writer),
    'GET /api/papers/p1': () => json(200, p),
    'PATCH /api/papers/p1': () => json(200, { ...p, content: undefined, canEdit: undefined, revision: p.revision + 1 }),
  });
  renderApp('/editor/p1');
  const saved = () =>
    calls
      .filter((c) => c.method === 'PATCH')
      .map((c) => (JSON.parse(c.body) as { content?: Json }).content)
      .filter(Boolean) as Json[];
  return { saved };
}

/** The last saved content (autosave waits 1.5 s). */
async function lastSaved(saved: () => Json[]): Promise<Json> {
  await waitFor(() => expect(saved().length).toBeGreaterThan(0), { timeout: 4000 });
  return saved().at(-1)!;
}

const selectAll = async () => {
  await userEvent.click(await screen.findByLabelText('Текст документа'));
  await userEvent.keyboard('{Control>}a{/Control}');
};

afterEach(() => localStorage.clear());

describe('Редактор: вікно документа', () => {
  it('на весь екран: без бічного меню, з шляхом і кнопкою «Назад»', async () => {
    open();
    expect(await screen.findByLabelText('Текст документа')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Основна навігація' })).not.toBeInTheDocument();
    const path = screen.getByRole('navigation', { name: 'Шлях' });
    expect(path).toHaveTextContent('Редактор / Мої');
    expect(screen.getByRole('link', { name: 'Назад' })).toHaveAttribute('href', '/editor');
  });

  it('без права редагувати — без стрічки й лінійки; рядок стану є', async () => {
    open(paper({ status: 'published' }));
    expect(await screen.findByLabelText('Текст документа')).toHaveAttribute('contenteditable', 'false');
    expect(screen.queryByRole('tablist', { name: 'Стрічка' })).not.toBeInTheDocument();
    expect(screen.getByText('2 слова')).toBeInTheDocument();
  });
});

describe('Редактор: панель телефона', () => {
  it('вужче за 900 px — один рядок замість стрічки: Ж і список діють, «Скасувати» повертає', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
    const { saved } = open();
    const bar = await screen.findByRole('toolbar', { name: 'Форматування' });
    expect(screen.queryByRole('tablist', { name: 'Стрічка' })).not.toBeInTheDocument();
    await selectAll();
    await userEvent.click(within(bar).getByRole('button', { name: 'Жирний' }));
    await userEvent.click(within(bar).getByRole('button', { name: 'Маркований список' }));
    expect(within(bar).getByRole('button', { name: 'Жирний' })).toHaveAttribute('aria-pressed', 'true');
    expect((await lastSaved(saved)).content![0]!.type).toBe('bulletList');
    await userEvent.click(within(bar).getByRole('button', { name: 'Скасувати' }));
    expect(within(bar).getByRole('button', { name: 'Маркований список' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('Редактор: стрічка «Головна»', () => {
  it('Ж робить виділене жирним, кнопка показує стан; у вмісті немає атрибутів style', async () => {
    const { saved } = open();
    const bold = await screen.findByRole('button', { name: 'Жирний (Ctrl+B)' });
    expect(bold).toHaveAttribute('aria-pressed', 'false');
    await selectAll();
    await userEvent.click(bold);
    expect(bold).toHaveAttribute('aria-pressed', 'true');
    expect(await lastSaved(saved)).toEqual(
      doc({ type: 'paragraph', attrs: { align: null, indent: 0 }, content: [{ type: 'text', text: 'Порядок денний', marks: [{ type: 'bold' }] }] }),
    );
    expect(screen.getByLabelText('Текст документа').querySelectorAll('[style]')).toHaveLength(0);
  });

  it('показує формат там, де курсор: курсив, розмір, шрифт, колір', async () => {
    open(paper({ content: doc(para('Мета', [{ type: 'italic' }, { type: 'textStyle', attrs: { size: 18, color: 'blue', font: 'sans' } }])) }));
    expect(await screen.findByRole('button', { name: 'Курсив (Ctrl+I)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Розмір шрифту, пт')).toHaveValue('18');
    expect(screen.getByLabelText('Шрифт')).toHaveValue('sans');
    expect(screen.getByRole('button', { name: 'Колір тексту: Синій' })).toBeInTheDocument();
  });

  it('стиль, розмір, колір і вирівнювання — класами зі спільного опису', async () => {
    const { saved } = open();
    await selectAll();
    await userEvent.selectOptions(screen.getByLabelText('Стиль абзацу'), 'Заголовок 2');
    await userEvent.selectOptions(screen.getByLabelText('Розмір шрифту, пт'), '20');
    await userEvent.click(screen.getByRole('button', { name: /^Колір тексту/ }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Колір тексту' })).getByRole('button', { name: 'Червоний' }));
    await userEvent.click(screen.getByRole('button', { name: 'По центру' }));
    expect(screen.queryByRole('group', { name: 'Колір тексту' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'По центру' })).toHaveAttribute('aria-pressed', 'true');
    // After a heading at the end the editor keeps an empty paragraph (to type on below it).
    expect((await lastSaved(saved)).content![0]).toEqual({
      type: 'heading',
      attrs: { level: 2, align: 'center', indent: 0 },
      content: [{ type: 'text', text: 'Порядок денний', marks: [{ type: 'textStyle', attrs: { size: 20, color: 'red', font: null } }] }],
    });
    const heading = screen.getByLabelText('Текст документа').querySelector('h2')!;
    expect(heading).toHaveClass('ta-center');
    expect(heading.querySelector('span')).toHaveClass('fs-20', 'tc-red');
  });

  it('розмір, що збігається з розміром абзацу, не пишеться в документ', async () => {
    const { saved } = open(paper({ content: doc(para('Текст', [{ type: 'textStyle', attrs: { size: 18, color: null, font: null } }])) }));
    await selectAll();
    await userEvent.selectOptions(screen.getByLabelText('Розмір шрифту, пт'), '14');
    expect(await lastSaved(saved)).toEqual(doc({ type: 'paragraph', attrs: { align: null, indent: 0 }, content: [{ type: 'text', text: 'Текст' }] }));
  });

  it('скасувати повертає зміну; відступ і список', async () => {
    const { saved } = open();
    await selectAll();
    const undo = screen.getByRole('button', { name: 'Скасувати (Ctrl+Z)' });
    const redo = screen.getByRole('button', { name: 'Повторити (Ctrl+Y)' });
    expect(undo).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Збільшити відступ' }));
    expect(undo).toBeEnabled();
    await userEvent.click(undo);
    expect(undo).toBeDisabled();
    expect(redo).toBeEnabled();
    const list = screen.getByRole('button', { name: 'Нумерований список' });
    await userEvent.click(list);
    // The selection also covers the empty paragraph the editor keeps after the list: put the cursor into the list.
    await userEvent.keyboard('{ArrowLeft}');
    expect(list).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Збільшити відступ' }));
    const last = await lastSaved(saved);
    expect(last.content![0]!.type).toBe('orderedList');
    expect(last.content![0]!.content![0]!.content![0]!.attrs).toEqual({ align: null, indent: 1 });
  });
});

describe('Редактор: стрічка «Вставка»', () => {
  it('таблиця заданого розміру з сітки; дії з таблицею лише в таблиці', async () => {
    const { saved } = open();
    await userEvent.click(await screen.findByRole('tab', { name: 'Вставка' }));
    expect(screen.queryByRole('group', { name: 'Таблиця' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Таблиця' }));
    const grid = screen.getByRole('group', { name: 'Розмір таблиці' });
    await userEvent.click(within(grid).getByRole('button', { name: '2 × 3' }));
    expect(screen.queryByRole('group', { name: 'Розмір таблиці' })).not.toBeInTheDocument();
    const tableActions = await screen.findByRole('group', { name: 'Таблиця' });
    await userEvent.click(within(tableActions).getByRole('button', { name: 'Рядок нижче' }));
    const table = (await lastSaved(saved)).content!.find((n) => n.type === 'table')!;
    expect(table.content).toHaveLength(3);
    expect(table.content!.every((row) => row.content!.length === 3 && row.content!.every((c) => c.type === 'tableCell'))).toBe(true);
  });

  it('сітка таблиці: стрілки вибирають розмір, Escape закриває', async () => {
    open();
    await userEvent.click(await screen.findByRole('tab', { name: 'Вставка' }));
    await userEvent.click(screen.getByRole('button', { name: 'Таблиця' }));
    const grid = screen.getByRole('group', { name: 'Розмір таблиці' });
    expect(within(grid).getByRole('button', { name: '1 × 1' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowRight}');
    expect(within(grid).getByRole('button', { name: '3 × 2' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Розмір таблиці' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Таблиця' })).toHaveFocus();
  });

  it('розрив сторінки додає сторінку в рядку стану', async () => {
    const { saved } = open();
    expect(await screen.findByText('Сторінка 1 з 1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Вставка' }));
    await userEvent.click(screen.getByRole('button', { name: 'Розрив сторінки' }));
    expect(await screen.findByText(/Сторінка \d з 2/)).toBeInTheDocument();
    expect((await lastSaved(saved)).content!.some((n) => n.type === 'pageBreak')).toBe(true);
  });

  it('вкладки стрічки перемикаються стрілками', async () => {
    open();
    const home = await screen.findByRole('tab', { name: 'Головна' });
    expect(home).toHaveAttribute('aria-selected', 'true');
    home.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Вставка' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Вставка' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Редактор: рядок стану', () => {
  it('слова, формат аркуша; масштаб запам’ятовується', async () => {
    open();
    expect(await screen.findByText('2 слова')).toBeInTheDocument();
    expect(screen.getByText('A4 · поля 30/10/20/20 мм')).toBeInTheDocument();
    const slider = screen.getByRole('slider', { name: 'Масштаб' });
    expect(slider).toHaveAttribute('aria-valuetext', '100%');
    await userEvent.click(screen.getByRole('button', { name: 'Збільшити' }));
    expect(slider).toHaveAttribute('aria-valuetext', '110%');
    expect(localStorage.getItem('editor.zoom')).toBe('110');
  });

  it('масштаб береться з пам’яті браузера', async () => {
    localStorage.setItem('editor.zoom', '50');
    open();
    expect(await screen.findByRole('slider', { name: 'Масштаб' })).toHaveAttribute('aria-valuetext', '50%');
    expect(screen.getByRole('button', { name: 'Зменшити' })).toBeDisabled();
  });

  it('countWords: апостроф і дефіс усередині слова', () => {
    expect(countWords('')).toBe(0);
    expect(countWords("Обов'язково будь-який — 10 разів, сім’я")).toBe(5);
  });
});
