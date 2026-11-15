import type { JSONContent } from '@tiptap/core';
import type { FieldBlock } from '.';

/**
 * «Повторювані рядки»: a table whose last row repeats, a row a value of the
 * field (shared/editor-schema `repeat`). Fields put into the last row are its
 * columns; the rows above are the header.
 */
export const rows: FieldBlock = {
  key: 'rows',
  group: 'structure',
  kind: 'field',
  label: 'Повторювані рядки',
  icon: 'table',
  words: ['таблиця', 'відомість', 'список', 'рядки'],
  type: 'rows',
  prefix: 'rows',
  hint: 'Таблиця, де людина додає рядки. Поля в нижньому рядку — стовпці',
};

const cell = (type: 'tableHeader' | 'tableCell', content: JSONContent[] = []): JSONContent => ({ type, content: [{ type: 'paragraph', content }] });

/** What the block puts on the sheet: a header «№ | Стовпець», then the row that repeats (its number, a cell for a field). */
export function rowsContent(key: string): JSONContent {
  return {
    type: 'repeat',
    attrs: { key },
    content: [
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: [cell('tableHeader', [{ type: 'text', text: '№' }]), cell('tableHeader', [{ type: 'text', text: 'Стовпець' }])] },
          { type: 'tableRow', content: [cell('tableCell', [{ type: 'rowNumber' }]), cell('tableCell')] },
        ],
      },
    ],
  };
}
