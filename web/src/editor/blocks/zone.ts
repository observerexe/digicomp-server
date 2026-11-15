import type { FieldBlock } from '.';

/** The author's own text with formatting, right on the sheet. */
export const zone: FieldBlock = {
  key: 'zone',
  group: 'field',
  kind: 'field',
  label: 'Вільна зона',
  icon: 'zone',
  words: ['текст', 'опис'],
  type: 'richtext',
  prefix: 'zone',
  hint: 'Текст, який людина пише просто на аркуші',
};
