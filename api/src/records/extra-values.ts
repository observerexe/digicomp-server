import { DATE_ONLY, type ExtraType, type FieldSchema } from './field-types';

/** Values of extra fields as stored in the record's `extra` jsonb. */
export type ExtraValue = string | number | boolean | string[];
export type Extra = Record<string, ExtraValue>;

/** Limits of extra fields: defaults and the most a field may allow. */
export const EXTRA_LIMITS = {
  textDefault: 200,
  textMax: 1000,
  itemsDefault: 10,
  itemsMax: 50,
  /** int, decimal: |value| and bounds. */
  bound: 1e9,
  /** decimal: digits after the point. */
  scale: 2,
  /** enum: length of a dictionary item key. */
  keyMax: 40,
} as const;

/** What a check needs to know about an extra field. */
export type ExtraDef = {
  key: string;
  label: string;
  type: ExtraType;
  required: boolean;
  dictionary: string | null;
  min: number | null;
  max: number | null;
  maxLength: number | null;
  maxItems: number | null;
  archived: boolean;
};

function inBounds(v: number, def: ExtraDef) {
  return (
    Math.abs(v) <= EXTRA_LIMITS.bound &&
    (def.min === null || v >= def.min) &&
    (def.max === null || v <= def.max)
  );
}

function isItemKey(v: unknown): v is string {
  return (
    typeof v === 'string' && v.length > 0 && v.length <= EXTRA_LIMITS.keyMax
  );
}

function isCalendarDate(v: string) {
  if (!DATE_ONLY.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * A value for one extra field, normalized: text trimmed. `null` — clear the
 * field (null or an empty list); `undefined` — the value is invalid.
 * Dictionary items are checked against the database separately.
 */
export function normalizeExtraValue(
  def: ExtraDef,
  value: unknown,
): ExtraValue | null | undefined {
  if (value === null) return null;
  switch (def.type) {
    case 'text': {
      if (typeof value !== 'string') return undefined;
      const text = value.trim();
      const max = def.maxLength ?? EXTRA_LIMITS.textDefault;
      return text.length > 0 && text.length <= max ? text : undefined;
    }
    case 'int':
      return Number.isInteger(value) && inBounds(value as number, def)
        ? (value as number)
        : undefined;
    case 'decimal':
      return typeof value === 'number' &&
        Number.isFinite(value) &&
        Number(value.toFixed(EXTRA_LIMITS.scale)) === value &&
        inBounds(value, def)
        ? value
        : undefined;
    case 'date':
      return typeof value === 'string' && isCalendarDate(value)
        ? value
        : undefined;
    case 'bool':
      return typeof value === 'boolean' ? value : undefined;
    case 'enum':
      return isItemKey(value) ? value : undefined;
    case 'list<enum>': {
      if (!Array.isArray(value)) return undefined;
      if (value.length === 0) return null;
      const max = def.maxItems ?? EXTRA_LIMITS.itemsDefault;
      return value.length <= max &&
        value.every(isItemKey) &&
        new Set(value).size === value.length
        ? (value as string[])
        : undefined;
    }
  }
}

export function sameExtraValue(a: ExtraValue | undefined, b: ExtraValue) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** An extra field as a field of the record schema. */
export function extraFieldSchema(def: ExtraDef): FieldSchema {
  const open = !def.archived;
  const f: FieldSchema = {
    key: def.key,
    label: def.label,
    type: def.type,
    source: 'extra',
  };
  if (def.required && open) f.required = true;
  else f.nullable = true;
  f.create = open;
  f.update = open;
  if (def.archived) f.archived = true;
  if (def.type === 'int' || def.type === 'decimal') {
    f.min = def.min ?? -EXTRA_LIMITS.bound;
    f.max = def.max ?? EXTRA_LIMITS.bound;
  }
  if (def.type === 'decimal') f.scale = EXTRA_LIMITS.scale;
  if (def.type === 'text') {
    f.minLength = 1;
    f.maxLength = def.maxLength ?? EXTRA_LIMITS.textDefault;
  }
  if (def.dictionary) f.dictionary = def.dictionary;
  if (def.type === 'list<enum>') {
    f.maxItems = def.maxItems ?? EXTRA_LIMITS.itemsDefault;
  }
  return f;
}
