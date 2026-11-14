import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';
import { RECORD_TYPES, type RecordType } from '../records/field-types';

/** Role key: lower-case latin, digits, `_`; up to 40 characters. */
export const LINK_ROLE = /^[a-z][a-z0-9_]{0,39}$/;

export class ListLinksQuery {
  /** Type of the record whose links are listed. */
  @ApiProperty({ enum: RECORD_TYPES, enumName: 'RecordType' })
  @IsIn(RECORD_TYPES)
  type: RecordType;

  @IsUUID()
  id: string;
}

export class CreateLinkDto {
  /** The source: the actor must be able to edit it. */
  @ApiProperty({ enum: RECORD_TYPES, enumName: 'RecordType' })
  @IsIn(RECORD_TYPES)
  fromType: RecordType;

  @IsUUID()
  fromId: string;

  @ApiProperty({ enum: RECORD_TYPES, enumName: 'RecordType' })
  @IsIn(RECORD_TYPES)
  toType: RecordType;

  @IsUUID()
  toId: string;

  /** What the link means for the source; empty — just related. */
  @IsOptional()
  @Matches(LINK_ROLE)
  role?: string;
}
