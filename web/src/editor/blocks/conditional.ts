import type { ConditionBlock } from '.';

/**
 * «Умовний блок» (shared/editor-schema `conditional`): what is in it is in the
 * document only while a field holds a value. It comes with a condition — the
 * first field it may wait for (editor/conditional.ts); «Властивості» change it.
 */
export const conditional: ConditionBlock = {
  key: 'conditional',
  group: 'structure',
  kind: 'condition',
  label: 'Умовний блок',
  icon: 'branch',
  words: ['умова', 'якщо'],
};
