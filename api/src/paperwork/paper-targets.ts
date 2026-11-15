import type { EntityManager } from 'typeorm';
import type { RecordType } from '../records/field-types';
import { Paper } from './paper.entity';

/**
 * How many documents created this record. A module asks before deleting
 * one: a record with a document goes only by cancelling the document.
 */
export function papersOf(m: EntityManager, type: RecordType, id: string) {
  return m.count(Paper, { where: { targetType: type, targetId: id } });
}
