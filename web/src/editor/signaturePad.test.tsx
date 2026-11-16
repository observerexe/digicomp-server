import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SIGN_LIMITS, strokesValid, type Strokes } from '../../../shared/editor-schema/signature';
import { addPoint, pointOnField, SignaturePad, startStroke } from './SignaturePad';

// jsdom has neither PointerEvent nor layout: pointer events as mouse ones, the field 300 × 100 at (10, 20).
class FakePointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'mouse';
  }
}

const BOX = { left: 10, top: 20, width: 300, height: 100 };

describe('Підпис: точки на полі', () => {
  it('екран → поле 1500 × 500: цілі числа, у межах поля', () => {
    expect(pointOnField(10, 20, BOX)).toEqual([0, 0]);
    expect(pointOnField(160, 70, BOX)).toEqual([750, 250]);
    expect(pointOnField(310.3, 120, BOX)).toEqual([1500, 500]);
    expect(pointOnField(-50, 500, BOX)).toEqual([0, 500]);
  });

  it('надто близькі точки відкидаються; ліміти не дають зламати підпис — сервер прийме намальоване', () => {
    const st: Strokes = [];
    expect(addPoint(st, [1, 1])).toBe(false); // штриха ще нема
    expect(startStroke(st, [0, 0])).toBe(true);
    expect(addPoint(st, [2, 2])).toBe(false);
    expect(addPoint(st, [10, 0])).toBe(true);
    expect(st).toEqual([[0, 0, 10, 0]]);

    const long: Strokes = [[0, 0]];
    for (let i = 1; i < 2000; i++) addPoint(long, [(i * 5) % 1500, i % 2 ? 0 : 400]);
    expect(long[0]!.length / 2).toBe(SIGN_LIMITS.strokePoints);
    expect(strokesValid(long)).toBe(true);

    const many: Strokes = [];
    for (let i = 0; i < 150; i++) startStroke(many, [i, i]);
    expect(many).toHaveLength(SIGN_LIMITS.strokes);
    expect(strokesValid(many)).toBe(true);
  });
});

describe('Підпис: вікно', () => {
  beforeEach(() => {
    vi.stubGlobal('PointerEvent', FakePointerEvent);
  });

  const open = (over: Partial<Parameters<typeof SignaturePad>[0]> = {}) => {
    const props = { lines: ['Затверджую', 'Роботу прийняв'], about: '№ ТЗ-2026-014', pending: false, error: null, onSign: vi.fn(), onClose: vi.fn(), ...over };
    render(<SignaturePad {...props} />);
    const field = screen.getByTestId('signature-field');
    field.getBoundingClientRect = () => DOMRect.fromRect({ x: BOX.left, y: BOX.top, width: BOX.width, height: BOX.height });
    return { ...props, field };
  };
  const draw = (field: HTMLElement, points: [number, number][], pointerId = 1) => {
    fireEvent.pointerDown(field, { clientX: points[0]![0], clientY: points[0]![1], pointerId, button: 0 });
    for (const [x, y] of points.slice(1)) fireEvent.pointerMove(field, { clientX: x, clientY: y, pointerId });
    fireEvent.pointerUp(field, { pointerId });
  };

  it('що підписується; намальоване видно тим самим шляхом, що й на аркуші; «Підписати» надсилає штрихи', async () => {
    const { field, onSign } = open();
    const dialog = screen.getByRole('dialog', { name: 'Підписати документ' });
    expect(dialog).toHaveAccessibleDescription('«Затверджую», «Роботу прийняв» · № ТЗ-2026-014. Підпис не можна зняти.');
    expect(dialog).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Підписати' })).toBeDisabled();
    expect(screen.getByText('Розпишіться тут пальцем, мишкою чи стилусом')).toBeInTheDocument();

    draw(field, [
      [10, 20],
      [40, 50],
      [70, 20],
    ]);
    draw(field, [[160, 70]]);
    expect(screen.queryByText('Розпишіться тут пальцем, мишкою чи стилусом')).not.toBeInTheDocument();
    expect(field.querySelector('path')!.getAttribute('d')).toBe('M0 0L150 150L300 0M750 250l0 0');
    await userEvent.click(screen.getByRole('button', { name: 'Підписати' }));
    expect(onSign).toHaveBeenCalledWith([
      [0, 0, 150, 150, 300, 0],
      [750, 250],
    ]);
  });

  it('другий палець і права кнопка мишки не малюють; «Очистити» — усе спочатку', async () => {
    const { field } = open();
    fireEvent.pointerDown(field, { clientX: 10, clientY: 20, pointerId: 1, button: 0 });
    fireEvent.pointerDown(field, { clientX: 100, clientY: 20, pointerId: 2, button: 0 });
    fireEvent.pointerMove(field, { clientX: 100, clientY: 80, pointerId: 2 });
    fireEvent.pointerMove(field, { clientX: 40, clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(field, { pointerId: 1 });
    fireEvent.pointerDown(field, { clientX: 200, clientY: 50, pointerId: 3, button: 2 });
    expect(field.querySelector('path')!.getAttribute('d')).toBe('M0 0L150 0');
    await userEvent.click(screen.getByRole('button', { name: 'Очистити' }));
    expect(field.querySelector('path')).toBeNull();
    expect(screen.getByRole('button', { name: 'Підписати' })).toBeDisabled();
  });

  it('Esc і «Скасувати» закривають; поки надсилається — ні; помилка — у вікні', async () => {
    const { onClose } = open();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Скасувати' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('надсилається: кнопки вимкнено, Esc не закриває; помилку видно', async () => {
    const { onClose, field } = open({ pending: true, error: 'Ви вже підписали цей документ.' });
    draw(field, [
      [10, 20],
      [40, 50],
    ]);
    expect(field.querySelector('path')).toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Скасувати' })).toBeDisabled();
    expect(screen.getByText('Ви вже підписали цей документ.')).toBeInTheDocument();
  });
});
