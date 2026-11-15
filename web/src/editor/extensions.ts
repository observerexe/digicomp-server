import { Extension, Node, type CommandProps, type Extensions } from '@tiptap/core';
import { OrderedList } from '@tiptap/extension-list';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { TextStyle } from '@tiptap/extension-text-style';
import StarterKit from '@tiptap/starter-kit';
import {
  ALIGNS,
  COLORS,
  FONT_SIZES,
  FONTS,
  formatClass,
  HEADING_LEVELS,
  MAX_INDENT,
  type Align,
  type FontName,
  type FontSize,
  type TextColor,
} from '../../../shared/editor-schema';
import { Field, FieldZone, templateExtension, type LockOptions } from './fields';

/**
 * The editor's extensions, built to match shared/editor-schema exactly
 * (schema.test.ts compares them). Formatting is classes only: CSP forbids
 * the `style` attribute.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    format: {
      /** Text size, pt; null — the sheet's own. */
      setFontSize: (size: FontSize | null) => ReturnType;
      /** Text colour from the palette; null — black. */
      setTextColor: (color: TextColor | null) => ReturnType;
      /** Font; null — serif (Times New Roman). */
      setFont: (font: FontName | null) => ReturnType;
      /** Paragraph alignment; null — left. */
      setAlign: (align: Align | null) => ReturnType;
      /** Left indent one step (5 mm) in or out. */
      indent: () => ReturnType;
      outdent: () => ReturnType;
    };
    pageBreak: {
      setPageBreak: () => ReturnType;
    };
  }
}

const BLOCK_TYPES = ['paragraph', 'heading'];

/** The value of a format class on an element (`fs-14` → 14), or null. */
function fromClass<T>(el: HTMLElement, values: readonly T[], toClass: (v: T) => string): T | null {
  return values.find((v) => el.classList.contains(toClass(v))) ?? null;
}

const INDENTS = Array.from({ length: MAX_INDENT }, (_, i) => i + 1);

/** Attributes rendered as one class each; nothing when the value is the default. */
function classAttr<T>(values: readonly T[], toClass: (v: T) => string, name: string, empty: unknown = null) {
  return {
    default: empty,
    parseHTML: (el: HTMLElement) => fromClass(el, values, toClass) ?? empty,
    renderHTML: (attrs: Record<string, unknown>) => {
      const v = attrs[name] as T;
      return v === empty || v === null ? {} : { class: toClass(v) };
    },
  };
}

const Format = Extension.create({
  name: 'format',

  addGlobalAttributes() {
    return [
      {
        types: BLOCK_TYPES,
        attributes: {
          align: classAttr(ALIGNS, formatClass.align, 'align'),
          indent: classAttr(INDENTS, formatClass.indent, 'indent', 0),
        },
      },
      {
        types: ['textStyle'],
        attributes: {
          size: classAttr(FONT_SIZES, formatClass.size, 'size'),
          color: classAttr(COLORS, formatClass.color, 'color'),
          font: classAttr(FONTS, formatClass.font, 'font'),
        },
      },
    ];
  },

  addCommands() {
    const textStyle =
      (attrs: Record<string, unknown>) =>
      ({ chain }: CommandProps) =>
        chain().setMark('textStyle', attrs).removeEmptyTextStyle().run();
    const shiftIndent =
      (by: number) =>
      ({ tr, state, dispatch }: CommandProps) => {
        let changed = false;
        const { from, to } = state.selection;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (!BLOCK_TYPES.includes(node.type.name)) return true;
          const indent = Math.min(MAX_INDENT, Math.max(0, (node.attrs.indent as number) + by));
          if (indent !== node.attrs.indent) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent });
            changed = true;
          }
          return false;
        });
        if (changed && dispatch) dispatch(tr);
        return changed;
      };
    return {
      setFontSize: (size) => textStyle({ size }),
      setTextColor: (color) => textStyle({ color }),
      setFont: (font) => textStyle({ font }),
      setAlign:
        (align) =>
        ({ commands }) =>
          BLOCK_TYPES.map((type) => commands.updateAttributes(type, { align })).some(Boolean),
      indent: () => shiftIndent(1),
      outdent: () => shiftIndent(-1),
    };
  },
});

/** Page break: the print starts a new sheet here. */
const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div.page-break' }];
  },
  renderHTML() {
    return ['div', { class: 'page-break' }];
  },
  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    };
  },
});

/** Our spans carry format classes, not styles (TipTap's own parse needs `style`). */
const ClassTextStyle = TextStyle.extend({
  parseHTML() {
    const prefixes = ['fs-', 'tc-', 'ff-'];
    return [
      {
        tag: 'span',
        consuming: false,
        getAttrs: (el) => ([...(el as HTMLElement).classList].some((c) => prefixes.some((p) => c.startsWith(p))) ? {} : false),
      },
    ];
  },
});

/** Without the `type` attribute (list style): numbering is the sheet's. */
const PlainOrderedList = OrderedList.extend({
  addAttributes() {
    const { type: _type, ...rest } = (this.parent?.() ?? {}) as Record<string, object>;
    return rest;
  },
});

/** Cells without alignment: alignment is the paragraph's. Column widths stay null (no resizing). */
const withoutAlign = <T extends typeof TableCell | typeof TableHeader>(ext: T) =>
  ext.extend({
    addAttributes() {
      const { align: _align, ...rest } = (this.parent?.() ?? {}) as Record<string, object>;
      return rest;
    },
  });

/** Table without `style` on <table> and <col> (widths come from the sheet's CSS). */
const PlainTable = Table.extend({
  renderHTML({ HTMLAttributes }) {
    return ['table', HTMLAttributes, ['tbody', 0]];
  },
}).configure({ resizable: false, renderWrapper: false });

/** `template` — a document made from a template: fields drawn, text outside zones locked. */
export function paperExtensions(template?: LockOptions & { onFieldClick: (key: string) => void }): Extensions {
  return [
    StarterKit.configure({
      blockquote: false,
      code: false,
      codeBlock: false,
      horizontalRule: false,
      link: false,
      orderedList: false,
      heading: { levels: [...HEADING_LEVELS] },
    }),
    PlainOrderedList,
    ClassTextStyle,
    Format,
    PageBreak,
    PlainTable,
    TableRow,
    withoutAlign(TableCell),
    withoutAlign(TableHeader),
    Field,
    FieldZone,
    ...(template ? [templateExtension(template)] : []),
  ];
}
