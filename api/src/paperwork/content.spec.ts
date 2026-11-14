import { CONTENT_LIMITS, EMPTY_CONTENT, isPaperContent } from './content';

const doc = (...content: unknown[]) => ({ type: 'doc', content });
const p = (...content: unknown[]) => ({ type: 'paragraph', content });
const text = (t: string, extra: object = {}) => ({
  type: 'text',
  text: t,
  ...extra,
});

describe('Вміст документа (ProseMirror JSON)', () => {
  it('порожній документ і звичайний текст — так', () => {
    expect(isPaperContent(EMPTY_CONTENT)).toBe(true);
    expect(isPaperContent({ type: 'doc' })).toBe(true);
    expect(
      isPaperContent(
        doc(
          { type: 'heading', attrs: { level: 1 }, content: [text('Назва')] },
          p(text('жирний', { marks: [{ type: 'bold' }] })),
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [
                  {
                    type: 'tableCell',
                    attrs: { colspan: 1, colwidth: [120], align: null },
                    content: [p(text('клітинка'))],
                  },
                ],
              },
            ],
          },
        ),
      ),
    ).toBe(true);
  });

  it.each([
    ['не обʼєкт', 'текст'],
    ['масив', [EMPTY_CONTENT]],
    ['корінь не doc', { type: 'paragraph' }],
    ['зайвий ключ у вузлі', doc({ type: 'paragraph', style: 'color:red' })],
    ['тип не рядок', doc({ type: 1 })],
    ['дивна назва типу', doc({ type: '<script>' })],
    ['content не масив', doc({ type: 'paragraph', content: 'x' })],
    ['текстовий вузол без тексту', doc(p({ type: 'text' }))],
    ['порожній текст', doc(p(text('')))],
    ['текст не в текстовому вузлі', doc({ type: 'paragraph', text: 'x' })],
    ['текстовий вузол з дітьми', doc(p({ ...text('x'), content: [] }))],
    [
      'мітка з зайвим ключем',
      doc(p(text('x', { marks: [{ type: 'b', x: 1 }] }))),
    ],
    ['мітки не масив', doc(p(text('x', { marks: { type: 'bold' } })))],
    ['атрибути не обʼєкт', doc({ type: 'heading', attrs: [1] })],
    ['вкладений обʼєкт в атрибуті', doc({ type: 'h', attrs: { a: { b: 1 } } })],
    ['дивний ключ атрибута', doc({ type: 'h', attrs: { 'on-click': 'x' } })],
    [
      'задовгий рядок атрибута',
      doc({
        type: 'h',
        attrs: { a: 'x'.repeat(CONTENT_LIMITS.attrString + 1) },
      }),
    ],
    ['нескінченне число', doc({ type: 'h', attrs: { a: Infinity } })],
  ])('%s — ні', (_label, value) => {
    expect(isPaperContent(value)).toBe(false);
  });

  it('межа вкладеності', () => {
    const nest = (n: number): object =>
      n === 0
        ? { type: 'paragraph' }
        : { type: 'list', content: [nest(n - 1)] };
    expect(isPaperContent(doc(nest(CONTENT_LIMITS.depth - 1)))).toBe(true);
    expect(isPaperContent(doc(nest(CONTENT_LIMITS.depth)))).toBe(false);
  });

  it('межа кількості вузлів', () => {
    const many = (n: number) =>
      doc(...Array.from({ length: n }, () => ({ type: 'paragraph' })));
    expect(isPaperContent(many(CONTENT_LIMITS.nodes - 1))).toBe(true);
    expect(isPaperContent(many(CONTENT_LIMITS.nodes))).toBe(false);
  });
});
