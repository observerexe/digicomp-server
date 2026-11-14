import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom has no blob URLs (avatar preview, recovery codes download).
URL.createObjectURL ??= () => 'blob:test';
URL.revokeObjectURL ??= () => undefined;

// jsdom has no layout; ProseMirror asks for it on clicks and when scrolling to the cursor.
const noRect = () => new DOMRect(0, 0, 0, 0);
const noRects = () => Object.assign([] as DOMRect[], { item: () => null }) as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= noRect;
Range.prototype.getClientRects ??= noRects;
document.elementFromPoint ??= () => null;

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.unstubAllGlobals();
});
