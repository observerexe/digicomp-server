import { mergeAttributes, Node } from '@tiptap/core';
import { DOMSerializer, type Node as PMNode } from '@tiptap/pm/model';
import type { Decoration, EditorView } from '@tiptap/pm/view';
import { lookView, type FieldLook } from './fields';

/**
 * «Повторювані рядки» (shared/editor-schema: `repeat`, `rowNumber`): a table
 * on the top level whose last row repeats, once a row of a `rows` field. The
 * constructor edits the table as it is (the last row — the one that repeats);
 * a document draws the rows from the values (repeatView): the header as the
 * template has it, then the last row for each row, its fields — the cells.
 */

export const Repeat = Node.create({
  name: 'repeat',
  group: 'repeat',
  content: 'table',
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      key: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-field'),
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-field': attrs.key }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div.paper-rows[data-field]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ class: 'paper-rows' }, HTMLAttributes), 0];
  },
});

/** «№ рядка»: in the constructor — «№»; in a document — the row's number (repeatView). */
export const RowNumber = Node.create({
  name: 'rowNumber',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  parseHTML() {
    return [{ tag: 'span.paper-row-number' }];
  },
  renderHTML() {
    return ['span', { class: 'paper-row-number' }];
  },
  addNodeView() {
    return lookView('rowNumber', { text: '№', state: 'auto' }, () => null);
  },
});

/** What a block of rows shows: the cells of each row by the column's key; none — `empty` (labels) in one row. */
export type RowsLook = {
  rows: Record<string, FieldLook>[];
  empty: Record<string, FieldLook>;
  active: boolean;
};

/** A cell of «Повторювані рядки»: its row (from 0) and column. */
export type RowCell = { row: number; column: string };

/** Classes of a cell on the sheet (format.css), as a field has them. */
function cellClass(look: FieldLook | undefined) {
  return ['paper-field', look ? `is-${look.state}` : ''].filter(Boolean).join(' ');
}

/**
 * A document's block of rows: drawn from its decoration (`spec.rows`), never
 * edited on the sheet; a click on a cell — `open(key, cell)`, elsewhere on
 * the block — `open(key)` (the panel shows the rows).
 */
export function repeatView(open: (key: string, cell?: RowCell) => void) {
  return (node: PMNode, view: EditorView, _getPos: unknown, decorations: readonly Decoration[]) => {
    const dom = document.createElement('div');
    dom.contentEditable = 'false';
    const key = node.attrs.key as string;
    dom.dataset.field = key;
    const serializer = DOMSerializer.fromSchema(view.state.schema);
    let current = node;

    const paint = (n: PMNode, decos: readonly Decoration[]) => {
      current = n;
      const look = (decos.find((d) => (d.spec as { rows?: unknown }).rows !== undefined)?.spec as { rows: RowsLook } | undefined)?.rows;
      dom.className = ['paper-rows', 'is-filling', look?.active ? 'is-active' : ''].filter(Boolean).join(' ');
      const table = document.createElement('table');
      const body = document.createElement('tbody');
      table.append(body);
      const rows: PMNode[] = [];
      n.firstChild?.forEach((r) => void rows.push(r));
      const last = rows.pop();
      for (const r of rows) body.append(serializer.serializeNode(r));
      if (last) {
        const filled = look?.rows ?? [];
        const shown = filled.length ? filled : [look?.empty ?? {}];
        shown.forEach((cells, i) => {
          const tr = serializer.serializeNode(last) as HTMLElement;
          if (!filled.length) tr.classList.add('is-empty-row');
          tr.querySelectorAll<HTMLElement>('span.paper-field[data-field]').forEach((span) => {
            const cell = cells[span.dataset.field!];
            span.textContent = cell?.text ?? '';
            span.className = cellClass(cell);
            if (filled.length) span.dataset.row = String(i);
          });
          tr.querySelectorAll<HTMLElement>('span.paper-row-number').forEach((span) => {
            span.textContent = filled.length ? String(i + 1) : '';
          });
          body.append(tr);
        });
      }
      dom.replaceChildren(table);
    };
    paint(node, decorations);

    dom.addEventListener('click', (e) => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-row]');
      if (cell) open(key, { row: Number(cell.dataset.row), column: cell.dataset.field! });
      else open(key);
    });
    return {
      dom,
      update: (n: PMNode, decos: readonly Decoration[]) => {
        if (n.type !== current.type || n.attrs.key !== key) return false;
        paint(n, decos);
        return true;
      },
      ignoreMutation: () => true,
    };
  };
}
