import { Extension, mergeAttributes, Node, type Editor } from '@tiptap/core';
import { Fragment, Slice, type Node as PMNode, type ResolvedPos } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * Template fields on the sheet (shared/editor-schema: `field`, `fieldZone`).
 * A field shows its value from the document's `values` (FieldsLook); a zone
 * holds the author's own text. In a document made from a template only zones
 * change (TemplateLock); the server checks the same.
 */

const keyAttr = {
  default: null,
  parseHTML: (el: HTMLElement) => el.getAttribute('data-field'),
  renderHTML: (attrs: Record<string, unknown>) => ({ 'data-field': attrs.key }),
};

/** How a field or a zone looks now: set from the panel (setFieldsLook). */
export type FieldLook = {
  /** On the sheet: the value, or the label when empty. */
  text: string;
  /**
   * A document: filled — light blue; missing — required and empty; empty; staff — a moderator fills it.
   * The constructor: field, data — a field and a record of the app, in the colours of their groups.
   */
  state: 'filled' | 'missing' | 'empty' | 'staff' | 'field' | 'data';
};
export type FieldsLook = { fields: Record<string, FieldLook>; zones: Record<string, { label: string; missing: boolean }>; active: string | null };

const EMPTY_LOOK: FieldsLook = { fields: {}, zones: {}, active: null };
const lookKey = new PluginKey<FieldsLook>('fieldsLook');

/** Classes of a field on the sheet (format.css). */
function fieldClass(look: FieldLook | undefined, active: boolean) {
  return ['paper-field', look ? `is-${look.state}` : '', active ? 'is-active' : ''].filter(Boolean).join(' ');
}

/** An inline field: the value is drawn by the node view, the HTML holds only the key. */
export const Field = Node.create({
  name: 'field',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return { key: keyAttr };
  },
  parseHTML() {
    return [{ tag: 'span.paper-field[data-field]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ class: 'paper-field' }, HTMLAttributes)];
  },
  addNodeView() {
    return ({ node, decorations }) => {
      const dom = document.createElement('span');
      dom.contentEditable = 'false';
      dom.dataset.field = node.attrs.key as string;
      const paint = (decos: readonly Decoration[]) => {
        const spec = decos.find((d) => (d.spec as { look?: unknown }).look !== undefined)?.spec as { look: FieldLook; active: boolean } | undefined;
        dom.textContent = spec?.look.text ?? '';
        dom.className = fieldClass(spec?.look, !!spec?.active);
      };
      paint(decorations as unknown as readonly Decoration[]);
      return {
        dom,
        update: (n: PMNode, decos: readonly Decoration[]) => {
          if (n.type.name !== 'field' || n.attrs.key !== node.attrs.key) return false;
          paint(decos);
          return true;
        },
        ignoreMutation: () => true,
      };
    };
  },
});

/** A free zone: the author's text inside a template. Isolating: editing never leaves it. */
export const FieldZone = Node.create({
  name: 'fieldZone',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,
  addAttributes() {
    return { key: keyAttr };
  },
  parseHTML() {
    return [{ tag: 'div.paper-zone[data-field]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ class: 'paper-zone' }, HTMLAttributes), 0];
  },
});

/** The values and states the sheet shows (no change of the document, not in the history). */
export function setFieldsLook(editor: Editor, look: FieldsLook) {
  editor.view.dispatch(editor.state.tr.setMeta(lookKey, look).setMeta('addToHistory', false));
}

/** Depth of the zone around the position; -1 — outside every zone. */
function zoneDepth($pos: ResolvedPos): number {
  for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type.name === 'fieldZone') return d;
  return -1;
}

/** Key of the zone the whole selection is in; null — outside or across zones. */
export function zoneAtSelection(state: EditorState): string | null {
  const { $from, $to } = state.selection;
  const d = zoneDepth($from);
  if (d < 0 || $to.pos > $from.end(d)) return null;
  return $from.node(d).attrs.key as string;
}

/** Paragraphs of text only, without formatting (a zone bound to a text field). */
function isPlain(zone: PMNode) {
  let plain = true;
  zone.forEach((block) => {
    if (block.type.name !== 'paragraph' || block.attrs.align || block.attrs.indent) plain = false;
    block.forEach((n) => {
      if (!(n.isText || n.type.name === 'hardBreak') || n.marks.length) plain = false;
    });
  });
  return plain;
}

function hasFields(zone: PMNode) {
  let found = false;
  zone.descendants((n) => {
    if (n.type.name === 'field' || n.type.name === 'fieldZone') found = true;
    return !found;
  });
  return found;
}

/** The range a step touches, in the document before it; null — the whole document. */
function stepRange(step: unknown): [number, number] | null {
  const s = step as { from?: number; to?: number; pos?: number };
  if (typeof s.from === 'number' && typeof s.to === 'number') return [s.from, s.to];
  if (typeof s.pos === 'number') return [s.pos, s.pos + 1];
  return null;
}

export type LockOptions = {
  /** Zones of plain text. */
  plain: ReadonlySet<string>;
  /** Zones the actor may not fill (a moderator fills them). */
  locked: ReadonlySet<string>;
};

/** Every step inside one zone the actor may fill; zones stay without fields, plain zones — plain. */
export function lockAllows(tr: Transaction, opts: LockOptions): boolean {
  if (!tr.docChanged) return true;
  for (let i = 0; i < tr.steps.length; i++) {
    const range = stepRange(tr.steps[i]);
    if (!range) return false;
    const doc = tr.docs[i]!;
    const $from = doc.resolve(range[0]);
    const d = zoneDepth($from);
    if (d < 0 || range[0] < $from.start(d) || range[1] > $from.end(d)) return false;
    if (opts.locked.has($from.node(d).attrs.key as string)) return false;
  }
  let ok = true;
  tr.doc.descendants((n) => {
    if (!ok) return false;
    if (n.type.name !== 'fieldZone') return true;
    if (hasFields(n) || (opts.plain.has(n.attrs.key as string) && !isPlain(n))) ok = false;
    return false;
  });
  return ok;
}

/** Fields and zones out of what is pasted (they belong to the template, not to the text). */
function withoutFields(content: Fragment): Fragment {
  const out: PMNode[] = [];
  content.forEach((n) => {
    if (n.type.name === 'field') return;
    if (n.type.name === 'fieldZone') withoutFields(n.content).forEach((c) => void out.push(c));
    else out.push(n.isText ? n : n.copy(withoutFields(n.content)));
  });
  return Fragment.from(out);
}

/** A field or a zone on the sheet: where it starts and ends. */
export type FieldTarget = { key: string; from: number; to: number; zone: boolean };

/** Fields and zones the actor fills, in the order of the sheet. */
export function fieldTargets(doc: PMNode, fillable: ReadonlySet<string>): FieldTarget[] {
  const out: FieldTarget[] = [];
  doc.descendants((n, pos) => {
    const zone = n.type.name === 'fieldZone';
    if ((zone || n.type.name === 'field') && fillable.has(n.attrs.key as string)) {
      out.push({ key: n.attrs.key as string, from: pos, to: pos + n.nodeSize, zone });
    }
    return !zone;
  });
  return out;
}

/** The field after (1) or before (-1) the cursor, past the one it is in; null — none. */
export function nextField(state: EditorState, dir: 1 | -1, fillable: ReadonlySet<string>): FieldTarget | null {
  const targets = fieldTargets(state.doc, fillable);
  const { selection } = state;
  const at = selection.from;
  const current = targets.find((t) => (t.zone ? t.from < at && at < t.to : selection instanceof NodeSelection && t.from === at));
  if (dir === 1) {
    const after = current ? current.to : at;
    return targets.find((t) => t.from >= after && t !== current) ?? null;
  }
  const before = current ? current.from : at;
  return targets.filter((t) => t.to <= before && t !== current).pop() ?? null;
}

/** In a list or a table Tab keeps its own meaning (indent, next cell). */
function inListOrTable(state: EditorState) {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if (['listItem', 'tableCell', 'tableHeader'].includes($from.node(d).type.name)) return true;
  }
  return false;
}

export type TemplateOptions = LockOptions & {
  /** Fields and zones the actor fills: Tab goes through them. */
  fillable: ReadonlySet<string>;
  onFieldClick: (key: string) => void;
};

/**
 * A document made from a template: only zones change; a plain zone takes a paste as
 * text; a click on a field — `onFieldClick` (the panel opens its input); Tab and
 * Shift+Tab go to the next and the previous field (a zone — the cursor in it, a
 * field — its input in the panel).
 */
export function templateExtension(opts: TemplateOptions) {
  const jump = (editor: Editor, dir: 1 | -1) => {
    if (inListOrTable(editor.state)) return false;
    const t = nextField(editor.state, dir, opts.fillable);
    if (!t) return false;
    const { state, view } = editor;
    const sel = t.zone ? TextSelection.near(state.doc.resolve(t.from + 1)) : NodeSelection.create(state.doc, t.from);
    view.dispatch(state.tr.setSelection(sel).scrollIntoView());
    if (!t.zone) opts.onFieldClick(t.key);
    return true;
  };
  return Extension.create({
    name: 'templateFields',
    addKeyboardShortcuts() {
      return {
        Tab: ({ editor }) => jump(editor, 1),
        'Shift-Tab': ({ editor }) => jump(editor, -1),
      };
    },
    addProseMirrorPlugins() {
      let cache: { doc: PMNode; look: FieldsLook; set: DecorationSet } | null = null;
      return [
        new Plugin<FieldsLook>({
          key: lookKey,
          state: {
            init: () => EMPTY_LOOK,
            apply: (tr, prev) => tr.getMeta(lookKey) ?? prev,
          },
          filterTransaction: (tr) => lockAllows(tr, opts),
          props: {
            decorations(state) {
              const look = lookKey.getState(state) ?? EMPTY_LOOK;
              if (cache?.doc === state.doc && cache.look === look) return cache.set;
              const decos: Decoration[] = [];
              state.doc.descendants((n, pos) => {
                const key = n.attrs.key as string;
                if (n.type.name === 'field') {
                  decos.push(Decoration.node(pos, pos + n.nodeSize, {}, { look: look.fields[key], active: look.active === key }));
                } else if (n.type.name === 'fieldZone') {
                  const z = look.zones[key];
                  const cls = ['is-zone', z?.missing ? 'is-missing' : '', look.active === key ? 'is-active' : '', opts.locked.has(key) ? 'is-staff' : ''];
                  decos.push(Decoration.node(pos, pos + n.nodeSize, { class: cls.filter(Boolean).join(' '), 'data-label': z?.label ?? '' }));
                }
                return true;
              });
              cache = { doc: state.doc, look, set: DecorationSet.create(state.doc, decos) };
              return cache.set;
            },
            handleClickOn(_view, _pos, node) {
              if (node.type.name === 'field') opts.onFieldClick(node.attrs.key as string);
              return false;
            },
            transformPasted(slice, view) {
              const zone = zoneAtSelection(view.state);
              if (zone === null) return slice;
              if (!opts.plain.has(zone)) return new Slice(withoutFields(slice.content), slice.openStart, slice.openEnd);
              const { schema } = view.state;
              const lines = slice.content.textBetween(0, slice.content.size, '\n', '\n').split('\n');
              const paragraphs = lines.map((l) => schema.nodes.paragraph!.create(null, l ? schema.text(l) : null));
              return new Slice(Fragment.from(paragraphs), 1, 1);
            },
          },
        }),
      ];
    },
  });
}

/** Where a field or a zone is on the sheet (to bring it into view). */
export function fieldPosition(editor: Editor, key: string): number | null {
  let at: number | null = null;
  editor.state.doc.descendants((n, pos) => {
    if (at !== null) return false;
    if ((n.type.name === 'field' || n.type.name === 'fieldZone') && n.attrs.key === key) at = pos;
    return true;
  });
  return at;
}

/** A line break inside a paragraph reads as a new line; other inline atoms (fields, «@») — as nothing. */
const leafText = (n: PMNode) => (n.type.name === 'hardBreak' ? '\n' : '');

/** Text of every zone, a line a paragraph: whether it is filled, and what the phone's form shows. */
export function zoneTexts(doc: PMNode): Record<string, string> {
  const out: Record<string, string> = {};
  doc.descendants((n) => {
    if (n.type.name !== 'fieldZone') return true;
    out[n.attrs.key as string] = n.content.textBetween(0, n.content.size, '\n', leafText);
    return false;
  });
  return out;
}

/**
 * A plain zone written from the phone's form: each line — a paragraph of the
 * zone. The same lock as typing on the sheet applies (a zone the actor may not fill stays).
 */
export function setZoneText(editor: Editor, key: string, text: string) {
  const pos = fieldPosition(editor, key);
  const { state } = editor;
  const zone = pos === null ? null : state.doc.nodeAt(pos);
  if (pos === null || zone?.type.name !== 'fieldZone') return;
  const { schema } = state;
  const paragraphs = text.split('\n').map((l) => schema.nodes.paragraph!.create(null, l ? schema.text(l) : null));
  editor.view.dispatch(state.tr.replaceWith(pos + 1, pos + zone.nodeSize - 1, paragraphs));
}
