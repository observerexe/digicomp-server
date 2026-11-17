import { Node } from '@tiptap/core';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { IMAGE_ALIGNS, IMAGE_WIDTHS, imageClass, imageUrl, RECORD_ID } from '../../../shared/editor-schema';

/** Pictures a person pastes or drops on the sheet: the page uploads and inserts them (images.ts); `at` — the drop point. */
export type ImageFilesHandler = (files: File[], at: number | null) => void;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    image: {
      /**
       * An uploaded image at the selection (after a selected block: one more image
       * after an image) or at `at` (a drop); then it is selected — the ribbon shows its group.
       */
      insertImage: (id: string, at?: number) => ReturnType;
    };
  }
  interface Storage {
    image: { onFiles: ImageFilesHandler | null };
  }
}

/** Files of a paste or a drop that are pictures. */
function picturesOf(data: DataTransfer | null): File[] {
  return [...(data?.files ?? [])].filter((f) => f.type.startsWith('image/'));
}

/**
 * «Зображення» (shared/editor-schema: `image`): a file of the API by its id,
 * a figure of a width of the text's and a side. Attributes are not rendered
 * one by one: the figure carries classes (no `style` — CSP), the picture its
 * address and description, as render.ts prints them. Pictures pasted or
 * dropped on an editable sheet go to `storage.onFiles` (the page's upload).
 */
export const Image = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addStorage() {
    return { onFiles: null as ImageFilesHandler | null };
  },
  addAttributes() {
    return {
      id: { default: null, rendered: false },
      width: { default: 100, rendered: false },
      align: { default: null, rendered: false },
      alt: { default: '', rendered: false },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'figure.paper-image',
        getAttrs: (el) => {
          const img = el.querySelector('img');
          const id = /\/api\/paper-images\/([0-9a-f-]{36})$/.exec(img?.getAttribute('src') ?? '')?.[1];
          if (!id || !RECORD_ID.test(id)) return false;
          const width = IMAGE_WIDTHS.find((w) => el.classList.contains(`img-w-${w}`)) ?? 100;
          const align = IMAGE_ALIGNS.find((a) => el.classList.contains(`img-${a}`)) ?? null;
          return { id, width, align, alt: img?.getAttribute('alt') ?? '' };
        },
      },
    ];
  },
  renderHTML({ node }) {
    const id = node.attrs.id as string;
    return ['figure', { class: imageClass(node.attrs.width as number, node.attrs.align as string | null) }, ['img', { src: imageUrl(id), alt: node.attrs.alt as string }]];
  },
  addCommands() {
    return {
      insertImage:
        (id, at) =>
        ({ state, chain }) => {
          const node = { type: this.name, attrs: { id } };
          const { selection } = state;
          const put =
            at !== undefined
              ? chain().insertContentAt(Math.min(at, state.doc.content.size), node)
              : selection instanceof NodeSelection
                ? chain().insertContentAt(selection.to, node)
                : chain().insertContent(node);
          return put
            .command(({ tr }) => {
              // The image just put: its id is new, the last one with it is it.
              let found = -1;
              tr.doc.descendants((n, pos) => {
                if (n.type.name === this.name && n.attrs.id === id) found = pos;
              });
              if (found >= 0) tr.setSelection(NodeSelection.create(tr.doc, found));
              return true;
            })
            .run();
        },
    };
  },
  addProseMirrorPlugins() {
    const storage = this.storage;
    const hand = (files: File[], at: number | null) => {
      if (!files.length || !storage.onFiles) return false;
      storage.onFiles(files, at);
      return true;
    };
    return [
      new Plugin({
        key: new PluginKey('imageFiles'),
        props: {
          handlePaste: (view, event) => view.editable && hand(picturesOf(event.clipboardData), null),
          handleDrop: (view, event, _slice, moved) => {
            if (moved || !view.editable) return false;
            const files = picturesOf(event.dataTransfer);
            if (!files.length) return false;
            event.preventDefault();
            return hand(files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null);
          },
        },
      }),
    ];
  },
});
