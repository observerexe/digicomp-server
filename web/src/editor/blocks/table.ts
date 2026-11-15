import type { TextBlock } from '.';

const cell = () => ({ type: 'tableCell', content: [{ type: 'paragraph' }] });
const row = () => ({ type: 'tableRow', content: [cell(), cell()] });

/** Two columns, three rows; rows and columns are added from the ribbon. */
export const table: TextBlock = {
  key: 'table',
  group: 'text',
  kind: 'text',
  label: 'Таблиця',
  icon: 'table',
  nodes: ['table'],
  content: () => ({ type: 'table', content: [row(), row(), row()] }),
};
