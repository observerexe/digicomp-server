import { fireEvent, within } from '@testing-library/react';
import { vi } from 'vitest';

/** jsdom has no PointerEvent: a mouse one with a pointer id. */
class FakePointerEvent extends MouseEvent {
  pointerId: number;
  pointerType = 'mouse';
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

/** Pointer events for the window of the signature (call before rendering). */
export const stubPointerEvents = () => vi.stubGlobal('PointerEvent', FakePointerEvent);

/** A short stroke in the window of the signature: on the field it is `[[10, 10, 20, 20]]`. */
export function drawSignature(dialog: HTMLElement) {
  const field = within(dialog).getByTestId('signature-field');
  field.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 300, height: 100 });
  fireEvent.pointerDown(field, { clientX: 2, clientY: 2, button: 0 });
  fireEvent.pointerMove(field, { clientX: 4, clientY: 4 });
  fireEvent.pointerUp(field, {});
}
