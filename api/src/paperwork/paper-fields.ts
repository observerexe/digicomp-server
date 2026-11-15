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
  normalizeValue,
  sameNodes,
  walkNodes,
  zonesOf,
  zoneText,
  type FieldOption,
  type FieldSpec,
  type FieldValues,
  type PaperContent,
  type PaperNode,
} from './content';
import type { FieldFiller, TemplateField } from './template-fields';

/** Messages mapped to stable errorCode in common/http-exception.filter.ts. */
export const PaperFieldErrors = {
  FieldInvalid: 'Invalid paper field',
  ContentLocked: 'Paper content is locked by its template',
  NeedsUpdate: 'Template needs update',
} as const;

export function fieldInvalid(key: string) {
  return new BadRequestException({
    message: PaperFieldErrors.FieldInvalid,
    field: key,
  });
}

const locked = () => new BadRequestException(PaperFieldErrors.ContentLocked);

/** A field of a document's template, as the document fills it. */
export type PaperField = FieldSpec & {
  label: string;
  required: boolean;
  fill: FieldFiller;
  editable: boolean;
  print: boolean;
  /** enum, list<enum>: the choices, archived ones included. */
  options: FieldOption[] | null;
  /** richtext bound to a text field of the record: paragraphs without formatting. */
  plain: boolean;
};

const tighter = (
  a: number | null,
  b: number | undefined,
  pick: (...v: number[]) => number,
) => (b === undefined ? a : a === null ? b : pick(a, b));

/**
 * Fields of a version with what the document needs to fill them: limits of
 * the bound field of the record (never wider), choices of `enum` from the
 * dictionary or the record's schema.
 */
export async function resolveFields(
  m: EntityManager,
  fields: TemplateField[],
  schema: PublishedSchema | null,
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
  return fields.map((f) => {
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
      plain: f.type === 'richtext' && f.binding !== null,
    };
  });
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
    if (!f || !isFillable(f.type)) throw fieldInvalid(key);
    const v = normalizeValue(f, raw);
    if (v === undefined) throw fieldInvalid(key);
    if (v === null) continue;
    if (f.options) {
      const had = new Set(choicesOf(old[key]));
      const ok = choicesOf(v).every(
        (c) => had.has(c) || f.options!.some((o) => o.key === c && !o.archived),
      );
      if (!ok) throw fieldInvalid(key);
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
      if (n.type === 'field' || n.type === 'fieldZone') found = true;
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
    if (f.fill === 'staff' && !staff && !sameNodes(zone, before.get(key))) {
      throw new ForbiddenException('Not allowed');
    }
  }
}
