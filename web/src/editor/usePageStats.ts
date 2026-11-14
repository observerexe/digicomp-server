import type { Editor } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { useEditorState } from '@tiptap/react';
import { useEffect, useState } from 'react';

/** The A4 sheet and its margins, mm (ДСТУ 4163:2020). The CSS of the sheet uses the same numbers. */
export const PAGE = { width: 210, height: 297, top: 20, right: 10, bottom: 20, left: 30 } as const;
/** Height of the text on one sheet. */
const BODY = PAGE.height - PAGE.top - PAGE.bottom;

/** Words: letters and digits, with apostrophes and hyphens inside («обов'язково», «будь-який»). */
export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['’ʼ-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

const wordCache = new WeakMap<PmNode, number>();
function docWords(doc: PmNode): number {
  let n = wordCache.get(doc);
  if (n === undefined) {
    n = countWords(doc.textBetween(0, doc.content.size, ' ', ' '));
    wordCache.set(doc, n);
  }
  return n;
}

export type PageStats = { words: number; page: number; pages: number };

/**
 * Words and pages of the document. Pages are an estimate from the sheet on screen:
 * each part between page breaks takes as many sheets as its height needs. The print counts exactly.
 */
export function usePageStats(editor: Editor, zoom: number): PageStats {
  const words = useEditorState({ editor, selector: ({ editor: e }) => docWords(e.state.doc) });
  const [pages, setPages] = useState({ page: 1, pages: 1 });

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (editor.isDestroyed) return;
        const next = measurePages(editor);
        setPages((p) => (p.page === next.page && p.pages === next.pages ? p : next));
      });
    };
    measure();
    editor.on('update', measure);
    editor.on('selectionUpdate', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(editor.view.dom);
    void document.fonts?.ready.then(measure);
    return () => {
      cancelAnimationFrame(frame);
      editor.off('update', measure);
      editor.off('selectionUpdate', measure);
      observer?.disconnect();
    };
  }, [editor, zoom]);

  return { words, ...pages };
}

function measurePages(editor: Editor): { page: number; pages: number } {
  const dom = editor.view.dom;
  const breaks = [...dom.querySelectorAll('.page-break')].map((el) => el.getBoundingClientRect());
  const rect = dom.getBoundingClientRect();
  // Not laid out (or not an A4 sheet: the phone) — only the page breaks count.
  if (!rect.width || !window.matchMedia?.('(min-width: 900px)').matches) return { page: 1, pages: breaks.length + 1 };

  const mm = rect.width / PAGE.width;
  const body = BODY * mm;
  const top = rect.top + PAGE.top * mm;
  const end = dom.lastElementChild?.getBoundingClientRect().bottom ?? top;
  const starts = [top, ...breaks.map((b) => b.bottom)];
  const ends = [...breaks.map((b) => b.top), end];
  // A part a hair longer than a sheet (rounding) is still one sheet.
  const sheets = starts.map((s, i) => Math.max(1, Math.ceil((ends[i]! - s) / body - 0.01)));
  const pages = sheets.reduce((a, b) => a + b, 0);

  const caret = editor.view.coordsAtPos(editor.state.selection.head).top;
  let before = 0;
  for (let i = 0; i < starts.length; i++) {
    if (i === starts.length - 1 || caret < ends[i]!) {
      const inPart = Math.min(sheets[i]!, Math.max(1, Math.floor((caret - starts[i]!) / body) + 1));
      return { page: before + inPart, pages };
    }
    before += sheets[i]!;
  }
  return { page: 1, pages };
}
