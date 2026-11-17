import { generateHTML, getSchema } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { ALIGNS, checkContent, COLORS, FONT_SIZES, FONTS, MARKS, MAX_INDENT, type PaperContent, type PaperNode } from '../../../shared/editor-schema';
import { renderContent } from '../../../shared/editor-schema/render';
import { paperExtensions } from './extensions';

/** The print (shared render.ts) gives the same HTML as the editor. */

const text = (t: string, marks?: PaperNode['marks']): PaperNode => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });
const p = (content: PaperNode[] = [], attrs?: PaperNode['attrs']): PaperNode => ({ type: 'paragraph', ...(attrs ? { attrs } : {}), ...(content.length ? { content } : {}) });
const li = (...content: PaperNode[]): PaperNode => ({ type: 'listItem', content });
const doc = (...content: PaperNode[]): PaperContent => ({ type: 'doc', content });

const bold = { type: 'bold' };
const italic = { type: 'italic' };
const style = (attrs: Record<string, unknown>) => ({ type: 'textStyle', attrs: { size: null, color: null, font: null, ...attrs } });

const CASES: [string, PaperContent][] = [
  ['порожній документ', doc(p())],
  ['екранування й нерозривний пробіл', doc(p([text('a < b && c > "d" \'e\' 10 мм <script>')]))],
  ['вирівнювання й відступи', doc(...ALIGNS.map((align, i) => p([text(align)], { align, indent: i })), p([text('max')], { align: null, indent: MAX_INDENT }))],
  [
    'заголовки',
    doc(
      { type: 'heading', attrs: { level: 1 }, content: [text('Один')] },
      { type: 'heading', attrs: { level: 2, align: 'center', indent: 1 }, content: [text('Два')] },
      { type: 'heading', attrs: { level: 3, align: null, indent: 0 } },
    ),
  ],
  ['розміри', doc(p(FONT_SIZES.map((size) => text(`${size} `, [style({ size })]))))],
  ['кольори', doc(p(COLORS.map((color) => text(`${color} `, [style({ color })]))))],
  ['шрифти', doc(p(FONTS.map((font) => text(`${font} `, [style({ font })]))))],
  ['усі позначки разом, у будь-якому порядку', doc(p([text('все', [{ type: 'underline' }, { type: 'strike' }, italic, bold, style({ size: 12, color: 'red', font: 'sans' })])]))],
  [
    'сусіди зі спільними позначками',
    doc(p([text('a', [bold]), text('b', [bold, italic]), text('c', [italic]), text('d', [style({ color: 'blue' }), bold]), text('e', [style({ color: 'red' }), bold]), text('f')])),
  ],
  ['розрив рядка з позначкою й без', doc(p([text('a', [bold]), { type: 'hardBreak', marks: [bold] }, text('b', [bold]), { type: 'hardBreak' }, text('c')]))],
  [
    'списки',
    doc(
      { type: 'bulletList', content: [li(p([text('раз')])), li(p([text('два')]), { type: 'bulletList', content: [li(p([text('вкладений')]))] })] },
      { type: 'orderedList', content: [li(p([text('1')]))] },
      { type: 'orderedList', attrs: { start: 1 }, content: [li(p())] },
      { type: 'orderedList', attrs: { start: 0 }, content: [li(p([text('0')]))] },
      { type: 'orderedList', attrs: { start: 7 }, content: [li(p([text('7')], { align: 'justify', indent: 0 }))] },
    ),
  ],
  [
    'таблиця з об’єднаними клітинками',
    doc({
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [p([text('Назва', [bold])])] },
            { type: 'tableHeader', content: [p([text('Значення')])] },
          ],
        },
        {
          type: 'tableRow',
          content: [{ type: 'tableCell', attrs: { colspan: 2, rowspan: 3, colwidth: null }, content: [p([text('x')]), { type: 'bulletList', content: [li(p())] }] }],
        },
      ],
    }),
  ],
  ['розрив сторінки', doc(p([text('до')]), { type: 'pageBreak' }, p([text('після')]))],
  [
    'зображення',
    doc(
      { type: 'image', attrs: { id: '0b8f1c2e-3d4a-4b5c-8d6e-7f8091a2b3c4' } },
      { type: 'image', attrs: { id: '1c9f2d3e-4e5b-4c6d-9e7f-8091a2b3c4d5', width: 50, align: 'right', alt: 'Схема "А" & <Б>' } },
      { type: 'bulletList', content: [li(p([text('пункт')]), { type: 'image', attrs: { id: '2d0a3e4f-5f6c-4d7e-8f90-91a2b3c4d5e6', width: 25, align: 'left' } })] },
    ),
  ],
  [
    'поля й зона шаблону',
    doc(p([text('Ім’я: '), { type: 'field', attrs: { key: 'name' } }, text(', бали: '), { type: 'field', attrs: { key: 'points_2' }, marks: [bold] }]), {
      type: 'fieldZone',
      attrs: { key: 'goal' },
      content: [p([text('Мета', [italic])]), { type: 'bulletList', content: [li(p([text('пункт')]))] }],
    }),
  ],
  [
    'посилання «@»',
    doc(
      p([
        text('Відповідальний: '),
        { type: 'mention', attrs: { type: 'user', id: '11111111-1111-4111-8111-111111111111' } },
        text(', ТЗ '),
        { type: 'mention', attrs: { type: 'inventory_item', id: '22222222-2222-4222-8222-222222222222' }, marks: [bold] },
      ]),
    ),
  ],
  ['«Авто: номер»', doc(p([text('№ '), { type: 'paperNumber' }, text(' від')]))],
  ['«Авто: дата» й «Авто: автор»', doc(p([{ type: 'paperDate' }, text(', '), { type: 'paperAuthor', marks: [bold] }]))],
  [
    'блоки структури',
    doc(
      { type: 'orgHeader' },
      { type: 'approval' },
      p([text('Текст')]),
      { type: 'signatures' },
      { type: 'signatures', attrs: { leftLabel: 'Видав "А" & Б', leftSigner: null, rightLabel: 'Прийняв', rightSigner: 'boss' } },
      { type: 'signatures', attrs: { leftLabel: '', leftSigner: '@signer', rightLabel: '', rightSigner: null } },
      { type: 'pageFooter' },
      { type: 'pageFooter', attrs: { text: 'Ф-01 «ТЗ» & ко' } },
    ),
  ],
  [
    'умовний блок',
    doc(p([{ type: 'field', attrs: { key: 'type' } }]), {
      type: 'conditional',
      attrs: { field: 'type', value: 'fine & "інше"' },
      content: [p([text('Розмір: '), { type: 'field', attrs: { key: 'amount' } }]), { type: 'fieldZone', attrs: { key: 'why' }, content: [p()] }],
    }),
  ],
  [
    'повторювані рядки',
    doc({
      type: 'repeat',
      attrs: { key: 'rows1' },
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', content: [p([text('№')])] },
                { type: 'tableHeader', content: [p([text('Бали', [bold])])] },
              ],
            },
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [p([{ type: 'rowNumber' }])] },
                { type: 'tableCell', content: [p([{ type: 'field', attrs: { key: 'points' } }, text(' б.')])] },
              ],
            },
          ],
        },
      ],
    }),
  ],
  ['авто-таблиця', doc(p([text('Журнал')]), { type: 'autoTable', attrs: { source: 'place_sessions', field: 'place' } })],
];

describe('Рендер друку = HTML редактора', () => {
  it('позначки вкладаються в порядку опису', () => {
    expect(Object.keys(getSchema(paperExtensions()).marks)).toEqual(Object.keys(MARKS));
  });

  it.each(CASES)('%s', (_name, content) => {
    expect(checkContent(content)).toBe(true);
    expect(renderContent(content)).toBe(generateHTML(content, paperExtensions()));
  });
});
