import { Editor, type JSONContent } from '@tiptap/core';
import { DOMParser as PMDOMParser } from '@tiptap/pm/model';
import { describe, expect, it, vi } from 'vitest';
import { checkContent } from '../../../shared/editor-schema';
import { matchesBody } from '../../../shared/editor-schema/fields';
import { paperExtensions } from './extensions';
import { fieldPosition, setFieldsLook, setZoneText, zoneAtSelection, zoneTexts } from './fields';

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
    extensions: paperExtensions({ template: { plain: new Set(['goal']), locked: new Set(['verdict']), fillable: new Set(['name', 'notes', 'goal']), onFieldClick } }),
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

  it('текст зони — рядок на абзац; запис із форми телефона — абзаци зони, документ лишається за тілом', () => {
    const { editor } = open();
    setZoneText(editor, 'goal', 'перший\n\nтретій');
    expect(editor.getJSON().content![2]).toEqual({
      type: 'fieldZone',
      attrs: { key: 'goal' },
      content: [
        { type: 'paragraph', attrs: { align: null, indent: 0 }, content: [{ type: 'text', text: 'перший' }] },
        { type: 'paragraph', attrs: { align: null, indent: 0 } },
        { type: 'paragraph', attrs: { align: null, indent: 0 }, content: [{ type: 'text', text: 'третій' }] },
      ],
    });
    expect(zoneTexts(editor.state.doc).goal).toBe('перший\n\nтретій');
    expect(matchesBody(editor.getJSON() as never, body as never)).toBe(true);
    // Порожній текст — один порожній абзац (зона не буває без абзацу).
    setZoneText(editor, 'goal', '');
    expect(zoneTexts(editor.state.doc).goal).toBe('');
    expect(checkContent(editor.getJSON())).toBe(true);
  });

  it('запис із форми не змінює зону модератора', () => {
    const { editor } = open();
    setZoneText(editor, 'verdict', 'так');
    expect(zoneTexts(editor.state.doc).verdict).toBe('');
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

describe('Tab між полями', () => {
  /** A key as the browser gives it (the keyboardShortcut command would put its own selection back). */
  const press = (e: Editor, key: string, shiftKey = false) => !!e.view.someProp('handleKeyDown', (f) => f(e.view, new KeyboardEvent('keydown', { key, shiftKey })));

  it('Tab — до наступного поля, яке людина заповнює; Shift+Tab — назад', () => {
    const { editor, onFieldClick } = open();
    editor.chain().setTextSelection(2).run();
    press(editor, 'Tab');
    // Поле в рядку: вибране на аркуші, введення — у панелі.
    expect(editor.state.selection.from).toBe(fieldPosition(editor, 'name'));
    expect(onFieldClick).toHaveBeenLastCalledWith('name');
    press(editor, 'Tab');
    expect(zoneAtSelection(editor.state)).toBe('notes');
    press(editor, 'Tab');
    expect(zoneAtSelection(editor.state)).toBe('goal');
    // «Висновок» заповнює модератор: далі нікуди, Tab лишається браузеру.
    expect(press(editor, 'Tab')).toBe(false);
    expect(zoneAtSelection(editor.state)).toBe('goal');
    press(editor, 'Tab', true);
    expect(zoneAtSelection(editor.state)).toBe('notes');
    onFieldClick.mockClear();
    press(editor, 'Tab', true);
    expect(onFieldClick).toHaveBeenLastCalledWith('name');
  });

  it('у списку Tab лишається відступом пункту', () => {
    const { editor, onFieldClick } = open();
    editor.chain().setTextSelection(inZone(editor, 'notes')).toggleBulletList().run();
    editor.chain().splitListItem('listItem').insertContent('другий').run();
    press(editor, 'Tab');
    expect(zoneAtSelection(editor.state)).toBe('notes');
    expect(onFieldClick).not.toHaveBeenCalled();
    expect(JSON.stringify(editor.getJSON().content![1])).toMatch(/"bulletList".*"bulletList"/);
  });
});

describe('Посилання «@»', () => {
  const RECORD = { type: 'task' as const, id: '11111111-1111-4111-8111-111111111111', title: 'Корпус', archived: false };
  const mentionDoc = (id: string): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { type: 'task', id } }] }] });

  it('на аркуші — назва запису з посиланням; невидимий — «запис недоступний»', () => {
    const editor = new Editor({
      extensions: paperExtensions({ mention: { record: (type, id) => (type === RECORD.type && id === RECORD.id ? RECORD : null) } }),
      injectCSS: false,
      content: mentionDoc(RECORD.id),
    });
    const a = editor.view.dom.querySelector('a.paper-ref')!;
    expect(a.textContent).toBe('Корпус');
    expect(a.getAttribute('href')).toBe(`/tasks/${RECORD.id}`);
    expect(editor.getText()).toBe('Корпус');
    editor.commands.setContent(mentionDoc('22222222-2222-4222-8222-222222222222'));
    expect(editor.view.dom.querySelector('.paper-ref.is-missing')!.textContent).toBe('запис недоступний');
  });
});
