import type { TextBlock } from '.';

/**
 * Structure of the sheet (shared/editor-schema STRUCTURE): only on its top
 * level. What they show comes from «Реквізити», the author and the fields
 * (editor/structure.ts); signatures and the footer are set in «Властивості».
 */

export const orgHeader: TextBlock = {
  key: 'orgHeader',
  group: 'structure',
  kind: 'text',
  label: 'Шапка',
  icon: 'header',
  words: ['реквізити', 'заклад'],
  nodes: ['orgHeader'],
  content: () => ({ type: 'orgHeader' }),
};

export const approval: TextBlock = {
  key: 'approval',
  group: 'structure',
  kind: 'text',
  label: 'Гриф «Затверджую»',
  icon: 'shield',
  words: ['затверджую', 'підписант'],
  nodes: ['approval'],
  content: () => ({ type: 'approval' }),
};

export const signatures: TextBlock = {
  key: 'signatures',
  group: 'structure',
  kind: 'text',
  label: 'Блок підписів',
  icon: 'pen',
  words: ['підпис'],
  nodes: ['signatures'],
  content: () => ({ type: 'signatures' }),
};

export const pageFooter: TextBlock = {
  key: 'pageFooter',
  group: 'structure',
  kind: 'text',
  label: 'Колонтитул',
  icon: 'footer',
  words: ['низ сторінки'],
  nodes: ['pageFooter'],
  content: () => ({ type: 'pageFooter' }),
};
