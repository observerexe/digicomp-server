import type { FieldType } from '.';

/** Yes or no; «—» — not answered yet. */
export const bool: FieldType = {
  Widget: ({ id, value, disabled, onChange }) => (
    <select
      id={id}
      value={value === true ? 'yes' : value === false ? 'no' : ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'yes')}
    >
      <option value="">—</option>
      <option value="yes">Так</option>
      <option value="no">Ні</option>
    </select>
  ),
};
