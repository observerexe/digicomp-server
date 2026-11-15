import type { TextBlock } from '.';

export const paragraph: TextBlock = {
  key: 'paragraph',
  group: 'text',
  kind: 'text',
  label: 'Абзац',
  icon: 'paragraph',
  words: ['текст'],
  nodes: ['paragraph'],
  content: () => ({ type: 'paragraph' }),
};
