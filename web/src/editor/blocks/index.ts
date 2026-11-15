import type { JSONContent } from '@tiptap/core';
import type { IconName } from '../../components/Icon';
import { autoAuthor, autoDate, autoNumber, autoRowNumber } from './auto';
import { checkbox } from './checkbox';
import { choice } from './choice';
import { date } from './date';
import { heading } from './heading';
import { line } from './line';
import { list } from './list';
import { number } from './number';
import { pageBreak } from './pageBreak';
import { paragraph } from './paragraph';
import { RECORD_BLOCKS } from './record';
import { rows } from './rows';
import { approval, orgHeader, pageFooter, signatures } from './structure';
import { table } from './table';
import { zone } from './zone';

/**
 * Blocks of the template constructor: what the palette and «/» offer and
 * how a block on the sheet is called. A new block is one new file here and
 * a line in BLOCKS. The editor knows no sections: a block of a record is
 * only a record type (`ref:<type>`).
 */

/**
 * Groups of the palette; the colour of a group is the colour of its labels on
 * the sheet. `schema` — fields of the template's record (blocks/schema.ts);
 * `auto` — what the document gets by itself (number, day, author);
 * `structure` — the header, «Затверджую», signatures, rows, the footer.
 */
export type BlockGroup = 'text' | 'field' | 'data' | 'auto' | 'structure' | 'schema';

export type GroupDef = { key: BlockGroup; label: string };

export const BLOCK_GROUPS: GroupDef[] = [
  { key: 'text', label: 'Текст' },
  { key: 'field', label: 'Поля' },
  { key: 'data', label: 'Дані застосунку' },
  { key: 'auto', label: 'Авто' },
  { key: 'structure', label: 'Структура' },
];

/** One kind of a field's type («Ціле» / «Дробове»): the choice in «Властивості». */
export type Variant = { type: string; label: string };

type BlockBase = {
  key: string;
  group: BlockGroup;
  label: string;
  icon: IconName;
  /** In «/» besides the label. */
  words?: string[];
};

/** Template text: what it inserts; `nodes` — which nodes on the sheet are this block. */
export type TextBlock = BlockBase & { kind: 'text'; nodes: string[]; content: () => JSONContent };

/**
 * A field: a new field of `type` with a key `prefix<n>` and the block's label.
 * A `richtext` field is a free zone (a block); the rest — inline fields.
 */
export type FieldBlock = BlockBase & {
  kind: 'field';
  type: string;
  prefix: string;
  /** Under the name in «Властивості». */
  hint: string;
  variants?: Variant[];
  /** A field of the record: the new field is bound to it (its key, if free) and required as the record needs. */
  binding?: string;
  required?: boolean;
};

/** Filled by the document itself: an inline node of the shared description (editor/structure.ts draws it). */
export type AutoBlock = BlockBase & { kind: 'auto'; node: string };

export type Block = TextBlock | FieldBlock | AutoBlock;

export const BLOCKS: Block[] = [
  heading,
  paragraph,
  list,
  table,
  pageBreak,
  line,
  zone,
  number,
  date,
  choice,
  checkbox,
  ...RECORD_BLOCKS,
  autoNumber,
  autoDate,
  autoAuthor,
  autoRowNumber,
  orgHeader,
  approval,
  signatures,
  rows,
  pageFooter,
];

/** The auto block of a node on the sheet (`paperNumber`…); null — none. */
export function autoBlockOf(node: string): AutoBlock | null {
  return (BLOCKS.find((b) => b.kind === 'auto' && b.node === node) as AutoBlock | undefined) ?? null;
}

/** What the palette and «/» offer in a template: groups in order and their blocks. */
export type Palette = { groups: GroupDef[]; blocks: Block[] };

/** The block a node on the sheet is (a text node); null — not a text block. */
export function textBlockOf(node: string): TextBlock | null {
  return (BLOCKS.find((b) => b.kind === 'text' && b.nodes.includes(node)) as TextBlock | undefined) ?? null;
}

/** The block of a field's type: the one made for it, or the one it is a variant of. */
export function fieldBlockOf(type: string): FieldBlock | null {
  const fields = BLOCKS.filter((b): b is FieldBlock => b.kind === 'field');
  return fields.find((b) => b.type === type) ?? fields.find((b) => b.variants?.some((v) => v.type === type)) ?? null;
}

/** Blocks with a word of the label (or of `words`) starting with what is typed after «/». */
export function findBlocks(query: string, blocks: readonly Block[] = BLOCKS): Block[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...blocks];
  return blocks.filter((b) =>
    [b.label, ...(b.words ?? [])].some(
      (w) =>
        w.toLowerCase().startsWith(q) ||
        w
          .toLowerCase()
          .split(' ')
          .some((part) => part.startsWith(q)),
    ),
  );
}
