import {
  checkContent,
  COLORS,
  CONTENT_LIMITS,
  EMPTY_CONTENT,
  FONT_SIZES,
  FONTS,
  formatClasses,
  MAX_INDENT,
  NODES,
} from '../../../shared/editor-schema';

const doc = (...content: unknown[]) => ({ type: 'doc', content });
const p = (...content: unknown[]) => ({ type: 'paragraph', content });
const text = (t: string, extra: object = {}) => ({
  type: 'text',
  text: t,
  ...extra,
});
const styled = (attrs: object) =>
  doc(p(text('x', { marks: [{ type: 'textStyle', attrs }] })));
const cell = (attrs: object = {}) => ({
  type: 'tableCell',
  attrs: { colspan: 1, rowspan: 1, colwidth: null, ...attrs },
  content: [p(text('клітинка'))],
});
const table = (c: object) =>
  doc({ type: 'table', content: [{ type: 'tableRow', content: [c] }] });

describe('Вміст документа (спільний опис редактора)', () => {
  it('порожній документ і звичайний текст — так', () => {
    expect(checkContent(EMPTY_CONTENT)).toBe(true);
    expect(checkContent({ type: 'doc' })).toBe(true);
    expect(
      checkContent(
        doc(
          {
            type: 'heading',
            attrs: { level: 1, align: 'center', indent: 0 },
            content: [text('Назва')],
          },
          p(
            text('жирний', { marks: [{ type: 'bold' }, { type: 'italic' }] }),
            { type: 'hardBreak' },
            text('ще'),
          ),
          {
            type: 'bulletList',
            content: [{ type: 'listItem', content: [p(text('пункт'))] }],
          },
          {
            type: 'orderedList',
            attrs: { start: 3 },
            content: [{ type: 'listItem', content: [p()] }],
          },
          { type: 'pageBreak' },
        ),
      ),
    ).toBe(true);
    expect(checkContent(table(cell({ colspan: 2 })))).toBe(true);
  });

  it('усе форматування з опису — так', () => {
    for (const size of FONT_SIZES) {
      expect(checkContent(styled({ size }))).toBe(true);
    }
    for (const color of COLORS) {
      expect(checkContent(styled({ color }))).toBe(true);
    }
    for (const font of FONTS) {
      expect(checkContent(styled({ font }))).toBe(true);
    }
    expect(checkContent(styled({ size: null, color: null, font: null }))).toBe(
      true,
    );
    expect(
      checkContent(doc({ type: 'paragraph', attrs: { indent: MAX_INDENT } })),
    ).toBe(true);
  });

  it('кожен вузол опису досяжний з doc, діти — вузли опису', () => {
    const reached = new Set(['doc']);
    for (const rule of Object.values(NODES)) {
      for (const child of rule.children ?? []) {
        expect(NODES[child]).toBeDefined();
        reached.add(child);
      }
    }
    expect([...reached].sort()).toEqual(Object.keys(NODES).sort());
  });

  it('атрибути без прототипу (так їх будує ProseMirror) — так, інші класи — ні', () => {
    const attrs = Object.assign(Object.create(null) as object, {
      align: 'center',
    });
    expect(checkContent(doc({ type: 'paragraph', attrs }))).toBe(true);
    expect(
      checkContent(doc({ type: 'paragraph', attrs: new Map([['a', 1]]) })),
    ).toBe(false);
  });

  it('класи форматування не повторюються', () => {
    const classes = formatClasses();
    expect(new Set(classes).size).toBe(classes.length);
  });

  it.each([
    ['не обʼєкт', 'текст'],
    ['масив', [EMPTY_CONTENT]],
    ['корінь не doc', { type: 'paragraph' }],
    ['зайвий ключ у вузлі', doc({ type: 'paragraph', style: 'color:red' })],
    ['тип не рядок', doc({ type: 1 })],
    ['невідомий вузол', doc({ type: 'image', attrs: { src: 'x' } })],
    ['вузол не на своєму місці', doc(text('x'))],
    ['пункт списку поза списком', doc({ type: 'listItem' })],
    ['діти в листі', doc({ type: 'pageBreak', content: [] })],
    ['content не масив', doc({ type: 'paragraph', content: 'x' })],
    ['текстовий вузол без тексту', doc(p({ type: 'text' }))],
    ['порожній текст', doc(p(text('')))],
    ['текст не в текстовому вузлі', doc({ type: 'paragraph', text: 'x' })],
    ['текстовий вузол з дітьми', doc(p({ ...text('x'), content: [] }))],
    [
      'мітка з зайвим ключем',
      doc(p(text('x', { marks: [{ type: 'bold', x: 1 }] }))),
    ],
    ['невідома мітка', doc(p(text('x', { marks: [{ type: 'link' }] })))],
    ['мітки не масив', doc(p(text('x', { marks: { type: 'bold' } })))],
    ['мітки на блоці', doc({ type: 'paragraph', marks: [{ type: 'bold' }] })],
    ['атрибути не обʼєкт', doc({ type: 'heading', attrs: [1] })],
    [
      'атрибут style',
      doc({ type: 'paragraph', attrs: { style: 'color:red' } }),
    ],
    ['атрибут class', doc({ type: 'paragraph', attrs: { class: 'x' } })],
    ['рівень заголовка 4', doc({ type: 'heading', attrs: { level: 4 } })],
    ['рівень заголовка null', doc({ type: 'heading', attrs: { level: null } })],
    [
      'вирівнювання не з набору',
      doc({ type: 'paragraph', attrs: { align: 'left' } }),
    ],
    [
      'відступ більший за межу',
      doc({ type: 'paragraph', attrs: { indent: MAX_INDENT + 1 } }),
    ],
    ['відступ дробовий', doc({ type: 'paragraph', attrs: { indent: 1.5 } })],
    ['розмір не з набору', styled({ size: 13 })],
    ['розмір рядком', styled({ size: '14' })],
    ['колір не з палітри', styled({ color: '#ff0000' })],
    ['шрифт не з набору', styled({ font: 'Comic Sans' })],
    ['ширина колонки', table(cell({ colwidth: [120] }))],
    ['вирівнювання клітинки', table(cell({ align: 'left' }))],
    ['обʼєднання нуль клітинок', table(cell({ colspan: 0 }))],
  ])('%s — ні', (_label, value) => {
    expect(checkContent(value)).toBe(false);
  });

  it('межа вкладеності', () => {
    const nest = (n: number): object =>
      n === 0
        ? p()
        : {
            type: 'bulletList',
            content: [{ type: 'listItem', content: [nest(n - 1)] }],
          };
    // Each level is two nodes (list and item); the doc is depth 0.
    const levels = (CONTENT_LIMITS.depth - 2) / 2;
    expect(checkContent(doc(nest(levels)))).toBe(true);
    expect(checkContent(doc(nest(levels + 1)))).toBe(false);
  });

  it('межа кількості вузлів', () => {
    const many = (n: number) => doc(...Array.from({ length: n }, () => p()));
    expect(checkContent(many(CONTENT_LIMITS.nodes - 1))).toBe(true);
    expect(checkContent(many(CONTENT_LIMITS.nodes))).toBe(false);
  });
});
