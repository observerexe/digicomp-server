import { Extension, type Editor, type JSONContent } from '@tiptap/core';
import { Fragment, Slice, type Node as PMNode, type ResolvedPos } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { insertPoint } from '@tiptap/pm/transform';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import Suggestion from '@tiptap/suggestion';
import { plural } from '../lib/format';
import { autoBlockOf, IMAGE_BLOCK, textBlockOf, type Block, type BlockGroup } from './blocks';
import { rowsContent } from './blocks/rows';
import { zoneAtSelection, type FieldLook } from './fields';
import type { Condition } from '../../../shared/editor-schema/fields';

/**
 * The template constructor on the sheet: every block (a node of the body's
 * top level) in a frame with its label, fields as `{Підпис}` (or `{key}`),
 * blocks put from the palette (a click, a drop) and from «/». A field never
 * goes into a free zone; what is pasted keeps only fields of this template.
 */

/** What a field shows on the sheet; set from the page (setBuilderLook). */
export type BuilderField = {
  /** On the sheet: `{Підпис}` or `{key}`. */
  text: string;
  state: FieldLook['state'];
  /** The label of its block: «Число · points → Бали». */
  tag: string;
  group: BlockGroup;
};

export type BuilderLook = {
  fields: Record<string, BuilderField>;
  /** A conditional block's condition in words: «у «Вид стягнення» обрано «Штраф»» (conditional.ts conditionWords). */
  condition?: (field: string, value: string) => string;
  /** An auto table's label: «Авто: журнал сеансів · Обладнання». */
  table?: (source: string, field: string) => string;
  /** false — a published version is shown: no hint under the last block, no «/». */
  editable: boolean;
};

const EMPTY: BuilderLook = { fields: {}, editable: true };
const lookKey = new PluginKey<BuilderLook>('builderLook');

/** The type of a block dragged from the palette (its key is the data). */
export const BLOCK_MIME = 'application/x-paper-block';

export function setBuilderLook(editor: Editor, look: BuilderLook) {
  editor.view.dispatch(editor.state.tr.setMeta(lookKey, look).setMeta('addToHistory', false));
}

/** Distinct keys of fields and zones inside a node (the node itself included). */
function keysIn(node: PMNode): string[] {
  const keys = new Set<string>();
  const visit = (n: PMNode) => {
    if (n.type.name === 'field' || n.type.name === 'fieldZone') keys.add(n.attrs.key as string);
  };
  visit(node);
  node.descendants((n) => {
    visit(n);
    return true;
  });
  return [...keys];
}

/** The first auto node (the number) inside a node. */
function autoIn(node: PMNode) {
  let found: string | null = null;
  node.descendants((n) => {
    if (!found && autoBlockOf(n.type.name)) found = n.type.name;
    return !found;
  });
  return found === null ? null : autoBlockOf(found);
}

/** What a block of the top level is: its label on the sheet and the colour of the label. */
export function blockTag(node: PMNode, look: BuilderLook): { label: string; group: BlockGroup } {
  if (node.type.name === 'repeat') {
    const n = keysIn(node).length;
    const tag = look.fields[node.attrs.key as string]?.tag ?? `Повторювані рядки · ${String(node.attrs.key)}`;
    return { label: `${tag} · ${n ? `${n} ${plural(n, ['стовпець', 'стовпці', 'стовпців'])}` : 'перетягніть поля в нижній рядок'}`, group: 'structure' };
  }
  if (node.type.name === 'autoTable') {
    const source = node.attrs.source as string;
    const field = node.attrs.field as string;
    return { label: look.table?.(source, field) ?? `Авто-таблиця · ${source} · ${field}`, group: 'auto' };
  }
  if (node.type.name === 'image') return { label: IMAGE_BLOCK.label, group: IMAGE_BLOCK.group };
  if (node.type.name === 'conditional') {
    const field = node.attrs.field as string;
    const value = node.attrs.value as string;
    return { label: `Умовний блок · якщо ${look.condition?.(field, value) ?? `«${field}» = «${value}»`}`, group: 'structure' };
  }
  const keys = keysIn(node);
  const one = keys.length === 1 && (node.type.name === 'fieldZone' || node.isTextblock) ? look.fields[keys[0]!] : undefined;
  if (one) return { label: one.tag, group: one.group };
  const block = textBlockOf(node.type.name);
  const base = block?.label ?? node.type.name;
  const auto = !keys.length && node.isTextblock ? autoIn(node) : null;
  if (auto) return { label: `Авто: ${auto.label.toLowerCase()}`, group: 'auto' };
  if (!keys.length) return { label: base, group: block?.group ?? 'text' };
  return { label: `${base} · ${keys.length} ${plural(keys.length, ['поле', 'поля', 'полів'])}`, group: 'text' };
}

/** Depth of the zone around the position; -1 — outside every zone. */
function zoneDepth($pos: ResolvedPos): number {
  for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type.name === 'fieldZone') return d;
  return -1;
}

/**
 * A field or a zone inside a zone; a zone twice. «Повторювані рядки»: a field
 * or «№ рядка» in its header, a zone in it, a column also outside it;
 * «№ рядка» outside the row that repeats.
 */
export function badFields(doc: PMNode): boolean {
  const zones = new Set<string>();
  let bad = false;
  doc.descendants((n) => {
    if (bad || n.type.name !== 'fieldZone') return !bad;
    const key = n.attrs.key as string;
    if (zones.has(key) || keysIn(n).length > 1) bad = true;
    zones.add(key);
    return false;
  });
  if (bad) return true;
  const columns = new Set<string>();
  const outside = new Set<string>();
  doc.forEach((top) => {
    if (top.type.name !== 'repeat') {
      keysIn(top).forEach((k) => outside.add(k));
      top.descendants((n) => {
        if (n.type.name === 'rowNumber') bad = true;
        return !bad;
      });
      return;
    }
    const table = top.firstChild;
    table?.forEach((row, _offset, i) => {
      const repeated = i === table.childCount - 1;
      row.descendants((n) => {
        const name = n.type.name;
        if (name === 'fieldZone' || (!repeated && (name === 'field' || name === 'rowNumber'))) bad = true;
        if (repeated && name === 'field') columns.add(n.attrs.key as string);
        return !bad;
      });
    });
  });
  return bad || [...columns].some((k) => outside.has(k));
}

/**
 * What is pasted: fields of this template stay (a field may be shown twice), others go;
 * a zone stays only as a move or when it is not on the sheet yet, otherwise it
 * becomes its text. Into a zone — text only.
 */
export function cleanPasted(content: Fragment, known: ReadonlySet<string>, zonesOnSheet: ReadonlySet<string>, opts: { moving: boolean; intoZone: boolean }): Fragment {
  const out: PMNode[] = [];
  content.forEach((n) => {
    const key = n.attrs.key as string | undefined;
    if (n.type.name === 'field') {
      if (!opts.intoZone && known.has(key!)) out.push(n);
      return;
    }
    if (n.type.name === 'fieldZone') {
      const inner = cleanPasted(n.content, known, zonesOnSheet, { ...opts, intoZone: true });
      if (!opts.intoZone && known.has(key!) && (opts.moving || !zonesOnSheet.has(key!))) out.push(n.copy(inner));
      else inner.forEach((c) => void out.push(c));
      return;
    }
    out.push(n.isText ? n : n.copy(cleanPasted(n.content, known, zonesOnSheet, opts)));
  });
  return Fragment.from(out);
}

function zoneKeys(doc: PMNode): Set<string> {
  const out = new Set<string>();
  doc.descendants((n) => {
    if (n.type.name === 'fieldZone') out.add(n.attrs.key as string);
    return n.type.name !== 'fieldZone';
  });
  return out;
}

/**
 * What a block puts on the sheet; `key` — of the new field (field blocks) or the id of the uploaded image
 * (the image block), `condition` — what a conditional block waits for.
 */
export function blockContent(block: Block, key: string | null, condition: Condition | null = null): { content: JSONContent; inline: boolean } {
  if (block.kind === 'text') return { content: block.content(), inline: false };
  if (block.kind === 'image') return { content: { type: 'image', attrs: { id: key } }, inline: false };
  if (block.kind === 'condition') return { content: { type: 'conditional', attrs: condition ?? undefined, content: [{ type: 'paragraph' }] }, inline: false };
  if (block.kind === 'auto') return { content: { type: block.node }, inline: true };
  if (block.kind === 'table') return { content: { type: 'autoTable', attrs: { source: block.source, field: key } }, inline: false };
  if (block.type === 'richtext') return { content: { type: 'fieldZone', attrs: { key }, content: [{ type: 'paragraph' }] }, inline: false };
  if (block.type === 'rows') return { content: rowsContent(key!), inline: false };
  return { content: { type: 'field', attrs: { key } }, inline: true };
}

/**
 * Puts a block in place of `range` (the typed «/…», or an empty range — the
 * cursor, the point of a drop). A field goes into the text there (outside a
 * zone; in a zone — after it); a block — in place of an empty paragraph or
 * after the paragraph. Then a field (an auto table) is selected, a block gets the cursor.
 */
export function placeBlock(editor: Editor, block: Block, key: string | null, range: { from: number; to: number }, condition: Condition | null = null): boolean {
  const { state, view } = editor;
  const { content, inline } = blockContent(block, key, condition);
  const node = state.schema.nodeFromJSON(content);
  const tr = state.tr.delete(range.from, range.to);
  const $pos = tr.doc.resolve(range.from);
  const zone = zoneDepth($pos);
  const isField = block.kind === 'field';
  let at: number;
  let placed: PMNode = node;
  if (inline && $pos.parent.inlineContent && !(isField && zone >= 0)) {
    tr.insert($pos.pos, node);
    at = $pos.pos;
  } else {
    if (inline) placed = state.schema.nodes.paragraph!.create(null, node);
    const after = isField && zone >= 0 ? $pos.after(zone) : $pos.parent.isTextblock ? $pos.after() : $pos.pos;
    const emptyParagraph = $pos.parent.type.name === 'paragraph' && $pos.parent.content.size === 0 && !(isField && zone >= 0);
    if (emptyParagraph) {
      at = $pos.before();
      tr.replaceWith(at, $pos.after(), placed);
    } else {
      const point = insertPoint(tr.doc, after, placed.type);
      if (point === null) return false;
      at = point;
      tr.insert(at, placed);
    }
  }
  if (isField && inline) {
    const fieldAt = placed === node ? at : at + 1;
    tr.setSelection(NodeSelection.create(tr.doc, fieldAt));
  } else if (block.kind === 'table' || block.kind === 'image') {
    // An auto table is selected: «Властивості» show where it takes its rows from; an image — the ribbon its width and side.
    tr.setSelection(NodeSelection.create(tr.doc, at));
  } else {
    tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)));
  }
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

const SIGNERS = ['leftSigner', 'rightSigner'] as const;

/** Signatures signed by the member of the field `from`: by `to` now (null — a line to sign by hand). */
function resign(tr: Transaction, from: string, to: string | null) {
  tr.doc.descendants((n, pos) => {
    if (n.type.name !== 'signatures') return n.type.name === 'doc';
    for (const side of SIGNERS) if (n.attrs[side] === from) tr.setNodeAttribute(pos, side, to);
    return false;
  });
}

/** Every field and zone of `from` gets the key `to`, signatures, auto tables and conditions too (not in the history: the key lives in the panel). */
export function renameField(editor: Editor, from: string, to: string) {
  const tr = editor.state.tr;
  editor.state.doc.descendants((n, pos) => {
    // An attribute step: the node stays (and stays selected).
    if (['field', 'fieldZone', 'repeat'].includes(n.type.name) && n.attrs.key === from) tr.setNodeAttribute(pos, 'key', to);
    if ((n.type.name === 'autoTable' || n.type.name === 'conditional') && n.attrs.field === from) tr.setNodeAttribute(pos, 'field', to);
    return true;
  });
  resign(tr, from, to);
  if (tr.docChanged) editor.view.dispatch(tr.setMeta('addToHistory', false));
}

/** Changes attributes of the block of the top level at `index` (signatures, the footer, an auto table's field). */
export function setBlockAttrs(editor: Editor, index: number, attrs: Record<string, unknown>) {
  const { doc } = editor.state;
  if (index < 0 || index >= doc.childCount) return;
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  const node = doc.child(index);
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }));
}

/**
 * Takes a field off the sheet: a paragraph holding only it — with the paragraph;
 * rows — the whole block; auto tables of it — too (they show nothing without
 * it); signatures by it — a line to sign by hand; conditional blocks waiting
 * for it give way to what they hold.
 */
export function removeField(editor: Editor, key: string) {
  const { state } = editor;
  const ranges: [number, number][] = [];
  const unwrap: number[] = [];
  state.doc.forEach((n, pos) => {
    if (n.type.name === 'conditional' && n.attrs.field === key) unwrap.push(pos);
  });
  state.doc.descendants((n, pos) => {
    if (n.type.name === 'autoTable' && n.attrs.field === key) {
      ranges.push([pos, pos + n.nodeSize]);
      return false;
    }
    if (!['field', 'fieldZone', 'repeat'].includes(n.type.name) || n.attrs.key !== key) return true;
    const $pos = state.doc.resolve(pos);
    const alone = n.type.name === 'field' && $pos.parent.childCount === 1 && $pos.depth > 0 && $pos.parent.type.name === 'paragraph';
    ranges.push(alone ? [$pos.before(), $pos.after()] : [pos, pos + n.nodeSize]);
    return false;
  });
  const tr = state.tr;
  for (const [from, to] of ranges.reverse()) tr.delete(from, to);
  for (const pos of unwrap.reverse()) {
    const at = tr.mapping.map(pos);
    const n = tr.doc.nodeAt(at);
    if (n?.type.name === 'conditional') tr.replaceWith(at, at + n.nodeSize, n.content.size ? n.content : state.schema.nodes.paragraph!.create());
  }
  resign(tr, key, null);
  if (tr.docChanged) editor.view.dispatch(tr);
}

/** «Прибрати умову»: the conditional block at `index` gives way to what it holds. */
export function unwrapBlock(editor: Editor, index: number) {
  const { doc } = editor.state;
  if (index < 0 || index >= doc.childCount || doc.child(index).type.name !== 'conditional') return;
  let from = 0;
  for (let i = 0; i < index; i++) from += doc.child(i).nodeSize;
  const node = doc.child(index);
  const tr = editor.state.tr.replaceWith(from, from + node.nodeSize, node.content);
  tr.setSelection(TextSelection.near(tr.doc.resolve(from + 1)));
  editor.view.dispatch(tr);
  editor.commands.focus();
}

/** Removes the block of the top level at `index`; the sheet is never left without a paragraph. */
export function removeBlock(editor: Editor, index: number) {
  const { doc } = editor.state;
  if (index < 0 || index >= doc.childCount) return;
  let from = 0;
  for (let i = 0; i < index; i++) from += doc.child(i).nodeSize;
  const to = from + doc.child(index).nodeSize;
  const tr = editor.state.tr;
  if (doc.childCount === 1) tr.replaceWith(from, to, editor.schema.nodes.paragraph!.create());
  else tr.delete(from, to);
  editor.view.dispatch(tr);
  editor.commands.focus();
}

/** The list after «/»: what is typed, where, what a choice does. */
export type BlockMenuState = { query: string; rect: DOMRect | null; pick: (b: Block) => void };

export type BuilderOptions = {
  /** Keys with settings: a pasted field of another template goes. */
  known: () => ReadonlySet<string>;
  /** A block from the palette or «/» at a place on the sheet. */
  onPlace: (block: string, range: { from: number; to: number }) => void;
  /** A click on «Перетягніть блок сюди…» under the last block. */
  onEnd: () => void;
  menu: { show: (m: BlockMenuState | null) => void; key: (e: KeyboardEvent) => boolean };
};

/** The hint under the last block: a drop or «/» there puts a block at the end. */
function endHint(onEnd: () => void) {
  const dom = document.createElement('div');
  dom.className = 'paper-end';
  dom.contentEditable = 'false';
  dom.textContent = 'Перетягніть блок сюди або натисніть «/»';
  dom.addEventListener('mousedown', (e) => {
    e.preventDefault();
    onEnd();
  });
  return dom;
}

export function builderExtension(opts: BuilderOptions) {
  return Extension.create({
    name: 'templateBuilder',
    addProseMirrorPlugins() {
      let cache: { doc: PMNode; look: BuilderLook; sel: EditorState['selection']; set: DecorationSet } | null = null;
      const editor = this.editor;
      return [
        new Plugin<BuilderLook>({
          key: lookKey,
          state: {
            init: () => EMPTY,
            apply: (tr, prev) => (tr.getMeta(lookKey) as BuilderLook | undefined) ?? prev,
          },
          filterTransaction: (tr: Transaction) => !tr.docChanged || !badFields(tr.doc),
          props: {
            decorations(state) {
              const look = lookKey.getState(state) ?? EMPTY;
              if (cache?.doc === state.doc && cache.look === look && cache.sel.eq(state.selection)) return cache.set;
              const decos: Decoration[] = [];
              const sel = state.selection;
              const active = sel.$from.index(0);
              state.doc.forEach((node, offset, i) => {
                const tag = blockTag(node, look);
                const cls = ['paper-block', `is-${tag.group}`, i === active && look.editable ? 'is-active' : ''].filter(Boolean).join(' ');
                decos.push(Decoration.node(offset, offset + node.nodeSize, { class: cls, 'data-label': tag.label }));
              });
              if (look.editable) decos.push(Decoration.widget(state.doc.content.size, () => endHint(opts.onEnd), { side: 1, key: 'end', ignoreSelection: true }));
              state.doc.descendants((n, pos, parent) => {
                const key = n.attrs.key as string;
                const f = look.fields[key];
                // Auto values and structure blocks: drawn by structure.ts (the constructor's names — SheetInfo.builder).
                if (n.type.name === 'field') {
                  const look1: FieldLook = { text: f?.text ?? `{${key}}`, state: f?.state ?? 'empty' };
                  decos.push(Decoration.node(pos, pos + n.nodeSize, {}, { look: look1, active: sel instanceof NodeSelection && sel.from === pos }));
                } else if (n.type.name === 'fieldZone' && parent !== state.doc) {
                  decos.push(Decoration.node(pos, pos + n.nodeSize, { class: 'is-zone', 'data-label': f?.tag ?? key }));
                } else if (n.type.name === 'repeat' && n.firstChild?.lastChild) {
                  // The row that repeats: marked, as the document draws it once a row.
                  const table = n.firstChild;
                  const last = table.lastChild!;
                  const at = pos + 2 + table.content.size - last.nodeSize;
                  decos.push(Decoration.node(at, at + last.nodeSize, { class: 'is-repeated' }));
                }
                return true;
              });
              cache = { doc: state.doc, look, sel: state.selection, set: DecorationSet.create(state.doc, decos) };
              return cache.set;
            },
            transformPasted(slice: Slice, view: EditorView) {
              const intoZone = zoneDepth(view.state.selection.$from) >= 0;
              const content = cleanPasted(slice.content, opts.known(), zoneKeys(view.state.doc), { moving: !!view.dragging?.move, intoZone });
              return content.eq(slice.content) ? slice : Slice.maxOpen(content);
            },
            handleDrop(view: EditorView, event: DragEvent) {
              const block = event.dataTransfer?.getData(BLOCK_MIME);
              if (!block) return false;
              event.preventDefault();
              const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.doc.content.size;
              opts.onPlace(block, { from: at, to: at });
              return true;
            },
          },
        }),
        Suggestion<Block, Block>({
          editor,
          pluginKey: new PluginKey('blockSuggest'),
          char: '/',
          allow: ({ state }) => (lookKey.getState(state) ?? EMPTY).editable,
          command: ({ range, props }) => opts.onPlace(props.key, range),
          render: () => {
            const open = (p: { query: string; clientRect?: (() => DOMRect | null) | null; command: (b: Block) => void }) =>
              opts.menu.show({ query: p.query, rect: p.clientRect?.() ?? null, pick: p.command });
            return {
              onStart: open,
              onUpdate: open,
              onExit: () => opts.menu.show(null),
              onKeyDown: ({ event }) => opts.menu.key(event),
            };
          },
        }),
      ];
    },
  });
}

/**
 * What the cursor is on: a field (`picked` — the field itself is selected, not
 * the text around it), a zone, a block holding one field; or a block of the top level.
 */
export type BuilderSelection =
  { kind: 'field'; key: string; picked: boolean } | { kind: 'block'; index: number; node: string; keys: string[]; attrs: Record<string, unknown> } | null;

export function selectionOf(state: EditorState): BuilderSelection {
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.node.type.name === 'field') return { kind: 'field', key: sel.node.attrs.key as string, picked: true };
  const zone = zoneAtSelection(state);
  if (zone !== null) return { kind: 'field', key: zone, picked: false };
  const index = sel.$from.index(0);
  if (index >= state.doc.childCount) return null;
  const node = state.doc.child(index);
  // Anywhere in «Повторювані рядки» but on a field: the block's own field.
  if (node.type.name === 'repeat') return { kind: 'field', key: node.attrs.key as string, picked: false };
  const keys = keysIn(node);
  if (keys.length === 1 && (node.isTextblock || node.type.name === 'fieldZone')) return { kind: 'field', key: keys[0]!, picked: false };
  return { kind: 'block', index, node: node.type.name, keys, attrs: node.attrs };
}

/** The cursor at the end of the sheet, in an empty paragraph (one is added if the last block is not). */
export function cursorAtEnd(editor: Editor) {
  const { state } = editor;
  const last = state.doc.lastChild;
  const tr = state.tr;
  if (!(last?.type.name === 'paragraph' && last.content.size === 0)) tr.insert(state.doc.content.size, state.schema.nodes.paragraph!.create());
  tr.setSelection(TextSelection.near(tr.doc.resolve(tr.doc.content.size - 1)));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
}

/** The place for a block from the palette: the selection (a field over a selected field — after it). */
export function selectionRange(state: EditorState): { from: number; to: number } {
  const sel = state.selection;
  if (sel instanceof NodeSelection) return { from: sel.to, to: sel.to };
  return { from: sel.from, to: sel.to };
}
