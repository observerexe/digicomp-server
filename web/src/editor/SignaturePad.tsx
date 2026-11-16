import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { SIGN_HEIGHT, SIGN_LIMITS, SIGN_PEN, SIGN_WIDTH, strokesPath, type Strokes } from '../../../shared/editor-schema/signature';
import { ErrorMessage } from '../components/ui';
import s from './SignaturePad.module.css';

/** Points nearer than this to the last one (on the 1500 × 500 field) add nothing: a hand trembles. */
const MIN_GAP = 4;

/** A point of the screen on the field: whole numbers within it, as the server takes them. */
export function pointOnField(x: number, y: number, box: { left: number; top: number; width: number; height: number }): [number, number] {
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, Math.round(v)));
  return [clamp(((x - box.left) / box.width) * SIGN_WIDTH, SIGN_WIDTH), clamp(((y - box.top) / box.height) * SIGN_HEIGHT, SIGN_HEIGHT)];
}

const pointsOf = (strokes: Strokes) => strokes.reduce((n, st) => n + st.length / 2, 0);

/** A new stroke from a point; false — the limits are reached (what is drawn stays). */
export function startStroke(strokes: Strokes, [x, y]: [number, number]): boolean {
  if (strokes.length >= SIGN_LIMITS.strokes || pointsOf(strokes) >= SIGN_LIMITS.points) return false;
  strokes.push([x, y]);
  return true;
}

/** The point added to the last stroke; false — too near the last one, or the limits are reached. */
export function addPoint(strokes: Strokes, [x, y]: [number, number]): boolean {
  const st = strokes.at(-1);
  if (!st || st.length / 2 >= SIGN_LIMITS.strokePoints || pointsOf(strokes) >= SIGN_LIMITS.points) return false;
  if (Math.hypot(x - st[st.length - 2]!, y - st[st.length - 1]!) < MIN_GAP) return false;
  st.push(x, y);
  return true;
}

type Props = {
  /** What is signed: «Затверджую», «Роботу прийняв», … */
  lines: string[];
  /** The document: «№ ТЗ-2026-014, версія 1». */
  about: string;
  pending: boolean;
  error: string | null;
  onSign: (strokes: Strokes) => void;
  onClose: () => void;
};

/**
 * A signature drawn with a finger, a mouse or a stylus, on a field of the
 * line's proportions (3 : 1), drawn each time (nothing is kept). Over the
 * page; on a phone — the whole screen. The drawing is the strokes the
 * server takes, shown as the sheet shows them (the same path and pen).
 */
export function SignaturePad({ lines, about, pending, error, onSign, onClose }: Props) {
  const titleId = useId();
  const textId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const strokes = useRef<Strokes>([]);
  // The pointer drawing now (another finger meanwhile draws nothing).
  const drawing = useRef<number | null>(null);
  const [path, setPath] = useState('');

  // Focus inside while open; back where it was once closed.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => before?.focus();
  }, []);

  const redraw = () => setPath(strokesPath(strokes.current));
  const at = (e: PointerEvent<HTMLElement>) => pointOnField(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());

  const down = (e: PointerEvent<HTMLElement>) => {
    if (pending || drawing.current !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    if (!startStroke(strokes.current, at(e))) return;
    drawing.current = e.pointerId;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    redraw();
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    if (drawing.current !== e.pointerId) return;
    // A fast hand: the points the browser joined into one event.
    const all = e.nativeEvent.getCoalescedEvents?.() ?? [];
    const box = e.currentTarget.getBoundingClientRect();
    let added = false;
    for (const p of all.length ? all : [e]) added = addPoint(strokes.current, pointOnField(p.clientX, p.clientY, box)) || added;
    if (added) redraw();
  };
  const up = (e: PointerEvent<HTMLElement>) => {
    if (drawing.current === e.pointerId) drawing.current = null;
  };
  const clear = () => {
    strokes.current = [];
    drawing.current = null;
    redraw();
  };

  // Esc closes; Tab stays within the window.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && !pending) {
      e.stopPropagation();
      onClose();
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>('button:not(:disabled)')];
    if (!items.length) return;
    const first = items[0]!;
    const last = items.at(-1)!;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const empty = path === '';
  return (
    <div className={s.backdrop}>
      <div ref={panel} className={s.panel} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={textId} tabIndex={-1} onKeyDown={onKeyDown}>
        <h2 id={titleId} className={s.title}>
          Підписати документ
        </h2>
        <p id={textId} className={s.text}>
          {lines.map((l) => `«${l}»`).join(', ')} · {about}. Підпис не можна зняти.
        </p>
        <div className={s.field} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} data-testid="signature-field">
          <svg viewBox={`0 0 ${SIGN_WIDTH} ${SIGN_HEIGHT}`} className={s.svg} role="img" aria-label={empty ? 'Поле для підпису' : 'Ваш підпис'}>
            <line x1={0} x2={SIGN_WIDTH} y1={SIGN_HEIGHT * 0.75} y2={SIGN_HEIGHT * 0.75} className={s.baseline} />
            {!empty && <path d={path} fill="none" stroke="currentColor" strokeWidth={SIGN_PEN} strokeLinecap="round" strokeLinejoin="round" />}
          </svg>
          {empty && <span className={s.placeholder}>Розпишіться тут пальцем, мишкою чи стилусом</span>}
        </div>
        <p className={s.turn}>Поверніть телефон — поле стане більшим.</p>
        <ErrorMessage text={error} />
        <div className={s.actions}>
          <button type="button" className="btn btn-ghost" disabled={empty || pending} onClick={clear}>
            Очистити
          </button>
          <span className={s.gap} />
          <button type="button" className="btn" disabled={pending} onClick={onClose}>
            Скасувати
          </button>
          <button type="button" className={`btn btn-primary ${s.sign}`} disabled={empty || pending} onClick={() => onSign(strokes.current.map((st) => [...st]))}>
            Підписати
          </button>
        </div>
      </div>
    </div>
  );
}
