import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { INDENT_STEP_MM } from '../../../shared/editor-schema';
import { PAGE } from './usePageStats';
import s from './Ruler.module.css';

/** Ticks every 5 mm across the sheet; centimetres numbered from the left margin. */
const TICKS = Array.from({ length: PAGE.width / 5 + 1 }, (_, i) => i * 5);
const HEIGHT = 7;

/**
 * The ruler over the sheet, in millimetres of the sheet (scales with it):
 * the margins are shaded, the marker shows the left indent of the paragraph with the cursor.
 */
export function Ruler({ editor }: { editor: Editor }) {
  const indent = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const { $from } = e.state.selection;
      for (let d = $from.depth; d > 0; d--) {
        const attrs = $from.node(d).attrs as { indent?: number };
        if (typeof attrs.indent === 'number') return attrs.indent;
      }
      return 0;
    },
  });
  const x = PAGE.left + indent * INDENT_STEP_MM;
  const right = PAGE.width - PAGE.right;

  return (
    <svg className={s.ruler} viewBox={`0 0 ${PAGE.width} ${HEIGHT}`} aria-hidden="true" data-indent={indent}>
      <rect className={s.margin} x={0} y={0} width={PAGE.width} height={HEIGHT} />
      <rect className={s.body} x={PAGE.left} y={0} width={right - PAGE.left} height={HEIGHT} />
      {TICKS.map((t) => {
        const fromMargin = t - PAGE.left;
        const cm = fromMargin % 10 === 0;
        return cm && fromMargin > 0 && t < right ? (
          <text key={t} className={s.label} x={t} y={4.6} textAnchor="middle">
            {fromMargin / 10}
          </text>
        ) : (
          <line key={t} className={s.tick} x1={t} x2={t} y1={cm ? 1.8 : 2.8} y2={cm ? 5.2 : 4.2} />
        );
      })}
      <path className={s.marker} d={`M${x - 1.6} ${HEIGHT} L${x + 1.6} ${HEIGHT} L${x} ${HEIGHT - 2.4} Z`} />
    </svg>
  );
}
