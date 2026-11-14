import { ApiProperty } from '@nestjs/swagger';
import { RECORD_TYPES, type RecordType } from '../records/field-types';

/** A link as seen from one record: the other side and what it means. */
export class LinkDto {
  id: string;

  /** `out` — this record is the source, `in` — the other record is. */
  @ApiProperty({ enum: ['out', 'in'], enumName: 'LinkDirection' })
  direction: 'out' | 'in';

  /** Type of the record on the other side. */
  @ApiProperty({ enum: RECORD_TYPES, enumName: 'RecordType' })
  type: RecordType;

  /** Id of the record on the other side. */
  recordId: string;

  title: string;
  /** The other record is in the archive. */
  archived: boolean;

  /** QR code of the other record, for records opened by it (equipment, inventory). */
  @ApiProperty({ required: false })
  code?: string;

  /** What the link means for the source; empty — just related. */
  role: string;

  createdById: string;
  createdAt: Date;

  /** The actor may remove the link (edits its source). */
  canRemove: boolean;
}

/** Links of a record and whether the actor may add more. */
export class LinkListDto {
  /** The actor edits this record, so may link it to others. */
  canLink: boolean;

  @ApiProperty({ type: [LinkDto] })
  items: LinkDto[];
}

/** A record that may be linked. */
export class LinkCandidateDto {
  id: string;

  @ApiProperty({ enum: RECORD_TYPES, enumName: 'RecordType' })
  type: RecordType;

  title: string;
  /** The record is in the archive. */
  archived: boolean;

  /** QR code, for records opened by it (equipment, inventory). */
  @ApiProperty({ required: false })
  code?: string;
}
