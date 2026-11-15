import type { FieldType } from '.';

/** A calendar day, YYYY-MM-DD. */
export const date: FieldType = {
  Widget: ({ id, value, disabled, onChange }) => (
    <input id={id} type="date" value={typeof value === 'string' ? value : ''} disabled={disabled} onChange={(e) => onChange(e.target.value || null)} />
  ),
};
