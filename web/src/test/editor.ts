import { Editor, type EditorOptions } from '@tiptap/core';
import { afterEach } from 'vitest';
import { paperExtensions } from '../editor/extensions';

const open = new Set<Editor>();

// A live editor keeps its view, listeners and timers past the test; jsdom is torn down under them.
afterEach(() => {
  for (const editor of open) editor.destroy();
  open.clear();
});

/** An editor for a test (the document's extensions by default), destroyed after the test. */
export function testEditor(options: Partial<EditorOptions>): Editor {
  const editor = new Editor({ extensions: paperExtensions(), injectCSS: false, ...options });
  open.add(editor);
  return editor;
}
