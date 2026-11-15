import type { TextBlock } from '.';

export const pageBreak: TextBlock = {
  key: 'pageBreak',
  group: 'text',
  kind: 'text',
  label: 'Розрив сторінки',
  icon: 'pageBreak',
  words: ['сторінка'],
  nodes: ['pageBreak'],
  content: () => ({ type: 'pageBreak' }),
};
