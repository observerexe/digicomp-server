import type { FieldType } from '.';
import { ManageList } from './ManageList';
import s from './widgets.module.css';

/** One choice: active options; an archived one only where already chosen. Staff — a link to the dictionary. */
export const enumType: FieldType = {
  Widget: ({ id, field, value, disabled, onChange }) => {
    const current = typeof value === 'string' ? value : '';
    const options = (field.options ?? []).filter((o) => !o.archived || o.key === current);
    return (
      <span className={s.choice}>
        <select id={id} value={current} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">—</option>
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.archived ? `${o.label} (в архіві)` : o.label}
            </option>
          ))}
          {current && !options.some((o) => o.key === current) && <option value={current}>{current}</option>}
        </select>
        <ManageList field={field} disabled={disabled} />
      </span>
    );
  },
};
