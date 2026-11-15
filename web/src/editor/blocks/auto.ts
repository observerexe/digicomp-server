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
};

/** The day the document is published. */
export const autoDate: AutoBlock = {
  key: 'autoDate',
  group: 'auto',
  kind: 'auto',
  label: 'Дата',
  icon: 'calendar',
  words: ['авто', 'дата публікації'],
  node: 'paperDate',
};

/** The document's author («Ім'я ПРІЗВИЩЕ»). */
export const autoAuthor: AutoBlock = {
  key: 'autoAuthor',
  group: 'auto',
  kind: 'auto',
  label: 'Автор',
  icon: 'user',
  words: ['авто', 'автор документа'],
  node: 'paperAuthor',
};
