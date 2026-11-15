import type { FieldBlock } from '.';

export const number: FieldBlock = {
  key: 'number',
  group: 'field',
  kind: 'field',
  label: 'Число',
  icon: 'number',
  type: 'int',
  prefix: 'number',
  hint: 'Число, яке вводить людина',
  variants: [
    { type: 'int', label: 'Ціле' },
    { type: 'decimal', label: 'Дробове' },
  ],
};
