import type { TextBlock } from '.';

export const heading: TextBlock = {
  key: 'heading',
  group: 'text',
  kind: 'text',
  label: 'Заголовок',
  icon: 'heading',
  nodes: ['heading'],
  content: () => ({ type: 'heading', attrs: { level: 2 } }),
};
