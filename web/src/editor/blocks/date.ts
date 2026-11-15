import type { FieldBlock } from '.';

export const date: FieldBlock = {
  key: 'date',
  group: 'field',
  kind: 'field',
  label: 'Дата',
  icon: 'calendar',
  words: ['час', 'термін'],
  type: 'date',
  prefix: 'date',
  hint: 'Дата або дата з часом',
  variants: [
    { type: 'date', label: 'Дата' },
    { type: 'datetime', label: 'Дата й час' },
  ],
};
