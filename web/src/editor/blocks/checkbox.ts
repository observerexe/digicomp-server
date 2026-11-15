import type { FieldBlock } from '.';

export const checkbox: FieldBlock = {
  key: 'checkbox',
  group: 'field',
  kind: 'field',
  label: 'Прапорець',
  icon: 'checkbox',
  words: ['так', 'ні'],
  type: 'bool',
  prefix: 'check',
  hint: 'Так або ні',
};
