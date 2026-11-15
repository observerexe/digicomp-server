import { useRef } from 'react';
import { FIELD_LIMITS, rowsIn, type FieldRow, type FieldValue } from '../../../../shared/editor-schema/fields';
import { cellControlId } from '../FieldsPanel';
import { fieldType, type FieldType, type WidgetProps } from '.';
import s from './widgets.module.css';

/**
 * «Повторювані рядки»: a card a row with its columns, «Додати рядок» for one
 * more, «×» to take a row away. A row just added stays (empty) until filled:
 * the publication drops rows left empty.
 */
function Rows({ id, field, value, disabled, onChange }: WidgetProps) {
  const rows = rowsIn(value);
  const columns = field.columns ?? [];
  const max = field.maxItems ?? FIELD_LIMITS.rowsDefault;
  // Keys of the cards: a row keeps its controls when one above it goes.
  const next = useRef(0);
  const keys = useRef<number[]>([]);
  while (keys.current.length < rows.length) keys.current.push(next.current++);
  keys.current.length = rows.length;

  const put = (list: FieldRow[]) => onChange(list.length ? list : null);
  const setCell = (i: number, column: string, v: FieldValue | null) =>
    put(
      rows.map((r, j) => {
        if (j !== i) return r;
        const { [column]: _old, ...rest } = r;
        return v === null ? rest : { ...rest, [column]: v as FieldRow[string] };
      }),
    );
  const remove = (i: number) => {
    keys.current.splice(i, 1);
    put(rows.filter((_, j) => j !== i));
  };
  const add = () => {
    put([...rows, {}]);
    // The new row's first cell: ready to type.
    const first = columns[0];
    if (first) requestAnimationFrame(() => document.getElementById(cellControlId(field.key, rows.length, first.key))?.focus());
  };

  return (
    <div id={id} tabIndex={-1} className={s.rows} role="group" aria-label={field.label}>
      {rows.length === 0 && <p className={s.rowsEmpty}>Рядків ще немає.</p>}
      {rows.map((r, i) => (
        <fieldset key={keys.current[i]} className={s.rowCard}>
          <legend>Рядок {i + 1}</legend>
          {!disabled && (
            <button type="button" className={`btn btn-ghost ${s.rowRemove}`} aria-label={`Прибрати рядок ${i + 1}`} onClick={() => remove(i)}>
              ×
            </button>
          )}
          {columns.map((c) => {
            const { Widget, group } = fieldType(c.type);
            const cellId = cellControlId(field.key, i, c.key);
            const label = (
              <>
                {c.label}
                {c.required && <span aria-hidden="true"> *</span>}
              </>
            );
            return (
              <div key={c.key} className={`field ${s.cell}`}>
                {group ? <span>{label}</span> : <label htmlFor={cellId}>{label}</label>}
                <Widget id={cellId} field={c} value={r[c.key]} disabled={disabled} onChange={(v) => setCell(i, c.key, v)} onJump={() => {}} />
              </div>
            );
          })}
        </fieldset>
      ))}
      {!disabled && (
        <button type="button" className={`btn btn-ghost ${s.add}`} disabled={rows.length >= max} onClick={add}>
          + Додати рядок
        </button>
      )}
    </div>
  );
}

export const rows: FieldType = { group: true, Widget: Rows };
