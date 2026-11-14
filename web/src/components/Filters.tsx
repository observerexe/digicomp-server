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

export type ChipOption = { value: string; label: string };

/** «Усі» + one chip per option; pressing the active chip again clears it. */
export function Chips({ label, options, value, onChange }: { label: string; options: ChipOption[]; value: string | null; onChange: (v: string | null) => void }) {
  if (options.length < 2) return null;
  return (
    <div className={s.chips} role="group" aria-label={label}>
      <button type="button" className={s.chip} aria-pressed={value === null} onClick={() => onChange(null)}>
        Усі
      </button>
      {options.map((o) => (
        <button key={o.value} type="button" className={s.chip} aria-pressed={value === o.value} onClick={() => onChange(value === o.value ? null : o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Distinct non-empty values as chips, sorted the Ukrainian way. */
export function distinct(values: string[]): ChipOption[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'uk')).map((v) => ({ value: v, label: v }));
}

export const norm = (v: string) => v.toLocaleLowerCase('uk-UA').trim();
