import { Editor, type JSONContent } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { blockTag, removeField, renameField, selectionOf, setBlockAttrs } from './builder';
import { paperExtensions } from './extensions';
import { PENDING, setSheetInfo, type SheetInfo } from './structure';
import { keysOf } from './template';
import { peopleOf } from './useSheet';

const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const t = (text: string): JSONContent => ({ type: 'text', text });
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });
const sign = (attrs: Record<string, unknown>): JSONContent => ({ type: 'signatures', attrs });

const INFO: SheetInfo = {
  builder: false,
  number: null,
  paper: {
    institution: 'КОЛЕДЖ',
    groupName: 'Творча група <DigiComp>',
    signerPosition: 'Модератор',
    person: (who) => ({ '@author': 'Андрій ШЕВЧУК', '@signer': 'Артур МАШТАЛЕР', boss: 'Марія ЛИСЕНКО' })[who] ?? null,
    date: null,
    year: '2026',
  },
};

function open(content: JSONContent) {
  return new Editor({ extensions: paperExtensions(), injectCSS: false, content });
}

describe('Структура аркуша (structure.ts)', () => {
  it('шапка, гриф і підписи показують реквізити й імена — той самий HTML, що в друці; зміна реквізитів видна одразу', () => {
    const e = open(doc({ type: 'orgHeader' }, { type: 'approval' }, sign({ leftLabel: 'Видав', rightLabel: 'Прийняв', rightSigner: 'boss' })));
    setSheetInfo(e, INFO);
    const root = e.view.dom;
    expect(root.querySelector('.paper-org')!.innerHTML).toBe('<p class="paper-org-institution">КОЛЕДЖ</p><p class="paper-org-group">Творча група &lt;DigiComp&gt;</p>');
    expect(root.querySelector('.paper-approval')!.textContent).toBe('ЗАТВЕРДЖУЮМодераторАртур МАШТАЛЕР«»  2026 р.');
    expect([...root.querySelectorAll('.paper-signs-col')].map((c) => c.textContent)).toEqual(['ВидавАндрій ШЕВЧУК', 'ПрийнявМарія ЛИСЕНКО']);
    setSheetInfo(e, { ...INFO, paper: { ...INFO.paper, institution: '', groupName: '' } });
    expect(root.querySelector('.paper-org')!.textContent).toBe('Шапка: заповніть «Реквізити» на панелі керування');
    e.destroy();
  });

  it('стоїть лише на верхньому рівні: зі списку вставка розриває список', () => {
    const e = open(doc(p(t('Текст'))));
    e.chain().focus('end').insertContent({ type: 'approval' }).run();
    expect(e.getJSON().content!.map((n) => n.type)).toEqual(['paragraph', 'approval', 'paragraph']);
    e.commands.setContent(
      doc({
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [p(t('раз'))] },
          { type: 'listItem', content: [p(t('два'))] },
        ],
      }),
    );
    e.chain().setTextSelection(6).insertContent({ type: 'orgHeader' }).run();
    expect(e.getJSON().content!.map((n) => n.type)).toEqual(['bulletList', 'orgHeader', 'bulletList', 'paragraph']);
    e.destroy();
  });

  it('авто-значення: до публікації — сірі, потім — текст; у конструкторі — назви', () => {
    const e = open(doc(p({ type: 'paperNumber' }, t(' '), { type: 'paperDate' }, t(' '), { type: 'paperAuthor' }), { type: 'pageFooter', attrs: { text: 'Ф-01' } }));
    const shown = () => [...e.view.dom.querySelectorAll('.paper-field')].map((el) => [el.textContent, el.classList.contains('is-auto') ? 'auto' : 'fixed']);
    setSheetInfo(e, INFO);
    expect(shown()).toEqual([
      [PENDING, 'auto'],
      [PENDING, 'auto'],
      ['Андрій ШЕВЧУК', 'fixed'],
    ]);
    setSheetInfo(e, { ...INFO, number: 'ТЗ-2026-001', paper: { ...INFO.paper, date: '15.11.2026' } });
    expect(shown().map(([text]) => text)).toEqual(['ТЗ-2026-001', '15.11.2026', 'Андрій ШЕВЧУК']);
    setSheetInfo(e, { ...INFO, builder: true });
    expect(shown().map(([text]) => text)).toEqual(['{Номер}', '{Дата}', '{Автор}']);
    expect(e.view.dom.querySelector('.paper-footer')!.textContent).toBe('Колонтитул: Ф-01');
    e.destroy();
  });

  it('імена з полів учасника — «Ім’я ПРІЗВИЩЕ»; не вибрано — null', () => {
    const fields = [
      { key: 'boss', type: 'ref:user' },
      { key: 'help', type: 'ref:user' },
      { key: 'n', type: 'int' },
    ];
    expect(peopleOf(fields, { boss: 'u1', n: 3 }, (_type, id) => (id === 'u1' ? 'Марія Лисенко' : null))).toEqual({ boss: 'Марія ЛИСЕНКО', help: null });
  });
});

describe('Конструктор: блоки структури', () => {
  it('мітка — назва блоку жовтою групою; вибраний блок несе свої атрибути, «Властивості» їх змінюють', () => {
    const e = open(doc(p(t('x')), sign({ leftLabel: 'Склав' })));
    expect(blockTag(e.state.doc.child(1), { editable: true, fields: {} })).toEqual({ label: 'Блок підписів', group: 'structure' });
    e.view.dispatch(e.state.tr.setSelection(NodeSelection.create(e.state.doc, e.state.doc.child(0).nodeSize)));
    const sel = selectionOf(e.state);
    expect(sel).toMatchObject({ kind: 'block', index: 1, node: 'signatures', attrs: { leftLabel: 'Склав', leftSigner: '@author' } });
    setBlockAttrs(e, 1, { rightLabel: 'Прийняв', rightSigner: '@signer' });
    expect(e.state.doc.child(1).attrs).toEqual({ leftLabel: 'Склав', leftSigner: '@author', rightLabel: 'Прийняв', rightSigner: '@signer' });
    e.destroy();
  });

  it('учасник, що підписує, — поле шаблону; перейменування й видалення поля змінюють і підписи', () => {
    const e = open(doc(p(t('Головує: '), { type: 'field', attrs: { key: 'chair' } }), sign({ leftSigner: 'chair', rightLabel: 'Секретар', rightSigner: 'secretary' })));
    expect(keysOf(e.state.doc)).toEqual(['chair', 'secretary']);
    renameField(e, 'chair', 'head');
    expect(e.state.doc.child(1).attrs.leftSigner).toBe('head');
    expect(keysOf(e.state.doc)).toEqual(['head', 'secretary']);
    removeField(e, 'secretary');
    expect(e.state.doc.child(1).attrs.rightSigner).toBeNull();
    removeField(e, 'head');
    expect(e.state.doc.child(1).attrs.leftSigner).toBeNull();
    expect(keysOf(e.state.doc)).toEqual([]);
    e.destroy();
  });
});
