import { useState } from 'react';
import { kyivParts, kyivToDate } from '../../lib/kyiv';
import type { FieldType, WidgetProps } from '.';
import s from './widgets.module.css';

/** Day and time in Kyiv; sent as a moment once both are given. */
function DateTime({ id, field, value, disabled, onChange }: WidgetProps) {
  const [parts, setParts] = useState(() => (typeof value === 'string' ? kyivParts(value) : { date: '', time: '' }));
  const set = (next: { date: string; time: string }) => {
    setParts(next);
    if (!next.date && !next.time) onChange(null);
    else if (next.date && next.time) onChange(kyivToDate(next.date, next.time).toISOString());
  };
  return (
    <span className={s.datetime}>
      <input id={id} type="date" value={parts.date} disabled={disabled} onChange={(e) => set({ ...parts, date: e.target.value })} />
      <input type="time" aria-label={`${field.label}: час`} value={parts.time} disabled={disabled} onChange={(e) => set({ ...parts, time: e.target.value })} />
    </span>
  );
}

export const datetime: FieldType = { Widget: DateTime };
