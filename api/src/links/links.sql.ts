import type { EntityManager } from 'typeorm';
import type { RecordType } from '../records/field-types';
import { RecordLink } from './record-link.entity';

/**
 * Helpers for modules that read or clean up links without the HTTP layer.
 * A link counts in either direction.
 */

/**
 * SQL condition: `idColumn` (a record of `type`) is linked with the record
 * given by the parameters `:linkedType` and `:linkedId`.
 */
export function linkedWithSql(type: RecordType, idColumn: string): string {
  return `${idColumn} IN (
    SELECT l.from_id FROM record_links l
      WHERE l.from_type = '${type}' AND l.to_type = :linkedType AND l.to_id = :linkedId
    UNION
    SELECT l.to_id FROM record_links l
      WHERE l.to_type = '${type}' AND l.from_type = :linkedType AND l.from_id = :linkedId)`;
}

/** Drops every link of a record that is being deleted. */
export async function removeLinksOf(
  m: EntityManager,
  type: RecordType,
  id: string,
) {
  await m
    .createQueryBuilder()
    .delete()
    .from(RecordLink)
    .where('(from_type = :type AND from_id = :id)', { type, id })
    .orWhere('(to_type = :type AND to_id = :id)', { type, id })
    .execute();
}
