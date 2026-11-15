import { PALETTE } from '../../lib/palette';
import type { FieldType } from '.';

/** A colour of the palette. */
export const color: FieldType = {
  Widget: ({ id, value, disabled, onChange }) => (
    <select id={id} value={typeof value === 'string' ? value : ''} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">—</option>
      {PALETTE.map((c) => (
        <option key={c.name} value={c.name}>
          {c.label}
        </option>
      ))}
    </select>
  ),
};
