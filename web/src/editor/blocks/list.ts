import type { TextBlock } from '.';

export const list: TextBlock = {
  key: 'list',
  group: 'text',
  kind: 'text',
  label: 'Список',
  icon: 'listBullet',
  nodes: ['bulletList', 'orderedList'],
  content: () => ({ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] }),
};
