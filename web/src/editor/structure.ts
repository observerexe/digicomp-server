import { Extension, mergeAttributes, Node, type Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { NODES, SIGNER_AUTHOR, type AutoTableData, type PaperNode } from '../../../shared/editor-schema';
import { autoTableInner, STRUCTURE_CLASS, structureInner, type PaperInfo } from '../../../shared/editor-schema/render';
import { lookView, type FieldLook } from './fields';

/**
 * What the sheet takes from outside the text: the header, «Затверджую» and
 * signatures (shared/editor-schema: `orgHeader`, `approval`, `signatures`,
 * `pageFooter`) and the auto values — number, day, author (`paperNumber`,
 * `paperDate`, `paperAuthor`). The HTML holds only the node and its
 * attributes; what it shows is drawn from SheetInfo (setSheetInfo), the same
 * way the print draws it (render.ts structureInner).
 */

export type SheetInfo = {
  paper: PaperInfo;
  /** The document's number; null — not published yet. */
  number: string | null;
  /** The template constructor: auto values by their names (`{Номер}`). */
  builder: boolean;
  /** «Авто-таблиця» of a source for a field: its rows (none yet — `rows: null`); null — nothing known of it. */
  table: (source: string, field: string) => AutoTableData | null;
  /** Under an auto table without rows yet (its field `field` is empty). */
  tableHint: (field: string) => string;
};

/** An auto value before the document is published. */
export const PENDING = 'з’явиться після публікації';

const EMPTY_INFO: SheetInfo = {
  paper: { institution: '', groupName: '', signerPosition: '', person: () => null, date: null, year: '' },
  number: null,
  builder: false,
  table: () => null,
  tableHint: () => '',
};

const sheetKey = new PluginKey<SheetInfo>('sheetInfo');

/** What the structure and the auto values show (no change of the document, not in the history). */
export function setSheetInfo(editor: Editor, info: SheetInfo) {
  editor.view.dispatch(editor.state.tr.setMeta(sheetKey, info).setMeta('addToHistory', false));
}

/** Auto values: in the constructor — their names; in a document — the value, or grey «з’явиться після публікації». */
const AUTO: Record<string, { name: string; value: (info: SheetInfo) => string | null }> = {
  paperNumber: { name: '{Номер}', value: (i) => i.number },
  paperDate: { name: '{Дата}', value: (i) => i.paper.date },
  paperAuthor: { name: '{Автор}', value: (i) => i.paper.person(SIGNER_AUTHOR) },
};

export function autoLook(node: string, info: SheetInfo): FieldLook {
  const auto = AUTO[node]!;
  if (info.builder) return { text: auto.name, state: 'auto' };
  const v = auto.value(info);
  return v === null ? { text: PENDING, state: 'auto' } : { text: v, state: 'fixed' };
}

const autoNode = (name: string, cls: string) =>
  Node.create({
    name,
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    draggable: false,
    parseHTML() {
      return [{ tag: `span.${cls}` }];
    },
    renderHTML() {
      return ['span', { class: cls }];
    },
    addNodeView() {
      return lookView(name, { text: PENDING, state: 'auto' }, () => null);
    },
  });

/** «Авто: номер»: given when the document is published, if the template has a prefix. */
export const PaperNumber = autoNode('paperNumber', 'paper-number');
/** «Авто: дата»: the day the document is published. */
export const PaperDate = autoNode('paperDate', 'paper-date');
/** «Авто: автор»: the document's author. */
export const PaperAuthor = autoNode('paperAuthor', 'paper-author');

/** A structure block drawn from SheetInfo: the editor's element holds what the print holds. */
function structureView(name: string) {
  return ({ node, decorations }: { node: PMNode; decorations: readonly unknown[] }) => {
    const dom = document.createElement('div');
    dom.className = STRUCTURE_CLASS[name]!;
    dom.contentEditable = 'false';
    const paint = (n: PMNode, decos: readonly Decoration[]) => {
      const info = (decos.find((d) => (d.spec as { sheet?: unknown }).sheet !== undefined)?.spec as { sheet: SheetInfo } | undefined)?.sheet ?? EMPTY_INFO;
      if (name === 'pageFooter') {
        dom.textContent = `Колонтитул: ${(n.attrs.text as string).trim() || '—'}`;
        return;
      }
      // The same HTML as the print (escaped there): a header without requisites — a hint.
      dom.innerHTML = structureInner(n.toJSON() as PaperNode, info.paper) ?? '<p class="paper-structure-empty">Шапка: заповніть «Реквізити» на панелі керування</p>';
    };
    paint(node, decorations as readonly Decoration[]);
    return {
      dom,
      update: (n: PMNode, decos: readonly Decoration[]) => {
        if (n.type.name !== name) return false;
        paint(n, decos);
        return true;
      },
      ignoreMutation: () => true,
    };
  };
}

const dataName = (attr: string) => `data-${attr.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/**
 * A text attribute as a data attribute; nothing when empty (as render.ts),
 * so an attribute missing from the HTML is `empty` ('' or null).
 */
const dataAttr = (node: string, attr: string, empty: '' | null) => ({
  default: NODES[node]!.attrs[attr]!.default,
  parseHTML: (el: HTMLElement) => el.getAttribute(dataName(attr)) ?? empty,
  renderHTML: (attrs: Record<string, unknown>) => {
    const v = attrs[attr] as string | null;
    return v === null || v === '' ? {} : { [dataName(attr)]: v };
  },
});

const structureNode = (name: string, attrs: Record<string, ReturnType<typeof dataAttr>> = {}) =>
  Node.create({
    name,
    group: 'structure',
    atom: true,
    selectable: true,
    draggable: false,
    addAttributes() {
      return attrs;
    },
    parseHTML() {
      return [{ tag: `div.${STRUCTURE_CLASS[name]!}` }];
    },
    renderHTML({ HTMLAttributes }) {
      return ['div', mergeAttributes({ class: STRUCTURE_CLASS[name] }, HTMLAttributes)];
    },
    addNodeView() {
      return structureView(name);
    },
  });

export const OrgHeader = structureNode('orgHeader');
export const Approval = structureNode('approval');
export const Signatures = structureNode('signatures', {
  leftLabel: dataAttr('signatures', 'leftLabel', ''),
  leftSigner: dataAttr('signatures', 'leftSigner', null),
  rightLabel: dataAttr('signatures', 'rightLabel', ''),
  rightSigner: dataAttr('signatures', 'rightSigner', null),
});
export const PageFooter = structureNode('pageFooter', { text: dataAttr('pageFooter', 'text', '') });

/**
 * «Авто-таблиця» (shared/editor-schema: `autoTable`): the rows SheetInfo
 * gives, drawn as the print draws them; its field empty — a hint under it.
 */
export const AutoTable = Node.create({
  name: 'autoTable',
  group: 'autoTable',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return { source: dataAttr('autoTable', 'source', null), field: dataAttr('autoTable', 'field', null) };
  },
  parseHTML() {
    return [{ tag: 'div.paper-table' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ class: 'paper-table' }, HTMLAttributes)];
  },
  addNodeView() {
    return ({ node, decorations }) => {
      const dom = document.createElement('div');
      dom.className = 'paper-table';
      dom.contentEditable = 'false';
      const paint = (n: PMNode, decos: readonly Decoration[]) => {
        const info = (decos.find((d) => (d.spec as { sheet?: unknown }).sheet !== undefined)?.spec as { sheet: SheetInfo } | undefined)?.sheet ?? EMPTY_INFO;
        const source = n.attrs.source as string;
        const field = n.attrs.field as string;
        const t = info.table(source, field);
        if (!t) {
          dom.innerHTML = '<p class="paper-structure-empty">Авто-таблиця: джерело недоступне</p>';
          return;
        }
        dom.innerHTML = autoTableInner(t);
        if (t.rows === null && !info.builder) {
          const hint = document.createElement('p');
          hint.className = 'paper-structure-empty';
          hint.textContent = info.tableHint(field);
          dom.append(hint);
        }
      };
      paint(node, decorations as readonly Decoration[]);
      return {
        dom,
        update: (n: PMNode, decos: readonly Decoration[]) => {
          if (n.type.name !== 'autoTable') return false;
          paint(n, decos);
          return true;
        },
        ignoreMutation: () => true,
      };
    };
  },
});

/** Nodes drawn from SheetInfo as a whole: the structure and auto tables. */
const STRUCTURE_NODES = new Set([...Object.keys(STRUCTURE_CLASS), 'autoTable']);

/** The sheet's outside data on its structure and auto values; an auto value selected — outlined. */
export const SheetLook = Extension.create({
  name: 'sheetInfo',
  addProseMirrorPlugins() {
    let cache: { doc: PMNode; info: SheetInfo; sel: unknown; set: DecorationSet } | null = null;
    return [
      new Plugin<SheetInfo>({
        key: sheetKey,
        state: {
          init: () => EMPTY_INFO,
          apply: (tr, prev) => (tr.getMeta(sheetKey) as SheetInfo | undefined) ?? prev,
        },
        props: {
          decorations(state) {
            const info = sheetKey.getState(state) ?? EMPTY_INFO;
            if (cache?.doc === state.doc && cache.info === info && cache.sel === state.selection) return cache.set;
            const sel = state.selection;
            const decos: Decoration[] = [];
            state.doc.descendants((n, pos) => {
              const name = n.type.name;
              if (AUTO[name]) {
                decos.push(Decoration.node(pos, pos + n.nodeSize, {}, { look: autoLook(name, info), active: sel instanceof NodeSelection && sel.from === pos }));
              } else if (STRUCTURE_NODES.has(name)) {
                decos.push(Decoration.node(pos, pos + n.nodeSize, {}, { sheet: info }));
                return false;
              }
              return true;
            });
            cache = { doc: state.doc, info, sel: state.selection, set: DecorationSet.create(state.doc, decos) };
            return cache.set;
          },
        },
      }),
    ];
  },
});
