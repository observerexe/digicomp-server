import { mergeAttributes, Node } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { conditionHolds, conditionKind, IF_FILLED, IF_NO, IF_YES, type Condition, type FieldOption, type FieldValues } from '../../../shared/editor-schema/fields';

/**
 * «Умовний блок» (shared/editor-schema: `conditional`): its blocks are in the
 * document only while a field of the template holds a value (a choice is
 * chosen, a checkbox is ticked or not, a field is filled). On the
 * top level only, never one in another. In a document a block that is off is
 * hidden (fields.ts, FieldsLook.values); in the constructor — a frame with
 * its condition (builder.ts).
 */

const dataAttr = (name: 'field' | 'value') => ({
  default: null,
  parseHTML: (el: HTMLElement) => el.getAttribute(`data-${name}`),
  renderHTML: (attrs: Record<string, unknown>) => (attrs[name] === null ? {} : { [`data-${name}`]: attrs[name] }),
});

export const Conditional = Node.create({
  name: 'conditional',
  group: 'conditional',
  content: 'block+',
  defining: true,
  isolating: true,
  addAttributes() {
    return { field: dataAttr('field'), value: dataAttr('value') };
  },
  parseHTML() {
    return [{ tag: 'div.paper-if' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ class: 'paper-if' }, HTMLAttributes), 0];
  },
});

/** The condition of a conditional block node. */
export function conditionOfNode(n: PMNode): Condition {
  return { field: n.attrs.field as string, value: n.attrs.value as string };
}

/** Fields and zones of conditional blocks: the condition each waits for, by key. */
export function conditionsIn(doc: PMNode): Record<string, Condition> {
  const out: Record<string, Condition> = {};
  doc.forEach((block) => {
    if (block.type.name !== 'conditional') return;
    const c = conditionOfNode(block);
    block.descendants((n) => {
      if (n.type.name === 'field' || n.type.name === 'fieldZone') out[n.attrs.key as string] = c;
      return true;
    });
  });
  return out;
}

/** The field is in a conditional block that is off by these values. */
export function isOff(key: string, conditions: Readonly<Record<string, Condition>>, values: FieldValues): boolean {
  const c = conditions[key];
  return !!c && !conditionHolds(c, values);
}

/** What a conditional block may wait for in a field and its words in «Властивості». */
export type ConditionOption = { value: string; label: string };

/** What a conditional block may wait for in a field of this type; `choices` — the field's (archived ones are not offered). */
export function conditionOptions(type: string, choices: readonly FieldOption[]): ConditionOption[] {
  switch (conditionKind(type)) {
    case 'choices':
      return choices.filter((o) => !o.archived).map((o) => ({ value: o.key, label: `обрано «${o.label}»` }));
    case 'yesNo':
      return [
        { value: IF_YES, label: 'позначено' },
        { value: IF_NO, label: 'не позначено' },
      ];
    case 'filled':
      return [{ value: IF_FILLED, label: 'заповнено' }];
    default:
      return [];
  }
}

/** A condition in words: «у «Вид стягнення» обрано «Штраф»», «позначено «Терміново»», «заповнено «Термін»». */
export function conditionWords(c: Condition, field: string | undefined, choices: readonly FieldOption[]): string {
  const name = `«${field ?? c.field}»`;
  if (c.value === IF_YES) return `позначено ${name}`;
  if (c.value === IF_NO) return `не позначено ${name}`;
  if (c.value === IF_FILLED) return `заповнено ${name}`;
  return `у ${name} обрано «${choices.find((o) => o.key === c.value)?.label ?? c.value}»`;
}
