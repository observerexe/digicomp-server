/**
 * Record schemas: what fields a record type has, their types and limits.
 * The editor works only with these descriptions — it knows nothing about
 * tasks, points or equipment. Keys of record types are the same as `entity`
 * in the audit log.
 */
export const RECORD_TYPES = [
  'user',
  'task',
  'project',
  'place',
  'inventory_item',
  'discipline_record',
  'points_entry',
  'session',
  'fault',
  'place_authorization',
  'document',
  'paper',
] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export const SCALAR_TYPES = [
  'text',
  'richtext',
  'int',
  'decimal',
  'date',
  'datetime',
  'bool',
  'enum',
  'color',
] as const;
export type ScalarType = (typeof SCALAR_TYPES)[number];

export type ItemType = ScalarType | `ref:${RecordType}`;
/** `list<…>` holds scalars or references, never other lists. */
export type FieldType = ItemType | `list<${ItemType}>`;

/** One value of a fixed (code-defined) enum. */
export type EnumOption = { key: string; label: string };

/**
 * Where the value lives: a column of the record's table, a related table
 * (task assignees, project members), computed by the module, or the record's
 * `extra` jsonb (fields that staff add in «Налаштування полів»).
 */
export type FieldSource = 'column' | 'relation' | 'computed' | 'extra';

export interface FieldSchema {
  /** Same key as in the API (DTO and responses). */
  key: string;
  label: string;
  type: FieldType;
  /** Must be given when the record is created. */
  required?: boolean;
  /** May be empty (null). */
  nullable?: boolean;
  /** May be set when the record is created. */
  create?: boolean;
  /** May be changed later. */
  update?: boolean;
  /** int, decimal: inclusive bounds. */
  min?: number;
  max?: number;
  /** decimal: digits after the point. */
  scale?: number;
  /** text: length bounds (for a list — of each item). */
  minLength?: number;
  maxLength?: number;
  /** text: the whole value must match (JS regex source). */
  pattern?: string;
  /** list: at most this many items. */
  maxItems?: number;
  /** enum: fixed values from code… */
  options?: EnumOption[];
  /** …or item keys of this dictionary. */
  dictionary?: string;
  /** Default `column`. */
  source?: FieldSource;
  /** Extra field in the archive: old values stay, new ones are not taken. */
  archived?: boolean;
}

export interface RecordSchema {
  type: RecordType;
  label: string;
  /** Staff may add extra fields (stored in the record's `extra` jsonb). */
  extensible: boolean;
  fields: FieldSchema[];
}

/** Types an extra field may have: short descriptive values only. */
export const EXTRA_TYPES = [
  'text',
  'int',
  'decimal',
  'date',
  'bool',
  'enum',
  'list<enum>',
] as const satisfies readonly FieldType[];
export type ExtraType = (typeof EXTRA_TYPES)[number];

type Ctor = new (...args: never[]) => object;

/**
 * Server side of a schema: the entity and DTOs it describes (checked by
 * records/schemas.spec.ts). Never sent to clients.
 */
export interface RecordSchemaDef extends Omit<RecordSchema, 'extensible'> {
  /** The entity has an `extra` jsonb column and the DTOs take `extra`. */
  extensible?: boolean;
  entity: Ctor;
  dto?: {
    create?: Ctor;
    update?: Ctor;
    /** DTO properties deliberately left out of the schema (secrets). */
    hidden?: string[];
  };
}

/** Options of a TS string enum; every value must have a label. */
export function enumOptions<E extends string>(
  labels: Record<E, string>,
): EnumOption[] {
  return (Object.entries(labels) as [string, string][]).map(([key, label]) => ({
    key,
    label,
  }));
}

/** Calendar date YYYY-MM-DD, as in DTOs that take a date without time. */
export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
