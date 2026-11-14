import { getMetadataStorage } from 'class-validator';
import type { ValidationMetadata } from 'class-validator/types/metadata/ValidationMetadata';
import { getMetadataArgsStorage } from 'typeorm';
import { NOT_BLANK } from '../points/dto';
import {
  DATE_ONLY,
  FieldSchema,
  ItemType,
  RECORD_TYPES,
  RecordSchemaDef,
  SCALAR_TYPES,
} from './field-types';
import { recordSchema, SCHEMA_DEFS } from './records.registry';

// Схема описує те саме, що перевіряють DTO і що лежить у таблиці.
// Якщо змінили DTO чи сутність і забули схему (або навпаки) — тут червоне.

type Ctor = new (...args: never[]) => object;
type Metas = Map<string, ValidationMetadata[]>;

/** Validation metadata of a DTO, by property. */
function dtoMetas(dto: Ctor): Metas {
  const out: Metas = new Map();
  for (const m of getMetadataStorage().getTargetValidationMetadatas(
    dto,
    '',
    true,
    false,
  )) {
    out.set(m.propertyName, [...(out.get(m.propertyName) ?? []), m]);
  }
  return out;
}

function entityColumns(entity: Ctor): Set<string> {
  return new Set(
    getMetadataArgsStorage()
      .columns.filter((c) => c.target === entity)
      .map((c) => c.propertyName),
  );
}

const SCALARS = new Set<string>(SCALAR_TYPES);
const TYPES = new Set<string>(RECORD_TYPES);

/** Item type of a field (`list<x>` → x) and whether it is a list. */
function parseType(type: string): { item: ItemType; list: boolean } {
  const m = /^list<(.+)>$/.exec(type);
  return { item: (m ? m[1] : type) as ItemType, list: !!m };
}

function validType(type: string): boolean {
  const { item } = parseType(type);
  if (SCALARS.has(item)) return true;
  const ref = /^ref:(.+)$/.exec(item);
  return !!ref && TYPES.has(ref[1]);
}

/**
 * What the DTO validators of one property say, in schema terms.
 * Returns differences as readable strings (empty — consistent).
 */
function compare(field: FieldSchema, metas: ValidationMetadata[]): string[] {
  const { item, list } = parseType(field.type);
  const named = (name: string, each = list) =>
    metas.filter((m) => m.name === name && !!m.each === each);
  const one = (name: string, each = list) => named(name, each)[0];
  const constraint = (name: string, each = list) =>
    one(name, each)?.constraints?.[0] as unknown;
  const diffs: string[] = [];
  const expect = (what: string, actual: unknown, wanted: unknown) => {
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
      diffs.push(
        `${what}: DTO ${JSON.stringify(actual)}, схема ${JSON.stringify(wanted)}`,
      );
    }
  };
  const has = (name: string) => !!one(name);

  if (list) {
    expect('isArray', !!one('isArray', false), true);
    expect('maxItems', constraint('arrayMaxSize', false), field.maxItems);
  } else {
    expect('maxItems', undefined, field.maxItems);
  }

  const patterns = named('matches').map((m) => m.constraints[0] as RegExp);
  const notBlank = patterns.some((p) => p.source === NOT_BLANK.source);
  const pattern = patterns.find(
    (p) => p.source !== NOT_BLANK.source && p.source !== DATE_ONLY.source,
  );

  if (item === 'text' || item === 'richtext') {
    expect('рядок', has('isString') || has('isEmail') || !!pattern, true);
    expect('maxLength', constraint('maxLength'), field.maxLength);
    expect(
      'minLength',
      constraint('minLength') ?? (notBlank ? 1 : undefined),
      field.minLength,
    );
    expect('pattern', pattern?.source, field.pattern);
  } else if (item === 'int' || item === 'decimal') {
    if (item === 'int') expect('isInt', has('isInt'), true);
    else {
      const opts = constraint('isNumber') as
        { maxDecimalPlaces?: number } | undefined;
      expect('isNumber', !!opts, true);
      expect('scale', opts?.maxDecimalPlaces, field.scale);
    }
    expect('min', constraint('min'), field.min);
    expect('max', constraint('max'), field.max);
  } else if (item === 'date' || item === 'datetime') {
    expect('isDateString', has('isDateString'), true);
    const dateOnly = patterns.some((p) => p.source === DATE_ONLY.source);
    expect('лише дата (YYYY-MM-DD)', dateOnly, item === 'date');
  } else if (item === 'bool') {
    expect('isBoolean', has('isBoolean'), true);
  } else if (item === 'enum') {
    if (field.options) {
      const values =
        (one('isEnum')?.constraints?.[1] as string[] | undefined) ??
        (constraint('isIn') as string[] | undefined);
      expect(
        'значення',
        [...(values ?? [])].sort(),
        field.options.map((o) => o.key).sort(),
      );
    } else {
      expect('ключ пункту довідника (isString)', has('isString'), true);
    }
  } else if (item.startsWith('ref:')) {
    expect('isUuid', has('isUuid'), true);
  } else {
    diffs.push(`тип ${item} не має перевірки в DTO`);
  }

  // ValidateIf(v !== null) in a DTO = the value may be cleared.
  const clearable = metas.some(
    (m) => m.type === 'conditionalValidation' && m.name !== 'isOptional',
  );
  if (clearable && !field.nullable) diffs.push('DTO дозволяє null, схема — ні');
  return diffs;
}

describe('Схеми записів', () => {
  it('є схема для кожного типу запису, по одній', () => {
    expect(SCHEMA_DEFS.map((d) => d.type).sort()).toEqual(
      [...RECORD_TYPES].sort(),
    );
  });

  it('версія — стабільна й різна для різних схем', () => {
    const versions = RECORD_TYPES.map((t) => recordSchema(t).version);
    expect(new Set(versions).size).toBe(versions.length);
    expect(recordSchema('task').version).toMatch(/^[0-9a-f]{12}$/);
    expect(recordSchema('task').version).toBe(recordSchema('task').version);
  });

  it('клієнт не бачить сутностей і DTO', () => {
    const s = recordSchema('task') as unknown as Record<string, unknown>;
    expect(Object.keys(s).sort()).toEqual(
      ['fields', 'label', 'type', 'version'].sort(),
    );
  });

  it('невідомий тип — 404 RECORD_TYPE_NOT_FOUND', () => {
    expect(() => recordSchema('paper')).toThrow('Record type not found');
  });

  describe.each(SCHEMA_DEFS.map((d) => [d.type, d] as const))(
    '%s',
    (_type, def: RecordSchemaDef) => {
      const fields = def.fields;
      const byKey = new Map(fields.map((f) => [f.key, f]));

      it('ключі унікальні, типи й межі коректні', () => {
        expect(byKey.size).toBe(fields.length);
        for (const f of fields) {
          const ctx = `${def.type}.${f.key}`;
          expect([ctx, validType(f.type)]).toEqual([ctx, true]);
          const { item, list } = parseType(f.type);
          const isEnum = item === 'enum';
          expect([ctx, isEnum && !!f.options === !!f.dictionary]).toEqual([
            ctx,
            false,
          ]);
          if (!isEnum) {
            expect([ctx, f.options, f.dictionary]).toEqual([
              ctx,
              undefined,
              undefined,
            ]);
          }
          if (f.required) expect([ctx, f.create]).toEqual([ctx, true]);
          if (!list) expect([ctx, f.maxItems]).toEqual([ctx, undefined]);
          if (item !== 'decimal')
            expect([ctx, f.scale]).toEqual([ctx, undefined]);
          if (f.source === 'computed') {
            expect([ctx, !!(f.create || f.update)]).toEqual([ctx, false]);
          }
        }
      });

      it('поля з колонок — справжні колонки сутності', () => {
        const columns = entityColumns(def.entity);
        for (const f of fields) {
          const isColumn = (f.source ?? 'column') === 'column';
          expect([f.key, columns.has(f.key)]).toEqual([f.key, isColumn]);
        }
      });

      for (const kind of ['create', 'update'] as const) {
        it(`${kind}: поля збігаються з DTO`, () => {
          const dto = def.dto?.[kind];
          const metas = dto ? dtoMetas(dto) : new Map<string, never>();
          const hidden = new Set(def.dto?.hidden ?? []);
          const inDto = [...metas.keys()].filter((k) => !hidden.has(k)).sort();
          const inSchema = fields
            .filter((f) => f[kind])
            .map((f) => f.key)
            .sort();
          expect(inSchema).toEqual(inDto);

          for (const key of inDto) {
            const field = byKey.get(key)!;
            const m = metas.get(key)!;
            expect([key, compare(field, m)]).toEqual([key, []]);
            if (kind === 'create') {
              const optional = m.some((x) => x.name === 'isOptional');
              expect([key, 'required', !!field.required]).toEqual([
                key,
                'required',
                !optional,
              ]);
            }
          }
        });
      }
    },
  );
});
