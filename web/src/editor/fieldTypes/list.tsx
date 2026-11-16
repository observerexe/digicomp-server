import { useRef, useState } from 'react';
import { FIELD_LIMITS, itemType, type FieldValue } from '../../../../shared/editor-schema/fields';
import { PALETTE } from '../../lib/palette';
import { itemFieldType, type FieldType, type WidgetProps } from '.';
import { ManageList } from './ManageList';
import s from './widgets.module.css';

type Item = string | number | boolean;

/** Several choices: a box for each option; staff — a link to the dictionary. */
function Choices({ id, field, value, disabled, onChange }: WidgetProps) {
  const chosen = Array.isArray(value) ? (value as Item[]) : [];
  const options = field.type === 'list<color>' ? PALETTE.map((c) => ({ key: c.name as string, label: c.label, archived: false })) : (field.options ?? []);
  const max = field.maxItems ?? FIELD_LIMITS.itemsDefault;
  const toggle = (key: string, on: boolean) => {
    const next = on ? [...chosen, key] : chosen.filter((k) => k !== key);
    onChange(next.length ? next : null);
  };
  return (
    <span id={id} className={s.choices} role="group" aria-label={field.label}>
      {options
        .filter((o) => !o.archived || chosen.includes(o.key))
        .map((o) => {
          const on = chosen.includes(o.key);
          return (
            <label key={o.key}>
              <input type="checkbox" checked={on} disabled={disabled || (!on && chosen.length >= max)} onChange={(e) => toggle(o.key, e.target.checked)} />
              {o.label}
            </label>
          );
        })}
      <ManageList field={field} disabled={disabled} />
    </span>
  );
}

/** Several values of one type: a line each, «Додати» for one more. */
function Items(props: WidgetProps) {
  const { id, field, value, disabled, onChange } = props;
  const next = useRef(0);
  const row = (v: Item | null) => ({ k: next.current++, v });
  const [rows, setRows] = useState(() => (Array.isArray(value) && value.length ? (value as Item[]) : [null]).map(row));
  const Widget = itemFieldType(itemType(field.type) ?? 'text').Widget;
  const max = field.maxItems ?? FIELD_LIMITS.itemsDefault;
  const update = (list: { k: number; v: Item | null }[]) => {
    setRows(list);
    const filled = list.map((r) => r.v).filter((x): x is Item => x !== null);
    onChange(filled.length ? filled : null);
  };
  return (
    <span className={s.items} role="group" aria-label={field.label}>
      {rows.map((r, i) => (
        <span key={r.k} className={s.item}>
          <Widget
            {...props}
            id={i === 0 ? id : `${id}-${r.k}`}
            field={{ ...field, type: itemType(field.type) ?? 'text' }}
            value={r.v ?? undefined}
            taken={rows.filter((y) => y.k !== r.k && y.v !== null).map((y) => y.v)}
            onChange={(x: FieldValue | null) => update(rows.map((y) => (y.k === r.k ? { k: r.k, v: x as Item | null } : y)))}
          />
          {!disabled && rows.length > 1 && (
            <button type="button" className="btn btn-ghost" aria-label={`Прибрати ${i + 1}-й`} onClick={() => update(rows.filter((y) => y.k !== r.k))}>
              ×
            </button>
          )}
        </span>
      ))}
      {!disabled && rows.length < max && (
        <button type="button" className={`btn btn-ghost ${s.add}`} onClick={() => setRows([...rows, row(null)])}>
          Додати
        </button>
      )}
    </span>
  );
}

/** list<…>: choices for enum and colour, lines for the rest. */
export const list: FieldType = {
  group: true,
  Widget: (props) => {
    const item = itemType(props.field.type);
    return item === 'enum' || item === 'color' ? <Choices {...props} /> : <Items {...props} />;
  },
};
