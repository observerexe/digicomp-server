import type { AutoBlock } from '.';

/** The document's number (`ТЗ-2026-014`): given when it is published, if the template has a prefix. */
export const autoNumber: AutoBlock = {
  key: 'autoNumber',
  group: 'auto',
  kind: 'auto',
  label: 'Номер',
  icon: 'number',
  words: ['авто', 'номер документа'],
  node: 'paperNumber',
  text: '{Номер}',
};
