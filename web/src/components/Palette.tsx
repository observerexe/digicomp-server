import type { PaletteColor } from '../api/types';
import { PALETTE } from '../lib/palette';
import s from './Palette.module.css';

/** A dictionary item as a coloured label. */
export function DictChip({ title, color }: { title: string; color: PaletteColor }) {
  return <span className={`${s.chip} pal-${color}`}>{title}</span>;
}

/** One of the 8 palette colours: round swatches, a radio group underneath. */
export function ColorPicker(props: { name: string; value: PaletteColor; onChange: (c: PaletteColor) => void; legend?: string }) {
  return (
    <fieldset className={s.picker}>
      <legend>{props.legend ?? 'Колір'}</legend>
      <div className={s.swatches}>
        {PALETTE.map((c) => (
          <label key={c.name} className={`${s.swatch} pal-${c.name}`} title={c.label}>
            <input
              type="radio"
              name={props.name}
              value={c.name}
              aria-label={c.label}
              checked={props.value === c.name}
              onChange={() => props.onChange(c.name)}
            />
            <span className={s.dot} />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
