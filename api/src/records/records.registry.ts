import { NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { DISCIPLINE_RECORD_SCHEMA } from '../discipline/discipline-record.schema';
import { DOCUMENT_SCHEMA } from '../documents/document.schema';
import { FAULT_SCHEMA } from '../faults/fault.schema';
import { INVENTORY_ITEM_SCHEMA } from '../inventory/inventory-item.schema';
import { PLACE_AUTHORIZATION_SCHEMA } from '../places/place-authorization.schema';
import { PLACE_SCHEMA } from '../places/place.schema';
import { SESSION_SCHEMA } from '../places/session.schema';
import { POINTS_ENTRY_SCHEMA } from '../points/points-entry.schema';
import { PROJECT_SCHEMA } from '../projects/project.schema';
import { TASK_SCHEMA } from '../tasks/task.schema';
import { USER_SCHEMA } from '../users/user.schema';
import { RecordSchema, RecordSchemaDef } from './field-types';

/** All record schemas; each module describes its own types. */
export const SCHEMA_DEFS: readonly RecordSchemaDef[] = [
  USER_SCHEMA,
  TASK_SCHEMA,
  PROJECT_SCHEMA,
  PLACE_SCHEMA,
  INVENTORY_ITEM_SCHEMA,
  DISCIPLINE_RECORD_SCHEMA,
  POINTS_ENTRY_SCHEMA,
  SESSION_SCHEMA,
  FAULT_SCHEMA,
  PLACE_AUTHORIZATION_SCHEMA,
  DOCUMENT_SCHEMA,
];

/** What clients get: the schema and its version. */
export type PublishedSchema = RecordSchema & { version: string };

function publish({ type, label, fields }: RecordSchemaDef): PublishedSchema {
  const schema: RecordSchema = { type, label, fields };
  // Changes whenever the description changes; templates remember it.
  const version = createHash('sha256')
    .update(JSON.stringify(schema))
    .digest('hex')
    .slice(0, 12);
  return { ...schema, version };
}

const PUBLISHED = new Map<string, PublishedSchema>(
  SCHEMA_DEFS.map((d) => [d.type, publish(d)]),
);

export function recordSchema(type: string): PublishedSchema {
  const schema = PUBLISHED.get(type);
  if (!schema) throw new NotFoundException('Record type not found');
  return schema;
}
