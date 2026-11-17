import { Node } from '@tiptap/core';
import { IMAGE_ALIGNS, IMAGE_WIDTHS, imageClass, imageUrl, RECORD_ID } from '../../../shared/editor-schema';

/**
 * «Зображення» (shared/editor-schema: `image`): a file of the API by its id,
 * a figure of a width of the text's and a side. Attributes are not rendered
 * one by one: the figure carries classes (no `style` — CSP), the picture its
 * address and description, as render.ts prints them.
 */
export const Image = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
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
});
