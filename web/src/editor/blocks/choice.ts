import type { FieldBlock } from '.';

/** A choice from a dictionary (or from the record's field it is bound to). */
export const choice: FieldBlock = {
  key: 'choice',
  group: 'field',
  kind: 'field',
  label: 'Вибір',
  icon: 'choice',
  words: ['список', 'довідник'],
  type: 'enum',
  prefix: 'choice',
  hint: 'Вибір із довідника',
  variants: [
    { type: 'enum', label: 'Один' },
    { type: 'list<enum>', label: 'Кілька' },
  ],
};
