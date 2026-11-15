import { In, type EntityManager } from 'typeorm';
import type { RecordType } from '../records/field-types';
import { Paper } from './paper.entity';

/**
 * How many documents created this record. A module asks before deleting
 * one: a record with a document goes only by cancelling the document.
 */
export function papersOf(m: EntityManager, type: RecordType, id: string) {
  return m.count(Paper, { where: { targetType: type, targetId: id } });
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
