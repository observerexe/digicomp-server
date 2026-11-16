import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { DictionaryItem } from '../dictionaries/dictionary.entities';
import type { PublishedSchema } from '../records/records.registry';
import {
  choicesOf,
  FIELD_LIMITS,
  hasFieldInsideZone,
  isFillable,
  isPlainZone,
  matchesBody,
  normalizeRow,
  normalizeValue,
  rowsIn,
  rowsOf,
  ROWS,
  sameNodes,
  signerField,
  walkNodes,
  zonesOf,
  zoneText,
  type FieldOption,
  type FieldSpec,
  type FieldValue,
  type FieldValues,
  type PaperContent,
  type PaperNode,
} from './content';
import { TemplateKind } from './template.entities';
import {
  isAutoBinding,
  type FieldFiller,
  type TemplateField,
} from './template-fields';

/** Messages mapped to stable errorCode in common/http-exception.filter.ts. */
export const PaperFieldErrors = {
  FieldInvalid: 'Invalid paper field',
  ContentLocked: 'Paper content is locked by its template',
  NeedsUpdate: 'Template needs update',
} as const;

/** PAPER_FIELD_INVALID with the field's key; `row` — the row of «Повторювані рядки» at fault. */
export function fieldInvalid(key: string, row?: number) {
  return new BadRequestException({
    message: PaperFieldErrors.FieldInvalid,
    field: key,
    ...(row === undefined ? {} : { row }),
  });
}

const locked = () => new BadRequestException(PaperFieldErrors.ContentLocked);

/** A field of a document's template, as the document fills it. */
export type PaperField = Omit<FieldSpec, 'columns'> & {
  label: string;
  required: boolean;
  fill: FieldFiller;
  editable: boolean;
  print: boolean;
  /** enum, list<enum>: the choices, archived ones included. */
  options: FieldOption[] | null;
  /** enum, list<enum>: key of the dictionary the choices come from; null — fixed choices or another type. */
  dictionary: string | null;
  /** richtext bound to a text field of the record: paragraphs without formatting. */
  plain: boolean;
  /** Key of the record's field it is bound to; null — not bound. */
  binding: string | null;
  /** Bound to what the record gets later (see isAutoBinding): nobody fills it. */
  auto: boolean;
  /**
   * rows: its columns (who fills, changes and prints them — as the rows);
   * null for other types.
   */
  columns: PaperField[] | null;
};

const tighter = (
  a: number | null,
  b: number | undefined,
  pick: (...v: number[]) => number,
) => (b === undefined ? a : a === null ? b : pick(a, b));

/**
 * Fields of a version with what the document needs to fill them: limits of
 * the bound field of the record (never wider), choices of `enum` from the
 * dictionary or the record's schema. Columns of «Повторювані рядки» (by the
 * body) are in their rows field only.
 */
export async function resolveFields(
  m: EntityManager,
  kind: TemplateKind,
  fields: TemplateField[],
  schema: PublishedSchema | null,
  body: PaperContent,
): Promise<PaperField[]> {
  const bound = new Map((schema?.fields ?? []).map((s) => [s.key, s]));
  const dictionaryOf = (f: TemplateField) =>
    f.dictionary ??
    (f.binding ? (bound.get(f.binding)?.dictionary ?? null) : null);
  const names = [
    ...new Set(fields.map(dictionaryOf).filter((d): d is string => !!d)),
  ];
  const items = new Map<string, FieldOption[]>();
  if (names.length) {
    const rows = await m
      .createQueryBuilder(DictionaryItem, 'i')
      .innerJoinAndSelect('i.dictionary', 'd')
      .where('d.key IN (:...names)', { names })
      .orderBy('i.position', 'ASC')
      .getMany();
    for (const i of rows) {
      const key = i.dictionary!.key;
      items.set(key, [
        ...(items.get(key) ?? []),
        {
          key: i.key,
          label: i.title,
          ...(i.archivedAt ? { archived: true } : {}),
        },
      ]);
    }
  }
  const flat = fields.map((f): PaperField => {
    const s = f.binding ? bound.get(f.binding) : undefined;
    const isEnum = f.type === 'enum' || f.type === 'list<enum>';
    const dictionary = dictionaryOf(f);
    return {
      key: f.key,
      label: f.label,
      type: f.type,
      required: f.required,
      fill: f.fill,
      editable: f.editable,
      print: f.print,
      min: tighter(f.min, s?.min, Math.max),
      max: tighter(f.max, s?.max, Math.min),
      maxLength: tighter(f.maxLength, s?.maxLength, Math.min),
      maxItems: tighter(f.maxItems, s?.maxItems, Math.min),
      scale: s?.scale ?? null,
      options: isEnum
        ? dictionary
          ? (items.get(dictionary) ?? [])
          : (s?.options ?? [])
        : null,
      dictionary: isEnum ? dictionary : null,
      plain: f.type === 'richtext' && f.binding !== null,
      binding: f.binding,
      auto: !!s && isAutoBinding(kind, s),
      columns: null,
    };
  });
  return withColumns(flat, rowsOf(body));
}

/**
 * «Рядок = запис»: the rows field whose columns are bound to the record —
 * each row not empty makes a record of its own; null — the document makes
 * one record of its fields.
 */
export function recordRows(fields: PaperField[]): PaperField | null {
  return (
    fields.find(
      (f) => f.type === ROWS && !!f.columns?.some((c) => c.binding !== null),
    ) ?? null
  );
}

/** A field as the response gives it: whether the actor fills it; columns — as their rows. */
export function fieldView<T extends PaperField>(
  f: T,
  canFill: boolean,
): Omit<T, 'columns'> & { canFill: boolean; columns: FieldView[] | null } {
  return {
    ...f,
    canFill,
    columns: f.columns?.map((c) => fieldView(c, canFill)) ?? null,
  };
}
export type FieldView = PaperField & {
  canFill: boolean;
  columns: FieldView[] | null;
};

/**
 * Columns into their rows fields: filled, changed and printed as the rows;
 * bound to the record only in «рядок = запис» (see recordRows).
 */
function withColumns(
  fields: PaperField[],
  rows: Map<string, string[]>,
): PaperField[] {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const inRows = new Set([...rows.values()].flat());
  return fields
    .filter((f) => !inRows.has(f.key))
    .map((f) => {
      if (f.type !== ROWS) return f;
      const columns = (rows.get(f.key) ?? []).flatMap((key) => {
        const c = byKey.get(key);
        return c
          ? [
              {
                ...c,
                fill: f.fill,
                editable: f.editable,
                print: f.print,
              },
            ]
          : [];
      });
      return { ...f, columns };
    });
}

/**
 * Where a value of rows is invalid: the first row that is not (-1 — the
 * value itself: not a list, too many rows).
 */
export function badRow(f: PaperField, raw: unknown): number {
  if (!Array.isArray(raw)) return -1;
  return raw.findIndex((r) => normalizeRow(f.columns ?? [], r) === undefined);
}

/** PAPER_FIELD_INVALID for the field; for rows — with the row that is wrong. */
function valueInvalid(f: PaperField, raw: unknown) {
  const row = f.type === ROWS ? badRow(f, raw) : -1;
  return fieldInvalid(f.key, row >= 0 ? row : undefined);
}

/** Choices a value holds: of the field, or of every cell of its rows by the column. */
function choicesIn(f: PaperField, v: FieldValue | undefined): string[] {
  if (f.type !== ROWS) return choicesOf(v);
  return rowsIn(v).flatMap((r) =>
    (f.columns ?? []).flatMap((c) => (c.options ? choicesOf(r[c.key]) : [])),
  );
}

/**
 * New values of a document (the whole set: keys left out are emptied).
 * Each — of a field the document fills, valid by its type and limits; a
 * choice — an active option, or one the field already holds. Fields that
 * staff fill change only by staff.
 */
export function checkValues(
  input: Record<string, unknown>,
  fields: PaperField[],
  old: FieldValues,
  staff: boolean,
): FieldValues {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const out: FieldValues = {};
  for (const [key, raw] of Object.entries(input)) {
    const f = byKey.get(key);
    if (!f || f.auto || !isFillable(f.type)) throw fieldInvalid(key);
    const v = normalizeValue(f, raw);
    if (v === undefined) throw valueInvalid(f, raw);
    if (v === null) continue;
    if (f.options) {
      const had = new Set(choicesOf(old[key]));
      const ok = choicesOf(v).every(
        (c) => had.has(c) || f.options!.some((o) => o.key === c && !o.archived),
      );
      if (!ok) throw fieldInvalid(key);
    }
    if (f.columns) {
      // A choice of a cell: active, or one the rows already hold in that column.
      const had = new Set(choicesIn(f, old[key]));
      const rows = rowsIn(v);
      const row = rows.findIndex((r) =>
        f.columns!.some(
          (c) =>
            c.options &&
            !choicesOf(r[c.key]).every(
              (x) =>
                had.has(x) ||
                c.options!.some((o) => o.key === x && !o.archived),
            ),
        ),
      );
      if (row >= 0) throw fieldInvalid(key, row);
    }
    out[key] = v;
  }
  if (!staff) {
    for (const f of fields) {
      if (
        f.fill === 'staff' &&
        JSON.stringify(old[f.key]) !== JSON.stringify(out[f.key])
      ) {
        throw new ForbiddenException('Not allowed');
      }
    }
  }
  return out;
}

const zoneMap = (doc: PaperNode) =>
  new Map(zonesOf(doc).map((z) => [z.attrs?.key as string, z]));

/**
 * Content of a document. A free one has no fields; one made from a template
 * keeps to its body (only zones differ), has nothing of a field inside a
 * zone, plain text in plain zones, zones within their length, and zones
 * that staff fill changed only by staff.
 */
export function checkContent(
  content: PaperContent,
  body: PaperContent | null,
  fields: PaperField[],
  old: PaperContent,
  staff: boolean,
) {
  if (body === null) {
    let found = false;
    walkNodes(content, (n) => {
      // A conditional block waits for a field, rows are a field, an auto
      // table takes one: a free document has none.
      if (
        n.type === 'field' ||
        n.type === 'fieldZone' ||
        n.type === 'conditional' ||
        n.type === 'repeat' ||
        n.type === 'autoTable'
      ) {
        found = true;
      }
      // Signatures of a field's member: a free document has no fields.
      if (
        n.type === 'signatures' &&
        (signerField(n.attrs?.leftSigner) !== null ||
          signerField(n.attrs?.rightSigner) !== null)
      ) {
        found = true;
      }
    });
    if (found) throw locked();
    return;
  }
  if (!matchesBody(content, body) || hasFieldInsideZone(content)) {
    throw locked();
  }
  const before = zoneMap(old);
  for (const [key, zone] of zoneMap(content)) {
    const f = fields.find((x) => x.key === key);
    if (!f) throw locked();
    if (f.plain && !isPlainZone(zone)) throw locked();
    if (zoneText(zone).length > (f.maxLength ?? FIELD_LIMITS.zoneDefault)) {
      throw fieldInvalid(key);
    }
    if (f.auto && !sameNodes(zone, before.get(key))) throw locked();
    if (f.fill === 'staff' && !staff && !sameNodes(zone, before.get(key))) {
      throw new ForbiddenException('Not allowed');
    }
  }
}

/** What a change of a published document changes (see changedFields). */
export type FieldChanges = {
  /** Fields whose value changed: the new value (null — emptied). */
  values: Map<string, FieldValue | null>;
  /** Zones whose text changed. */
  zones: Set<string>;
};

/**
 * A change of a published document: fields and zones that differ from
 * what the document shows now. Each must be one the actor may change
 * (`may`): a field «можна змінити» bound to a record they may change, or
 * one of their own; any other — 403. New values are checked as in a draft.
 */
export function changedFields(
  input: { values?: Record<string, unknown>; content?: PaperContent },
  fields: PaperField[],
  shown: { values: FieldValues; content: PaperContent },
  may: (f: PaperField) => boolean,
): FieldChanges {
  const out: FieldChanges = { values: new Map(), zones: new Set() };
  const denied = () => new ForbiddenException('Not allowed');
  if (input.values !== undefined) {
    const changed: Record<string, unknown> = {};
    for (const f of fields) {
      if (!isFillable(f.type)) continue;
      const raw = input.values[f.key] ?? null;
      const v = normalizeValue(f, raw);
      if (v === undefined) throw valueInvalid(f, raw);
      if (JSON.stringify(v) === JSON.stringify(shown.values[f.key] ?? null)) {
        continue;
      }
      if (!may(f)) throw denied();
      changed[f.key] = v;
      out.values.set(f.key, v);
    }
    const known = new Set(fields.map((f) => f.key));
    const unknown = Object.keys(input.values).find((k) => !known.has(k));
    if (unknown !== undefined) throw fieldInvalid(unknown);
    // Limits and choices, as in a draft (who may — checked above).
    checkValues(changed, fields, shown.values, true);
  }
  if (input.content !== undefined) {
    const before = zoneMap(shown.content);
    for (const [key, zone] of zoneMap(input.content)) {
      const f = fields.find((x) => x.key === key);
      const old = before.get(key);
      // A bound zone shows the record's text: only the text counts.
      const same = f?.binding
        ? old !== undefined && zoneText(zone) === zoneText(old)
        : sameNodes(zone, old);
      if (same) continue;
      if (!f || !may(f)) throw denied();
      out.zones.add(key);
    }
  }
  return out;
}
