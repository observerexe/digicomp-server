import { Editor, type JSONContent } from '@tiptap/core';
import { DOMParser as PMDOMParser } from '@tiptap/pm/model';
import { describe, expect, it, vi } from 'vitest';
import { checkContent } from '../../../shared/editor-schema';
import { matchesBody } from '../../../shared/editor-schema/fields';
import { paperExtensions } from './extensions';
import { fieldPosition, setFieldsLook, zoneAtSelection, zoneTexts } from './fields';

/** A document made from a template: a line with a field, a free zone, a plain zone, a zone a moderator fills. */
const body: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Ім’я: ' },
        { type: 'field', attrs: { key: 'name' } },
      ],
    },
    { type: 'fieldZone', attrs: { key: 'notes' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'вільно' }] }] },
    { type: 'fieldZone', attrs: { key: 'goal' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'мета' }] }] },
    { type: 'fieldZone', attrs: { key: 'verdict' }, content: [{ type: 'paragraph' }] },
  ],
};

function open(onFieldClick = vi.fn()) {
  const editor = new Editor({
    extensions: paperExtensions({ plain: new Set(['goal']), locked: new Set(['verdict']), onFieldClick }),
    injectCSS: false,
    content: body,
  });
  return { editor, onFieldClick };
}

/** Position inside the text of a zone (after its first character). */
const inZone = (e: Editor, key: string) => fieldPosition(e, key)! + 3;

describe('Документ із шаблону: заблокований текст', () => {
  it('у вільній зоні пишеться й форматується; документ лишається за тілом', () => {
    const { editor } = open();
    editor.chain().setTextSelection(inZone(editor, 'notes')).insertContent('!').run();
    editor
      .chain()
      .setTextSelection({ from: inZone(editor, 'notes'), to: inZone(editor, 'notes') + 2 })
      .toggleBold()
      .run();
    expect(zoneTexts(editor.state.doc).notes).toBe('в!ільно');
    expect(JSON.stringify(editor.getJSON())).toContain('"bold"');
    const json = editor.getJSON();
    expect(checkContent(json)).toBe(true);
    expect(matchesBody(json as never, body as never)).toBe(true);
  });

  it('поза зонами нічого не змінюється: ні текст, ні поле, ні вирівнювання', () => {
    const { editor } = open();
    const before = JSON.stringify(editor.getJSON());
    editor.chain().setTextSelection(3).insertContent('X').run();
    editor.chain().setNodeSelection(fieldPosition(editor, 'name')!).deleteSelection().run();
    editor.chain().setTextSelection(3).setAlign('center').run();
    editor.chain().selectAll().deleteSelection().run();
    expect(JSON.stringify(editor.getJSON())).toBe(before);
  });

  it('проста зона — лише текст: форматування й заголовок не проходять', () => {
    const { editor } = open();
    const before = JSON.stringify(editor.getJSON());
    editor
      .chain()
      .setTextSelection({ from: inZone(editor, 'goal') - 1, to: inZone(editor, 'goal') + 1 })
      .toggleBold()
      .run();
    editor.chain().setTextSelection(inZone(editor, 'goal')).setHeading({ level: 1 }).run();
    expect(JSON.stringify(editor.getJSON())).toBe(before);
    editor.chain().setTextSelection(inZone(editor, 'goal')).insertContent('й').run();
    expect(zoneTexts(editor.state.doc).goal).toBe('мйета');
  });

  it('зону модератора автор не змінює', () => {
    const { editor } = open();
    editor
      .chain()
      .setTextSelection(fieldPosition(editor, 'verdict')! + 2)
      .insertContent('так')
      .run();
    expect(zoneTexts(editor.state.doc).verdict).toBe('');
  });

  it('вставка в просту зону — простим текстом; у вільну — без полів шаблону', () => {
    const { editor } = open();
    const pasted = (html: string) => {
      const el = document.createElement('div');
      el.innerHTML = html;
      const slice = PMDOMParser.fromSchema(editor.schema).parseSlice(el);
      let out = slice;
      editor.view.someProp('transformPasted', (f) => {
        out = f(out, editor.view, true);
      });
      return out;
    };
    editor.chain().setTextSelection(inZone(editor, 'goal')).run();
    const plain = pasted('<p><strong>жирний</strong></p><h1>заголовок</h1>');
    expect(plain.content.toJSON()).toEqual([
      { type: 'paragraph', attrs: { align: null, indent: 0 }, content: [{ type: 'text', text: 'жирний' }] },
      { type: 'paragraph', attrs: { align: null, indent: 0 }, content: [{ type: 'text', text: 'заголовок' }] },
    ]);
    editor.view.dispatch(editor.state.tr.replaceSelection(plain));
    expect(zoneTexts(editor.state.doc).goal).toContain('жирний');

    editor.chain().setTextSelection(inZone(editor, 'notes')).run();
    const free = pasted('<p><em>з полем</em> <span class="paper-field" data-field="name"></span> тут</p>');
    expect(JSON.stringify(free.content.toJSON())).not.toContain('"field"');
    expect(JSON.stringify(free.content.toJSON())).toContain('italic');
  });

  it('де курсор: у зоні — її ключ, поза зонами — null', () => {
    const { editor } = open();
    editor.chain().setTextSelection(inZone(editor, 'goal')).run();
    expect(zoneAtSelection(editor.state)).toBe('goal');
    editor.chain().setTextSelection(2).run();
    expect(zoneAtSelection(editor.state)).toBeNull();
  });

  it('поле показує значення з панелі; клік по полю — до панелі', () => {
    const { editor, onFieldClick } = open();
    setFieldsLook(editor, { fields: { name: { text: 'Іван', state: 'filled' } }, zones: {}, active: null });
    const dom = editor.view.nodeDOM(fieldPosition(editor, 'name')!) as HTMLElement;
    expect(dom.textContent).toBe('Іван');
    expect(dom.className).toBe('paper-field is-filled');
    // Не зміна документа: автозбереження й історія не зачеплені.
    expect(editor.can().undo()).toBe(false);
    editor.view.someProp('handleClickOn', (f) =>
      f(editor.view, fieldPosition(editor, 'name')!, editor.state.doc.nodeAt(fieldPosition(editor, 'name')!)!, 0, new MouseEvent('click'), true),
    );
    expect(onFieldClick).toHaveBeenCalledWith('name');
  });
});
