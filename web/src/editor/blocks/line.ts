import type { FieldBlock } from '.';

/** One line of text («Назва роботи»). */
export const line: FieldBlock = {
  key: 'line',
  group: 'field',
  kind: 'field',
  label: 'Рядок',
  icon: 'textField',
  words: ['текст', 'поле'],
  type: 'text',
  prefix: 'text',
  hint: 'Рядок тексту, який заповнює людина',
};
