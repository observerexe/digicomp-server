import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/policy';
import type { OkDto } from '../common/responses.dto';
import { Dictionary } from '../dictionaries/dictionary.entities';
import { activeItemKeys } from '../dictionaries/dictionary-usage';
import { uniqueKey } from '../dictionaries/keys';
import type {
  CreateFieldDefDto,
  ReorderFieldDefsDto,
  UpdateFieldDefDto,
} from './dto';
import {
  EXTRA_LIMITS,
  extraFieldSchema,
  normalizeExtraValue,
  sameExtraValue,
  type Extra,
  type ExtraDef,
  type ExtraValue,
} from './extra-values';
import type { RecordSchemaDef } from './field-types';
import { RecordFieldDef } from './record-field-def.entity';
import {
  publishSchema,
  schemaDef,
  type PublishedSchema,
} from './records.registry';
import type { FieldDefDto } from './responses.dto';

/** Messages mapped to stable errorCode in common/http-exception.filter.ts. */
export const FieldDefErrors = {
  Duplicate: 'Field def label already used',
  InUse: 'Field def is in use',
  InvalidExtra: 'Invalid extra field',
} as const;

/** 400 RECORD_EXTRA_INVALID with the key of the field, for the editor. */
function invalidExtra(field: string) {
  return new BadRequestException({
    message: FieldDefErrors.InvalidExtra,
    field,
  });
}

function extraDef(d: RecordFieldDef): ExtraDef {
  return {
    key: d.key,
    label: d.label,
    type: d.type,
    required: d.required,
    dictionary: d.dictionary,
    min: d.min,
    max: d.max,
    maxLength: d.maxLength,
    maxItems: d.maxItems,
    archived: d.archivedAt !== null,
  };
}

function view(d: RecordFieldDef): FieldDefDto {
  const { archived, ...rest } = extraDef(d);
  return { id: d.id, ...rest, position: d.position, archived };
}

type Options = Pick<
  RecordFieldDef,
  'type' | 'dictionary' | 'min' | 'max' | 'maxLength' | 'maxItems'
>;

/** Limits must suit the type: bounds for numbers, length for text… */
function assertOptions(o: Options) {
  const numeric = o.type === 'int' || o.type === 'decimal';
  const listed = o.type === 'enum' || o.type === 'list<enum>';
  const ok =
    listed === (o.dictionary !== null) &&
    (numeric || (o.min === null && o.max === null)) &&
    (o.type !== 'int' ||
      [o.min, o.max].every((v) => v === null || Number.isInteger(v))) &&
    (o.min === null || o.max === null || o.min <= o.max) &&
    (o.type === 'text') === (o.maxLength !== null) &&
    (o.type === 'list<enum>') === (o.maxItems !== null);
  if (!ok) throw new BadRequestException('Invalid field options');
}

/**
 * Extra fields of record types («Налаштування полів»): their descriptions
 * and the check of values in records' `extra`.
 */
@Injectable()
export class RecordFieldsService {
  constructor(
    @InjectDataSource() private ds: DataSource,
    private audit: AuditService,
  ) {}

  /** The record schema with the type's extra fields at the end. */
  async schema(type: string): Promise<PublishedSchema> {
    const def = schemaDef(type);
    const extra = def.extensible
      ? (await this.defsOf(this.ds.manager, def)).map((d) =>
          extraFieldSchema(extraDef(d)),
        )
      : [];
    return publishSchema(def, extra);
  }

  async list(type: string): Promise<FieldDefDto[]> {
    const def = this.extensible(type);
    return (await this.defsOf(this.ds.manager, def)).map(view);
  }

  create(
    type: string,
    dto: CreateFieldDefDto,
    actor: Actor,
  ): Promise<FieldDefDto> {
    const def = this.extensible(type);
    const label = dto.label.trim();
    return this.ds.transaction(async (m) => {
      const defs = await this.lockDefs(m, def);
      this.assertLabelFree(def, defs, label);
      const options: Options = {
        type: dto.type,
        dictionary: dto.dictionary ?? null,
        min: dto.min ?? null,
        max: dto.max ?? null,
        maxLength:
          dto.type === 'text'
            ? (dto.maxLength ?? EXTRA_LIMITS.textDefault)
            : (dto.maxLength ?? null),
        maxItems:
          dto.type === 'list<enum>'
            ? (dto.maxItems ?? EXTRA_LIMITS.itemsDefault)
            : (dto.maxItems ?? null),
      };
      assertOptions(options);
      if (
        options.dictionary &&
        !(await m.existsBy(Dictionary, { key: options.dictionary }))
      ) {
        throw new NotFoundException('Dictionary not found');
      }
      const taken = [...def.fields, ...defs].map((f) => f.key);
      const saved = await m.save(
        m.create(RecordFieldDef, {
          recordType: def.type,
          key: uniqueKey(label, taken),
          label,
          required: dto.required ?? false,
          ...options,
          position: defs.reduce((n, d) => Math.max(n, d.position + 1), 0),
          archivedAt: null,
        }),
      );
      await this.log(m, actor, 'record_field.created', saved, {
        type: saved.type,
        required: saved.required,
        dictionary: saved.dictionary,
      });
      return view(saved);
    });
  }

  update(
    type: string,
    key: string,
    dto: UpdateFieldDefDto,
    actor: Actor,
  ): Promise<FieldDefDto> {
    const def = this.extensible(type);
    return this.ds.transaction(async (m) => {
      const defs = await this.lockDefs(m, def);
      const f = this.find(defs, key);
      const changed: Record<string, unknown> = {};
      const set = <K extends 'label' | 'required' | 'min' | 'max'>(
        prop: K,
        value: RecordFieldDef[K] | undefined,
      ) => {
        if (value === undefined || value === f[prop]) return;
        changed[prop] = { from: f[prop], to: value };
        f[prop] = value;
      };
      const label = dto.label?.trim();
      if (label !== undefined && label !== f.label) {
        this.assertLabelFree(def, defs, label, f.id);
      }
      set('label', label);
      set('required', dto.required);
      set('min', dto.min);
      set('max', dto.max);
      // Limits that do not suit the type are rejected by assertOptions.
      for (const prop of ['maxLength', 'maxItems'] as const) {
        const value = dto[prop];
        if (value === undefined || value === f[prop]) continue;
        changed[prop] = { from: f[prop], to: value };
        f[prop] = value;
      }
      if (dto.archived !== undefined && dto.archived !== !!f.archivedAt) {
        changed.archived = dto.archived;
        f.archivedAt = dto.archived ? new Date() : null;
      }
      assertOptions(f);
      if (Object.keys(changed).length) {
        await m.save(f);
        await this.log(m, actor, 'record_field.updated', f, changed);
      }
      return view(f);
    });
  }

  reorder(
    type: string,
    dto: ReorderFieldDefsDto,
    actor: Actor,
  ): Promise<FieldDefDto[]> {
    const def = this.extensible(type);
    return this.ds.transaction(async (m) => {
      const defs = await this.lockDefs(m, def);
      const byKey = new Map(defs.map((d) => [d.key, d]));
      if (
        dto.keys.length !== defs.length ||
        new Set(dto.keys).size !== dto.keys.length ||
        dto.keys.some((k) => !byKey.has(k))
      ) {
        throw new BadRequestException('Order must list every field once');
      }
      dto.keys.forEach((k, position) => {
        byKey.get(k)!.position = position;
      });
      await m.save(defs);
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'record_field.reordered',
          entity: 'record_field_def',
          meta: { recordType: def.type, order: dto.keys },
        },
        m,
      );
      return dto.keys.map((k) => view(byKey.get(k)!));
    });
  }

  /** Only a field no record has a value in; otherwise — to the archive. */
  remove(type: string, key: string, actor: Actor): Promise<OkDto> {
    const def = this.extensible(type);
    return this.ds.transaction(async (m) => {
      const f = this.find(await this.lockDefs(m, def), key);
      const used = await m
        .getRepository(def.entity)
        .createQueryBuilder('r')
        .where('jsonb_exists(r.extra, :key)', { key })
        .getExists();
      if (used) throw new ConflictException(FieldDefErrors.InUse);
      await m.delete(RecordFieldDef, { id: f.id });
      await this.log(m, actor, 'record_field.deleted', f, {});
      return { ok: true };
    });
  }

  /**
   * Checks `input` (key → value, null clears) against the type's extra
   * fields and returns the record's new `extra` and what changed.
   * `current` — the record's `extra`, or null when the record is created
   * (then every required field must be given).
   */
  async applyExtra(
    m: EntityManager,
    type: string,
    input: Record<string, unknown> | undefined,
    current: Extra | null,
  ): Promise<{ extra: Extra; changed: Record<string, ExtraValue | null> }> {
    const defs = new Map(
      (await this.defsOf(m, this.extensible(type))).map((d) => [
        d.key,
        extraDef(d),
      ]),
    );
    const extra: Extra = { ...current };
    const changed: Record<string, ExtraValue | null> = {};
    for (const [key, raw] of Object.entries(input ?? {})) {
      const def = defs.get(key);
      if (!def) throw invalidExtra(key);
      const value = normalizeExtraValue(def, raw);
      if (value === undefined) throw invalidExtra(key);
      if (value === null) {
        if (def.required && !def.archived) throw invalidExtra(key);
        if (key in extra) {
          delete extra[key];
          changed[key] = null;
        }
        continue;
      }
      // Sending back an unchanged value is fine, even for an archived field.
      if (sameExtraValue(extra[key], value)) continue;
      if (def.archived) throw invalidExtra(key);
      if (def.dictionary) {
        await this.assertItems(m, def, value as string | string[], extra[key]);
      }
      extra[key] = value;
      changed[key] = value;
    }
    if (current === null) {
      for (const def of defs.values()) {
        if (def.required && !def.archived && !(def.key in extra)) {
          throw invalidExtra(def.key);
        }
      }
    }
    return { extra, changed };
  }

  /** Dictionaries some extra field takes its values from. */
  async usedDictionaries(m: EntityManager): Promise<string[]> {
    const rows = await m
      .createQueryBuilder(RecordFieldDef, 'f')
      .select('DISTINCT f.dictionary', 'dictionary')
      .where('f.dictionary IS NOT NULL')
      .getRawMany<{ dictionary: string }>();
    return rows.map((r) => r.dictionary);
  }

  /** How many records hold this dictionary item in an extra field. */
  async countItem(m: EntityManager, dictionary: string, item: string) {
    let n = 0;
    for (const f of await m.findBy(RecordFieldDef, { dictionary })) {
      // A jsonb array contains a string; a jsonb string contains itself.
      n += await m
        .getRepository(schemaDef(f.recordType).entity)
        .createQueryBuilder('r')
        .where('r.extra -> :key @> to_jsonb(CAST(:item AS text))', {
          key: f.key,
          item,
        })
        .getCount();
    }
    return n;
  }

  // --- helpers ---

  /** A new item in the value must be active; ones already there may stay. */
  private async assertItems(
    m: EntityManager,
    def: ExtraDef,
    value: string | string[],
    current: ExtraValue | undefined,
  ) {
    const had = new Set(
      Array.isArray(current) ? current : current ? [String(current)] : [],
    );
    const added = (Array.isArray(value) ? value : [value]).filter(
      (k) => !had.has(k),
    );
    const active = await activeItemKeys(m, def.dictionary!, added);
    if (added.some((k) => !active.has(k))) throw invalidExtra(def.key);
  }

  private extensible(type: string): RecordSchemaDef {
    const def = schemaDef(type);
    if (!def.extensible) throw new NotFoundException('Record type not found');
    return def;
  }

  private defsOf(m: EntityManager, def: RecordSchemaDef) {
    return m.find(RecordFieldDef, {
      where: { recordType: def.type },
      order: { position: 'ASC' },
    });
  }

  /** One change of a type's fields at a time: keys and labels stay unique. */
  private async lockDefs(m: EntityManager, def: RecordSchemaDef) {
    await m.query(`LOCK TABLE "record_field_defs" IN SHARE ROW EXCLUSIVE MODE`);
    return this.defsOf(m, def);
  }

  private find(defs: RecordFieldDef[], key: string) {
    const f = defs.find((d) => d.key === key);
    if (!f) throw new NotFoundException('Field def not found');
    return f;
  }

  /** Unique ignoring case, among extra and built-in fields of the type. */
  private assertLabelFree(
    def: RecordSchemaDef,
    defs: RecordFieldDef[],
    label: string,
    id?: string,
  ) {
    const lower = label.toLowerCase();
    if (
      def.fields.some((f) => f.label.toLowerCase() === lower) ||
      defs.some((d) => d.id !== id && d.label.toLowerCase() === lower)
    ) {
      throw new ConflictException(FieldDefErrors.Duplicate);
    }
  }

  private log(
    m: EntityManager,
    actor: Actor,
    action: string,
    f: RecordFieldDef,
    meta: Record<string, unknown>,
  ) {
    return this.audit.log(
      {
        actorId: actor.id,
        action,
        entity: 'record_field_def',
        entityId: f.id,
        meta: { recordType: f.recordType, key: f.key, label: f.label, ...meta },
      },
      m,
    );
  }
}
