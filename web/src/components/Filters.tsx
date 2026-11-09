import { Icon } from './Icon';
import s from './Filters.module.css';

export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className={s.search}>
      <Icon name="search" size={20} />
      <span className="visually-hidden">Пошук</span>
      <input type="search" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** «Усі» + one chip per value; pressing the active chip again clears it. */
export function Chips({ label, values, value, onChange }: { label: string; values: string[]; value: string | null; onChange: (v: string | null) => void }) {
  if (values.length < 2) return null;
  return (
    <div className={s.chips} role="group" aria-label={label}>
      <button type="button" className={s.chip} aria-pressed={value === null} onClick={() => onChange(null)}>
        Усі
      </button>
      {values.map((v) => (
        <button key={v} type="button" className={s.chip} aria-pressed={value === v} onClick={() => onChange(value === v ? null : v)}>
          {v}
        </button>
      ))}
    </div>
  );
}

/** Distinct non-empty values, sorted the Ukrainian way. */
export function distinct(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'uk'));
}

export const norm = (v: string) => v.toLocaleLowerCase('uk-UA').trim();
