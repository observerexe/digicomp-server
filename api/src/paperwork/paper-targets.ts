import { In, Not, type EntityManager } from 'typeorm';
import type { Actor } from '../auth/policy';
import { RecordLink } from '../links/record-link.entity';
import type { RecordType } from '../records/field-types';
import type { PaperAdapterRegistry } from './adapters';
import { TARGET_ROLE } from './paper-refs';
import { Paper, PaperStatus } from './paper.entity';
import { whereSeen } from './paper.links';

/**
 * How many documents created this record (or were made for it later): by
 * their links `@target`, so the records of rows count too. A module asks
 * before taking one off: a record with a document goes only by cancelling
 * the document.
 */
export function papersOf(m: EntityManager, type: RecordType, id: string) {
  return m.countBy(RecordLink, {
    fromType: 'paper',
    toType: type,
    toId: id,
    role: TARGET_ROLE,
  });
}

/**
 * The records a published document created: its record, or those of its
 * rows («рядок = запис»: known by the links `@target`).
 */
export async function recordsOfPaper(
  m: EntityManager,
  p: Pick<Paper, 'id' | 'targetType' | 'targetId'>,
): Promise<string[]> {
  if (!p.targetType) return [];
  if (p.targetId) return [p.targetId];
  const links = await m.find(RecordLink, {
    select: { toId: true },
    where: {
      fromType: 'paper',
      fromId: p.id,
      toType: p.targetType,
      role: TARGET_ROLE,
    },
    order: { createdAt: 'ASC', toId: 'ASC' },
  });
  return links.map((l) => l.toId);
}

/** The document of a record, as its page and card show it. */
export type RecordPaper = { id: string; number: string | null };

/**
 * The document each of these records was created with (or got for itself
 * later), by record id; a record without one is not in the map. A record
 * has one document (PAPER_TARGET_TAKEN); were there more — the latest.
 */
export async function paperOfRecords(
  m: EntityManager,
  type: RecordType,
  ids: string[],
): Promise<Map<string, RecordPaper>> {
  if (!ids.length) return new Map();
  const rows = await m.find(Paper, {
    select: { id: true, number: true, targetId: true },
    where: { targetType: type, targetId: In(ids) },
    order: { publishedAt: 'ASC' },
  });
  return new Map(
    rows.map((p) => [p.targetId!, { id: p.id, number: p.number }]),
  );
}

/** A document that refers to a record (see papersReferring). */
export type ReferringPaper = RecordPaper & {
  title: string;
  status: PaperStatus;
};

/**
 * Documents that refer to these records — by a field `ref:*` or «@», not
 * the document a record was created with — that the actor sees, by record
 * id (oldest first); a record without any is not in the map.
 */
export async function papersReferring(
  m: EntityManager,
  adapters: PaperAdapterRegistry,
  actor: Actor,
  type: RecordType,
  ids: string[],
): Promise<Map<string, ReferringPaper[]>> {
  if (!ids.length) return new Map();
  const links = await m.findBy(RecordLink, {
    fromType: 'paper',
    toType: type,
    toId: In(ids),
    role: Not(TARGET_ROLE),
  });
  if (!links.length) return new Map();
  const papers = await whereSeen(
    m
      .getRepository(Paper)
      .createQueryBuilder('p')
      .select(['p.id', 'p.title', 'p.number', 'p.status', 'p.createdAt'])
      .where('p.id IN (:...pids)', {
        pids: [...new Set(links.map((l) => l.fromId))],
      }),
    actor,
    adapters,
  )
    .orderBy('p.createdAt', 'ASC')
    .addOrderBy('p.id', 'ASC')
    .getMany();
  const out = new Map<string, ReferringPaper[]>();
  for (const p of papers) {
    const to = new Set(
      links.filter((l) => l.fromId === p.id).map((l) => l.toId),
    );
    for (const id of to) {
      out.set(id, [
        ...(out.get(id) ?? []),
        { id: p.id, title: p.title, number: p.number, status: p.status },
      ]);
    }
  }
  return out;
}
