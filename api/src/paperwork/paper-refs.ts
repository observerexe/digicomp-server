import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { Actor } from '../auth/policy';
import type { LinkedRecord, LinkRegistry } from '../links/link-registry';
import { RecordLink } from '../links/record-link.entity';
import {
  mentionsOf,
  refType,
  valueRefs,
  type FieldValues,
  type PaperContent,
  type RecordRef,
} from './content';
import { fieldInvalid } from './paper-fields';

/**
 * Records a document refers to: values of `ref:*` fields and «@» in the
 * text. The document's save checks new ones and writes them as links from
 * the document (`from_type = 'paper'`): role — the key of the field, ''
 * for «@». Those links follow the document alone; nobody makes them by hand.
 */

const refKey = (r: RecordRef) => `${r.type}:${r.id}`;

/** A field of this type may be filled: not a reference, or one to a type that may be referred to. */
export function fillableType(links: LinkRegistry, type: string): boolean {
  const ref = refType(type);
  return ref === null || links.get(ref) !== undefined;
}

/** A record the document refers to, as the actor sees it. */
export type SeenRecord = RecordRef & LinkedRecord;

/** Every record of the values and the text, each once. */
function allRefs(
  fields: readonly { key: string; type: string }[],
  values: FieldValues,
  content: PaperContent,
): RecordRef[] {
  const out = new Map<string, RecordRef>();
  for (const r of [...valueRefs(fields, values), ...mentionsOf(content)]) {
    out.set(refKey(r), { type: r.type, id: r.id });
  }
  return [...out.values()];
}

/** Records among `refs` the actor sees, by `type:id`. */
async function seen(
  registry: LinkRegistry,
  refs: RecordRef[],
  actor: Actor,
  m: EntityManager,
): Promise<Map<string, SeenRecord>> {
  const byType = new Map<string, string[]>();
  for (const r of refs)
    byType.set(r.type, [...(byType.get(r.type) ?? []), r.id]);
  const out = new Map<string, SeenRecord>();
  for (const [type, ids] of byType) {
    const found = await registry.get(type)?.find(ids, actor, m);
    for (const [id, rec] of found ?? []) {
      out.set(refKey({ type, id }), { type, id, ...rec });
    }
  }
  return out;
}

/** Records of the document the actor sees: titles for the sheet and the print. */
export async function seenRefs(
  registry: LinkRegistry,
  fields: readonly { key: string; type: string }[],
  values: FieldValues,
  content: PaperContent,
  actor: Actor,
  m: EntityManager,
): Promise<SeenRecord[]> {
  return [
    ...(
      await seen(registry, allRefs(fields, values, content), actor, m)
    ).values(),
  ];
}

/**
 * Records new to the document (none of its values or text referred to them
 * before) exist and the actor sees them: a field — PAPER_FIELD_INVALID with
 * its key, «@» — RECORD_NOT_FOUND. Records it already held stay, even
 * deleted since: the document still saves. Returns the new ones.
 */
export async function checkNewRefs(
  registry: LinkRegistry,
  fields: readonly { key: string; type: string }[],
  next: { values: FieldValues; content: PaperContent },
  old: { values: FieldValues; content: PaperContent },
  actor: Actor,
  m: EntityManager,
): Promise<Set<string>> {
  const had = new Set(allRefs(fields, old.values, old.content).map(refKey));
  const values = valueRefs(fields, next.values).filter(
    (r) => !had.has(refKey(r)),
  );
  const mentions = mentionsOf(next.content).filter((r) => !had.has(refKey(r)));
  const found = await seen(registry, [...values, ...mentions], actor, m);
  const lost = values.find((r) => !found.has(refKey(r)));
  if (lost) throw fieldInvalid(lost.key);
  if (mentions.some((r) => !found.has(refKey(r)))) {
    throw new NotFoundException('Record not found');
  }
  return new Set(found.keys());
}

/**
 * Links from the document as its values and text are: missing ones added,
 * the rest removed. A record is linked only when it is known to exist:
 * checked just now (`fresh`), or already linked from the document (links
 * of a deleted record are removed with it). A pair linked the other way
 * round stays as it is.
 */
export async function syncLinks(
  m: EntityManager,
  paperId: string,
  fields: readonly { key: string; type: string }[],
  values: FieldValues,
  content: PaperContent,
  fresh: ReadonlySet<string>,
  actorId: string,
) {
  const want = new Map<string, RecordRef & { role: string }>();
  for (const r of valueRefs(fields, values)) {
    want.set(`${refKey(r)}:${r.key}`, { type: r.type, id: r.id, role: r.key });
  }
  for (const r of mentionsOf(content)) {
    want.set(`${refKey(r)}:`, { ...r, role: '' });
  }
  const have = await m.findBy(RecordLink, {
    fromType: 'paper',
    fromId: paperId,
  });
  const known = new Set(fresh);
  for (const l of have) known.add(`${l.toType}:${l.toId}`);
  const kept = new Set<string>();
  const drop: string[] = [];
  for (const l of have) {
    const key = `${l.toType}:${l.toId}:${l.role}`;
    if (want.has(key)) kept.add(key);
    else drop.push(l.id);
  }
  if (drop.length) await m.delete(RecordLink, drop);
  const add = [...want]
    .filter(([key, r]) => !kept.has(key) && known.has(refKey(r)))
    .map(([, r]) => ({
      fromType: 'paper',
      fromId: paperId,
      toType: r.type,
      toId: r.id,
      role: r.role,
      createdById: actorId,
    }));
  if (add.length) {
    await m
      .createQueryBuilder()
      .insert()
      .into(RecordLink)
      .values(add)
      .orIgnore()
      .execute();
  }
}
