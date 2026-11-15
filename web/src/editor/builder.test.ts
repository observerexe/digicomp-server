import { Editor, type JSONContent } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { describe, expect, it, vi } from 'vitest';
import { BLOCKS } from './blocks';
import {
  badFields,
  blockTag,
  builderExtension,
  cleanPasted,
  cursorAtEnd,
  placeBlock,
  removeBlock,
  removeField,
  renameField,
  selectionOf,
  setBuilderLook,
  type BlockMenuState,
  type BuilderLook,
} from './builder';
import { paperExtensions } from './extensions';
import { fieldPosition } from './fields';

const block = (key: string) => BLOCKS.find((b) => b.key === key)!;
const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const t = (text: string): JSONContent => ({ type: 'text', text });
const f = (key: string): JSONContent => ({ type: 'field', attrs: { key } });
const zone = (key: string, ...content: JSONContent[]): JSONContent => ({ type: 'fieldZone', attrs: { key }, content: content.length ? content : [{ type: 'paragraph' }] });
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });

const LOOK: BuilderLook = {
  editable: true,
  fields: {
    points: { text: '{Бали}', state: 'field', tag: 'Число · points', group: 'field' },
    member: { text: '{Учасник}', state: 'data', tag: 'Учасник · member', group: 'data' },
    goal: { text: '{Мета}', state: 'field', tag: 'Вільна зона · goal', group: 'field' },
  },
};

function open(content: JSONContent, known = ['points', 'member', 'goal']) {
  const onPlace = vi.fn();
  const onEnd = vi.fn();
  const show = vi.fn<(m: BlockMenuState | null) => void>();
  const editor = new Editor({
    extensions: [...paperExtensions(), builderExtension({ known: () => new Set(known), onPlace, onEnd, menu: { show, key: () => false } })],
    injectCSS: false,
    content,
  });
  return { editor, onPlace, onEnd, show };
}

/** The top level of the body without default attributes: what is where. */
const shape = (e: Editor) =>
  e
    .getJSON()
    .content!.map((n) => [
      n.type,
      ...(n.attrs?.key ? [n.attrs.key] : []),
      ...(n.content ?? []).map((c: JSONContent) => (c.type === 'text' ? c.text : c.attrs?.key ? `{${c.attrs.key}}` : c.type)),
    ]);

describe('Конструктор: блоки на аркуші', () => {
  it('поле — у текст біля курсора; у порожній абзац — замість нього; після вставки поле виділене', () => {
    const { editor } = open(doc(p(t('Бали: ')), { type: 'paragraph' }));
    expect(placeBlock(editor, block('number'), 'points', { from: 7, to: 7 })).toBe(true);
    expect(shape(editor)).toEqual([['paragraph', 'Бали: ', '{points}'], ['paragraph']]);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(selectionOf(editor.state)).toEqual({ kind: 'field', key: 'points', picked: true });

    const empty = editor.state.doc.content.size - 1;
    placeBlock(editor, block('user'), 'member', { from: empty, to: empty });
    expect(shape(editor)).toEqual([
      ['paragraph', 'Бали: ', '{points}'],
      ['paragraph', '{member}'],
    ]);
  });

  it('блок — замість порожнього абзацу або після абзацу з текстом; курсор — у блоці', () => {
    const { editor } = open(doc(p(t('Вступ')), { type: 'paragraph' }));
    placeBlock(editor, block('heading'), null, { from: 3, to: 3 });
    expect(shape(editor)).toEqual([['paragraph', 'Вступ'], ['heading'], ['paragraph']]);
    expect(editor.state.selection.$from.parent.type.name).toBe('heading');
    const end = editor.state.doc.content.size - 1;
    placeBlock(editor, block('zone'), 'goal', { from: end, to: end });
    // StarterKit keeps an empty paragraph after the last block: there is always a place to type.
    expect(shape(editor)).toEqual([['paragraph', 'Вступ'], ['heading'], ['fieldZone', 'goal', 'paragraph'], ['paragraph']]);
    expect(selectionOf(editor.state)).toEqual({ kind: 'field', key: 'goal', picked: false });
  });

  it('«/…» замінюється блоком', () => {
    const { editor } = open(doc(p(t('/чис'))));
    placeBlock(editor, block('number'), 'points', { from: 1, to: 5 });
    expect(shape(editor)).toEqual([['paragraph', '{points}']]);
  });

  it('поле у вільній зоні не ставиться: блок поля — після зони; текстовий блок — у зоні', () => {
    const { editor } = open(doc(zone('goal', p(t('мета')))));
    placeBlock(editor, block('number'), 'points', { from: 4, to: 4 });
    expect(shape(editor)).toEqual([
      ['fieldZone', 'goal', 'paragraph'],
      ['paragraph', '{points}'],
    ]);
    // Directly into the zone — refused.
    const before = editor.getJSON();
    editor.commands.insertContentAt(3, f('points'));
    expect(editor.getJSON()).toEqual(before);
    expect(badFields(editor.schema.nodeFromJSON(doc(zone('goal', p(f('points'))))))).toBe(true);
    expect(badFields(editor.schema.nodeFromJSON(doc(zone('goal'), zone('goal'))))).toBe(true);
    expect(badFields(editor.schema.nodeFromJSON(doc(zone('goal'), p(f('points')), p(f('points')))))).toBe(false);
  });

  it('вставлене з буфера: свої поля лишаються, чужі зникають; зона, що вже є, стає текстом; у зону — лише текст', () => {
    const { editor } = open(doc(zone('goal')));
    const node = (j: JSONContent) => editor.schema.nodeFromJSON(j);
    const pasted = Fragment.from([node(p(t('Бали '), f('points'), f('alien'))), node(zone('goal', p(t('мета')))), node(zone('other', p(t('інше'))))]);
    const known = new Set(['points', 'goal']);
    const json = (fr: Fragment) => fr.toJSON() as JSONContent[];
    expect(json(cleanPasted(pasted, known, new Set(['goal']), { moving: false, intoZone: false }))).toEqual([
      { type: 'paragraph', attrs: { align: null, indent: 0 }, content: [t('Бали '), f('points')] },
      { type: 'paragraph', attrs: { align: null, indent: 0 }, content: [t('мета')] },
      { type: 'paragraph', attrs: { align: null, indent: 0 }, content: [t('інше')] },
    ]);
    // A move of the zone on the sheet keeps it.
    expect(json(cleanPasted(Fragment.from(node(zone('goal'))), known, new Set(['goal']), { moving: true, intoZone: false }))[0]!.type).toBe('fieldZone');
    expect(json(cleanPasted(pasted, known, new Set(), { moving: false, intoZone: true })).every((n) => n.type === 'paragraph')).toBe(true);

    // Through the editor: a paste into the zone takes the text only (jsdom has no ClipboardEvent).
    vi.stubGlobal('ClipboardEvent', class extends Event {});
    editor.commands.setTextSelection(2);
    editor.view.pasteHTML('<p>Бали <span class="paper-field" data-field="points"></span></p>');
    expect(shape(editor)).toEqual([['fieldZone', 'goal', 'paragraph'], ['paragraph']]);
    expect(editor.state.doc.textContent).toBe('Бали ');
  });

  it('перейменування ключа — на всьому аркуші; видалення поля забирає й абзац, де воно саме', () => {
    const { editor } = open(doc(p(t('Бали '), f('points')), p(f('points')), zone('goal')));
    editor.commands.setNodeSelection(fieldPosition(editor, 'points')!);
    renameField(editor, 'points', 'score');
    expect(selectionOf(editor.state)).toEqual({ kind: 'field', key: 'score', picked: true });
    expect(shape(editor)).toEqual([['paragraph', 'Бали ', '{score}'], ['paragraph', '{score}'], ['fieldZone', 'goal', 'paragraph'], ['paragraph']]);
    removeField(editor, 'score');
    expect(shape(editor)).toEqual([['paragraph', 'Бали '], ['fieldZone', 'goal', 'paragraph'], ['paragraph']]);
    removeField(editor, 'goal');
    expect(shape(editor)).toEqual([['paragraph', 'Бали '], ['paragraph']]);
    removeBlock(editor, 0);
    removeBlock(editor, 0);
    expect(shape(editor)).toEqual([['paragraph']]);
  });

  it('мітка блоку: поле, що одне в абзаці чи зоні, — мітка поля; кілька полів — блок і скільки їх; текст — назва блоку', () => {
    const { editor } = open(doc());
    const node = (j: JSONContent) => editor.schema.nodeFromJSON(j);
    expect(blockTag(node(p(t('Бали: '), f('points'))), LOOK)).toEqual({ label: 'Число · points', group: 'field' });
    expect(blockTag(node(p(f('member'))), LOOK)).toEqual({ label: 'Учасник · member', group: 'data' });
    expect(blockTag(node(zone('goal')), LOOK)).toEqual({ label: 'Вільна зона · goal', group: 'field' });
    expect(blockTag(node(p(f('points'), f('member'))), LOOK)).toEqual({ label: 'Абзац · 2 поля', group: 'text' });
    expect(blockTag(node({ type: 'heading', attrs: { level: 1 }, content: [t('1. Назва')] }), LOOK)).toEqual({ label: 'Заголовок', group: 'text' });
    expect(blockTag(node({ type: 'pageBreak' }), LOOK)).toEqual({ label: 'Розрив сторінки', group: 'text' });
  });

  it('умовний блок: жовта мітка з умовою словами (без підписів — ключі)', () => {
    const { editor } = open(doc());
    const cond = editor.schema.nodeFromJSON({ type: 'conditional', attrs: { field: 'type', value: 'fine' }, content: [p(f('points'))] });
    expect(blockTag(cond, { ...LOOK, condition: (_field, value) => `«Вид» = «${value === 'fine' ? 'Штраф' : value}»` })).toEqual({
      label: 'Умовний блок · якщо «Вид» = «Штраф»',
      group: 'structure',
    });
    expect(blockTag(cond, LOOK).label).toBe('Умовний блок · якщо type = fine');
  });

  it('на аркуші — рамки з мітками, активний блок, поля як {Підпис}; опублікована версія — рамки без підказки внизу й без «/»', () => {
    const { editor } = open(doc({ type: 'heading', attrs: { level: 2 }, content: [t('Мета')] }, zone('goal'), p(t('Бали '), f('points'))));
    setBuilderLook(editor, LOOK);
    const dom = editor.view.dom;
    const frames = [...dom.querySelectorAll('.paper-block')];
    expect(frames.map((e) => e.getAttribute('data-label'))).toEqual(['Заголовок', 'Вільна зона · goal', 'Число · points']);
    expect(frames[1]).toHaveClass('is-field');
    expect(dom.querySelector('.paper-field')).toHaveTextContent('{Бали}');
    expect(dom.querySelector('.paper-field')).toHaveClass('is-field');
    expect(dom.querySelector('.paper-end')).toHaveTextContent('Перетягніть блок сюди або натисніть «/»');
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, fieldPosition(editor, 'goal')! + 2)));
    expect(dom.querySelector('.paper-block.is-active')).toHaveAttribute('data-label', 'Вільна зона · goal');

    setBuilderLook(editor, { ...LOOK, editable: false });
    expect(dom.querySelectorAll('.paper-block')).toHaveLength(3);
    expect(dom.querySelector('.paper-block.is-active')).toBeNull();
    expect(dom.querySelector('.paper-end')).toBeNull();
  });

  it('«/» не відкривається на опублікованій версії', () => {
    const { editor, show } = open(doc(p(t('Текст'))));
    setBuilderLook(editor, { ...LOOK, editable: false });
    editor.chain().focus('end').insertContent(' /чис').run();
    expect(show).not.toHaveBeenCalledWith(expect.objectContaining({ query: 'чис' }));
  });

  it('«/» відкриває список блоків; вибір ставить блок замість «/…»; клік під останнім блоком — курсор у кінці', () => {
    const { editor, onPlace, show, onEnd } = open(doc(p(t('Текст'))));
    setBuilderLook(editor, LOOK);
    editor.chain().focus('end').insertContent(' /чис').run();
    const menu = show.mock.calls.at(-1)![0]!;
    expect(menu.query).toBe('чис');
    menu.pick(block('number'));
    expect(onPlace).toHaveBeenCalledWith('number', { from: 7, to: 11 });

    editor.view.dom.querySelector('.paper-end')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onEnd).toHaveBeenCalled();
    cursorAtEnd(editor);
    expect(shape(editor).at(-1)).toEqual(['paragraph']);
    expect(editor.state.selection.$from.parent.content.size).toBe(0);
  });
});
