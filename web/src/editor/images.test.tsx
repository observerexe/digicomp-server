import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me, Paper } from '../api/types';
import { json, member, mockApi, renderApp } from '../test/render';
import { testEditor } from '../test/editor';
import { IMAGE_BLOCK } from './blocks';
import { blockContent, placeBlock } from './builder';
import { fitSize, outputType, prepareImage } from './images';

const writer: Me = { ...member, permissions: [...member.permissions, 'papers.read', 'papers.create', 'papers.edit', 'paper_images.upload'] };
const A = '0b8f1c2e-3d4a-4b5c-8d6e-7f8091a2b3c4';
const B = '1c9f2d3e-4e5b-4c6d-9e7f-8091a2b3c4d5';

type Json = { type: string; attrs?: Record<string, unknown>; content?: Json[]; text?: string };
const doc = (...content: Json[]): Json => ({ type: 'doc', content });
const para = (t: string): Json => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
const image = (id: string, attrs: Record<string, unknown> = {}): Json => ({ type: 'image', attrs: { id, ...attrs } });

const paper = (content: Json): Paper =>
  ({
    id: 'p1',
    title: 'Звіт',
    status: 'draft',
    visibility: 'author',
    author: { id: writer.id, name: writer.name, avatarUrl: null },
    revision: 1,
    createdAt: '2026-11-17T10:00:00Z',
    updatedAt: '2026-11-17T10:00:00Z',
    content,
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
    canSignDrawn: false,
    snapshot: null,
    snapshots: [],
    tables: {},
  }) as Paper;

/** Opens a document; the upload answers with `ids` in turn (or `fail`). */
function open(content: Json, opts: { ids?: string[]; fail?: string; hold?: Promise<void> } = {}) {
  const ids = [...(opts.ids ?? [A])];
  const { calls } = mockApi({
    'GET /api/auth/me': () => json(200, writer),
    'GET /api/papers/p1': () => json(200, paper(content)),
    'PATCH /api/papers/p1': () => json(200, { ...paper(content), content: undefined, canEdit: undefined, revision: 2 }),
    'POST /api/paper-images': async () => {
      await opts.hold;
      return opts.fail ? json(400, { statusCode: 400, errorCode: opts.fail }) : json(201, { id: ids.shift(), width: 2000, height: 1000 });
    },
  });
  renderApp('/editor/p1');
  const saved = () =>
    calls
      .filter((c) => c.method === 'PATCH')
      .map((c) => (JSON.parse(c.body) as { content?: Json }).content)
      .filter(Boolean) as Json[];
  const uploads = () => calls.filter((c) => c.method === 'POST' && c.path === '/api/paper-images');
  return { saved, uploads };
}

async function lastSaved(saved: () => Json[]): Promise<Json> {
  await waitFor(() => expect(saved().length).toBeGreaterThan(0), { timeout: 4000 });
  return saved().at(-1)!;
}

const sheet = async () => (await screen.findByLabelText('Текст документа')) as HTMLElement & { editor: Editor };

/** jsdom has no canvas nor decoding: a 3000 × 1500 picture, the canvas records its size and gives a blob of the type asked. */
function fakeCanvas() {
  const sizes: { width: number; height: number; type: string }[] = [];
  vi.stubGlobal('createImageBitmap', () => Promise.resolve({ width: 3000, height: 1500, close: () => {} }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ clearRect: () => {}, fillRect: () => {}, drawImage: () => {}, fillStyle: '' } as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback, type?: string) {
    sizes.push({ width: this.width, height: this.height, type: type ?? 'image/png' });
    cb(new Blob(['x'], { type: type ?? 'image/png' }));
  });
  return sizes;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Зображення: підготовка в браузері', () => {
  it('до 2000 px з довшого боку, пропорції ті самі; менше — як є', () => {
    expect(fitSize(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    expect(fitSize(1000, 3000)).toEqual({ width: 667, height: 2000 });
    expect(fitSize(640, 480)).toEqual({ width: 640, height: 480 });
  });

  it('PNG лишається PNG, JPG і WebP стають JPG; інше — ні', async () => {
    expect(outputType('image/png')).toBe('image/png');
    expect(outputType('image/jpeg')).toBe('image/jpeg');
    expect(outputType('image/webp')).toBe('image/jpeg');
    expect(outputType('image/gif')).toBeNull();
    await expect(prepareImage(new File(['x'], 'a.gif', { type: 'image/gif' }))).rejects.toMatchObject({ code: 'FILE_TYPE_NOT_ALLOWED' });
  });

  it('фото зменшено до 2000 px і перекодовано в JPG', async () => {
    const sizes = fakeCanvas();
    const blob = await prepareImage(new File(['x'], 'photo.webp', { type: 'image/webp' }));
    expect(blob.type).toBe('image/jpeg');
    expect(sizes).toEqual([{ width: 2000, height: 1000, type: 'image/jpeg' }]);
  });
});

describe('Зображення: «Вставка» в документі', () => {
  it('файл → завантаження → зображення на аркуші; поки вантажиться — у рядку стану', async () => {
    fakeCanvas();
    let answer = () => {};
    const hold = new Promise<void>((resolve) => (answer = resolve));
    const { saved, uploads } = open(doc(para('Схема')), { hold });
    await userEvent.click(await screen.findByRole('tab', { name: 'Вставка' }));
    expect(screen.getByRole('button', { name: 'Зображення' })).toBeEnabled();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp');
    await userEvent.upload(input, new File(['x'], 'logo.png', { type: 'image/png' }));
    expect(await screen.findByText('Завантаження зображення…')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('button', { name: 'Завантаження…' })).toBeDisabled();
    answer();
    const last = await lastSaved(saved);
    expect(last.content!.some((n) => n.type === 'image' && n.attrs?.id === A)).toBe(true);
    expect(uploads()).toHaveLength(1);
    expect(uploads()[0]!.headers.get('content-type')).toMatch(/^multipart\/form-data/);
    const img = (await sheet()).querySelector('figure.paper-image img')!;
    expect(img).toHaveAttribute('src', `/api/paper-images/${A}`);
    // Selected after it is put: the ribbon shows its group.
    expect(await screen.findByRole('group', { name: 'Зображення' })).toBeInTheDocument();
  });

  it('помилка сервера — текстом за кодом; на аркуші нічого', async () => {
    fakeCanvas();
    const { saved } = open(doc(para('Схема')), { fail: 'IMAGE_TOO_LARGE' });
    await userEvent.click(await screen.findByRole('tab', { name: 'Вставка' }));
    await userEvent.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!, new File(['x'], 'a.png', { type: 'image/png' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Зображення завелике');
    expect(saved()).toEqual([]);
  });

  it('вставлене з буфера стає на аркуш', async () => {
    fakeCanvas();
    const { saved } = open(doc(para('Схема')), { ids: [B] });
    const el = await sheet();
    await userEvent.click(el);
    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { files: [file], types: ['Files'], getData: () => '' } });
    act(() => {
      el.dispatchEvent(paste);
    });
    const last = await lastSaved(saved);
    expect(last.content!.some((n) => n.type === 'image' && n.attrs?.id === B)).toBe(true);
  });
});

describe('Зображення: виділене', () => {
  const selectImage = async () => {
    const el = await sheet();
    act(() => {
      const { editor } = el;
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)));
    });
    return screen.findByRole('group', { name: 'Зображення' });
  };

  it('ширина, бік і опис — у вузлі; «Видалити» прибирає', async () => {
    const { saved } = open(doc(image(A), para('Підпис')));
    const group = await selectImage();
    await userEvent.selectOptions(within(group).getByLabelText('Ширина зображення'), '50');
    await userEvent.click(within(group).getByRole('button', { name: 'Зображення праворуч' }));
    const alt = within(group).getByLabelText('Опис зображення');
    await userEvent.type(alt, '  Схема   стенду {Enter}');
    await waitFor(() => expect(saved().at(-1)?.content?.[0]).toEqual(image(A, { width: 50, align: 'right', alt: 'Схема стенду' })), { timeout: 4000 });
    expect(within(group).getByRole('button', { name: 'Зображення праворуч' })).toHaveAttribute('aria-pressed', 'true');
    const figure = (await sheet()).querySelector('figure')!;
    expect(figure).toHaveClass('paper-image', 'img-w-50', 'img-right');
    expect(figure.querySelector('img')).toHaveAttribute('alt', 'Схема стенду');

    await userEvent.click(within(group).getByRole('button', { name: 'Видалити' }));
    await waitFor(() => expect(saved().at(-1)?.content?.some((n) => n.type === 'image')).toBe(false), { timeout: 4000 });
    expect(screen.queryByRole('group', { name: 'Зображення' })).not.toBeInTheDocument();
  });

  it('у вкладці «Головна» теж', async () => {
    open(doc(image(A), para('x')));
    const group = await selectImage();
    expect(screen.getByRole('tab', { name: 'Головна' })).toHaveAttribute('aria-selected', 'true');
    expect(within(group).getByRole('button', { name: 'Зображення по центру' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(group).getByRole('button', { name: 'Зображення ліворуч' }));
    expect(within(group).getByRole('button', { name: 'Зображення ліворуч' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('Зображення: блок конструктора', () => {
  it('ставить зображення з id і виділяє його; на порожньому абзаці — замість нього', () => {
    expect(blockContent(IMAGE_BLOCK, A)).toEqual({ content: { type: 'image', attrs: { id: A } }, inline: false });
    const editor = testEditor({ content: doc(para('Шапка'), { type: 'paragraph' }) });
    const end = editor.state.doc.content.size - 1;
    expect(placeBlock(editor, IMAGE_BLOCK, A, { from: end, to: end })).toBe(true);
    // The editor keeps an empty paragraph after a block at the end (to type on below it).
    expect(editor.getJSON().content!.map((n) => n.type)).toEqual(['paragraph', 'image', 'paragraph']);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    // One more after it (several files at once): not in its place.
    const { to } = editor.state.selection;
    placeBlock(editor, IMAGE_BLOCK, B, { from: to, to });
    expect(editor.getJSON().content!.filter((n) => n.type === 'image').map((n) => n.attrs!.id)).toEqual([A, B]);
  });

  it('insertImage: після виділеного зображення, а не замість нього; у точку; вставлене — виділене', () => {
    const editor = testEditor({ content: doc(image(A), para('Текст')) });
    editor.commands.setNodeSelection(0);
    editor.commands.insertImage(B);
    expect(editor.getJSON().content!.filter((n) => n.type === 'image').map((n) => n.attrs!.id)).toEqual([A, B]);
    const sel = editor.state.selection as NodeSelection;
    expect(sel.node.attrs.id).toBe(B);
    const end = editor.state.doc.content.size;
    editor.commands.insertImage(A, end);
    expect(editor.getJSON().content!.filter((n) => n.type === 'image').map((n) => n.attrs!.id)).toEqual([A, B, A]);
    expect((editor.state.selection as NodeSelection).node.attrs.id).toBe(A);
  });
});
