import { useState } from 'react';
import type { WidgetProps } from '.';

/** A number typed as text (comma or point); an invalid one is shown, not sent. */
export function NumberInput({ id, field, value, disabled, onChange, integer }: WidgetProps & { integer: boolean }) {
  const [raw, setRaw] = useState(typeof value === 'number' ? String(value).replace('.', ',') : '');
  const scale = field.scale ?? 2;
  const parse = (s: string): number | null | undefined => {
    const t = s.trim().replace(',', '.');
    if (t === '') return null;
    if (!/^-?\d+(\.\d+)?$/.test(t)) return undefined;
    const n = Number(t);
    if (integer ? !Number.isInteger(n) : Number(n.toFixed(scale)) !== n) return undefined;
    if ((field.min !== null && n < field.min) || (field.max !== null && n > field.max)) return undefined;
    return n;
  };
  const parsed = parse(raw);
  const bounds = [field.min !== null && `від ${field.min}`, field.max !== null && `до ${field.max}`].filter(Boolean).join(' ');
  return (
    <>
      <input
        id={id}
        type="text"
        inputMode={integer ? 'numeric' : 'decimal'}
        value={raw}
        disabled={disabled}
        aria-invalid={parsed === undefined}
        aria-describedby={parsed === undefined ? `${id}-error` : undefined}
        onChange={(e) => {
          setRaw(e.target.value);
          const n = parse(e.target.value);
          if (n !== undefined) onChange(n);
        }}
      />
      {parsed === undefined && (
        <span id={`${id}-error`} className="hint">
          {integer ? 'Ціле число' : `Число, до ${scale} знаків після коми`}
          {bounds && ` ${bounds}`}
        </span>
      )}
    </>
  );
}
