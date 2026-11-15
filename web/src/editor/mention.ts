import { mergeAttributes, Node } from '@tiptap/core';
import { PluginKey, type EditorState } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import type { RecordType } from '../api/types';
import { RECORD_MISSING } from '../../../shared/editor-schema/fields';
import { recordHref, type RecordView } from '../lib/records';

/**
 * «@» — a reference to a record in the text (shared/editor-schema: `mention`).
 * The node holds only type and id; the title is the record's own, as the
 * reader sees it (`record`). While typing after «@» the list of records
 * (MentionMenu) is shown by `suggest`.
 */

/** The list after «@»: what is typed, where to show it, what a choice does. */
export type MentionMenuState = {
  query: string;
  rect: DOMRect | null;
  pick: (r: RecordView) => void;
};

export type MentionSuggest = {
  /** «@» may refer here (a free document; a zone the actor fills, not plain text). */
  allow: (state: EditorState) => boolean;
  /** Show the list, or hide it (null). */
  show: (menu: MentionMenuState | null) => void;
  /** Keys while the list is open (arrows, Enter); true — handled. */
  key: (e: KeyboardEvent) => boolean;
};

export type MentionOptions = {
  /** The record as the reader sees it; null — not seen, or deleted. */
  record: (type: string, id: string) => RecordView | null;
  /** Without it «@» does nothing (a document only to read). */
  suggest: MentionSuggest | null;
};

const attr = (name: string) => ({
  default: null,
  parseHTML: (el: HTMLElement) => el.getAttribute(`data-ref-${name}`),
  renderHTML: (attrs: Record<string, unknown>) => ({ [`data-ref-${name}`]: attrs[name] }),
});

export const Mention = Node.create<MentionOptions>({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { record: () => null, suggest: null };
  },

  addAttributes() {
    return { type: attr('type'), id: attr('id') };
  },

  parseHTML() {
    return [{ tag: 'span.paper-ref[data-ref-type][data-ref-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ class: 'paper-ref' }, HTMLAttributes)];
  },

  renderText({ node }) {
    return this.options.record(node.attrs.type as string, node.attrs.id as string)?.title ?? RECORD_MISSING;
  },

  addNodeView() {
    return ({ node, editor }) => {
      const r = this.options.record(node.attrs.type as string, node.attrs.id as string);
      const href = r && recordHref(r.type, r.id, r.code);
      const dom = document.createElement(href ? 'a' : 'span');
      dom.className = r ? 'paper-ref' : 'paper-ref is-missing';
      dom.contentEditable = 'false';
      dom.textContent = r?.title ?? RECORD_MISSING;
      if (dom instanceof HTMLAnchorElement && href) {
        dom.href = href;
        dom.target = '_blank';
        dom.rel = 'noopener noreferrer';
        // While editing a click selects the reference; Ctrl+click opens the record.
        dom.addEventListener('click', (e) => {
          if (editor.isEditable && !(e.ctrlKey || e.metaKey)) e.preventDefault();
        });
        if (editor.isEditable) dom.title = 'Ctrl+клік — відкрити';
      }
      return { dom, ignoreMutation: () => true };
    };
  },

  addProseMirrorPlugins() {
    const suggest = this.options.suggest;
    if (!suggest) return [];
    return [
      Suggestion<RecordView, RecordView>({
        editor: this.editor,
        pluginKey: new PluginKey('mentionSuggest'),
        char: '@',
        allow: ({ state }) => suggest.allow(state),
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: 'mention', attrs: { type: props.type as RecordType, id: props.id } },
              { type: 'text', text: ' ' },
            ])
            .run();
        },
        render: () => {
          const open = (p: { query: string; clientRect?: (() => DOMRect | null) | null; command: (r: RecordView) => void }) =>
            suggest.show({ query: p.query, rect: p.clientRect?.() ?? null, pick: p.command });
          return {
            onStart: open,
            onUpdate: open,
            onExit: () => suggest.show(null),
            onKeyDown: ({ event }) => suggest.key(event),
          };
        },
      }),
    ];
  },
});
