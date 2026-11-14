import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../api/client';
import type { ExtraFieldType, FieldDef } from '../api/types';

/** Queries of one record type (schema, extra fields): invalidate all at once. */
export const recordsKey = (type: string) => ['records', type] as const;

export const FIELD_TYPE_LABEL: Record<ExtraFieldType, string> = {
  text: 'Текст',
  int: 'Ціле число',
  decimal: 'Дробове число',
  date: 'Дата',
  bool: 'Так / ні',
  enum: 'Вибір з довідника',
  'list<enum>': 'Кілька з довідника',
};

/** Server defaults (api/src/records/extra-values.ts, EXTRA_LIMITS). */
export const FIELD_LIMITS = { textDefault: 200, textMax: 1000, itemsDefault: 10, itemsMax: 50, bound: 1e9 } as const;

/** Extra fields of a record type, archived too, in order. Every role reads them. */
export function useFieldDefs(type: string) {
  return useQuery({
    queryKey: [...recordsKey(type), 'field-defs'],
    queryFn: () => unwrap(api.GET('/api/records/{type}/field-defs', { params: { path: { type } } })),
    staleTime: 5 * 60_000,
  });
}

export const isChoice = (d: Pick<FieldDef, 'type'>) => d.type === 'enum' || d.type === 'list<enum>';

/** Item keys a choice field holds in a record: none, one or several. */
export function choiceKeys(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** The field that colours task cards: the first open «Вибір з довідника». */
export const stripeField = (defs: FieldDef[] | undefined) => defs?.find((d) => d.type === 'enum' && !d.archived);

/** Fields the board filters by: open choice fields. */
export const filterFields = (defs: FieldDef[] | undefined) => (defs ?? []).filter((d) => isChoice(d) && !d.archived);

/** Every chosen filter (field key → item key) is held by the record. */
export function matchesFilters(extra: Record<string, unknown>, filters: Record<string, string | null>): boolean {
  return Object.entries(filters).every(([key, item]) => item === null || choiceKeys(extra[key]).includes(item));
}

/** A value as a form keeps it: text inputs — string, checkbox — boolean, several items — list. */
export type FormValue = string | boolean | string[];

export function toForm(def: FieldDef, value: unknown): FormValue {
  switch (def.type) {
    case 'bool':
      return value === true;
    case 'list<enum>':
      return choiceKeys(value);
    default:
      return value === undefined || value === null ? '' : String(value);
  }
}

/** The value for the API; null — empty. An unchecked box is empty too. */
export function fromForm(def: FieldDef, v: FormValue): string | number | boolean | string[] | null {
  if (typeof v === 'boolean') return v || null;
  if (Array.isArray(v)) return v.length ? v : null;
  const text = v.trim();
  if (!text) return null;
  return def.type === 'int' || def.type === 'decimal' ? Number(text.replace(',', '.')) : text;
}

/** What is wrong with a form value, or null. The server checks again. */
export function fieldProblem(def: FieldDef, v: FormValue): string | null {
  const value = fromForm(def, v);
  if (value === null) return def.required ? `Заповніть поле «${def.label}».` : null;
  if (typeof value === 'number') {
    const ok =
      Number.isFinite(value) &&
      (def.type === 'decimal' ? Number(value.toFixed(2)) === value : Number.isInteger(value)) &&
      Math.abs(value) <= FIELD_LIMITS.bound &&
      (def.min === null || value >= def.min) &&
      (def.max === null || value <= def.max);
    if (!ok) return `«${def.label}»: ${numberRule(def)}.`;
  }
  if (Array.isArray(value) && value.length > (def.maxItems ?? FIELD_LIMITS.itemsDefault)) {
    return `«${def.label}»: не більше ${def.maxItems ?? FIELD_LIMITS.itemsDefault}.`;
  }
  return null;
}

function numberRule(def: FieldDef): string {
  const kind = def.type === 'int' ? 'ціле число' : 'число з двома знаками після коми';
  if (def.min !== null && def.max !== null) return `${kind} від ${def.min} до ${def.max}`;
  if (def.min !== null) return `${kind}, не менше ${def.min}`;
  if (def.max !== null) return `${kind}, не більше ${def.max}`;
  return kind;
}

/**
 * Extra values to send. Creating: the filled ones. Editing: only what changed
 * (null clears); archived fields are left as they are.
 */
export function extraBody(defs: FieldDef[], form: Record<string, FormValue>, current?: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const def of defs) {
    if (def.archived || !(def.key in form)) continue;
    const value = fromForm(def, form[def.key]!);
    if (!current) {
      if (value !== null) out[def.key] = value;
    } else if (JSON.stringify(value) !== JSON.stringify(current[def.key] ?? null)) {
      out[def.key] = value;
    }
  }
  return out;
}
