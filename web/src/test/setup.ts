import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom has no blob URLs (avatar preview, recovery codes download).
URL.createObjectURL ??= () => 'blob:test';
URL.revokeObjectURL ??= () => undefined;

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.unstubAllGlobals();
});
