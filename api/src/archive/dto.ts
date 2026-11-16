import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PaperStatus } from '../paperwork/paper.entity';
import { RECORD_TYPES, type RecordType } from '../records/field-types';

/** What a row of the Archive is: an uploaded file or an editor document. */
export enum ArchiveKind {
  File = 'file',
  Paper = 'paper',
}

/** States an editor document has in the Archive (it has a snapshot). */
export const ARCHIVE_PAPER_STATUSES = [
  PaperStatus.Frozen,
  PaperStatus.Signed,
  PaperStatus.Cancelled,
] as const;

export class ListArchiveQuery {
  /** Files: title, description, category; documents: title, number. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiProperty({ enum: ArchiveKind, enumName: 'ArchiveKind', required: false })
  @IsOptional()
  @IsIn(Object.values(ArchiveKind))
  kind?: ArchiveKind;

  /** Only editor documents in this state (files have none). */
  @ApiProperty({
    enum: ARCHIVE_PAPER_STATUSES,
    enumName: 'ArchivePaperStatus',
    required: false,
  })
  @IsOptional()
  @IsIn(ARCHIVE_PAPER_STATUSES)
  status?: (typeof ARCHIVE_PAPER_STATUSES)[number];

  /** Documents — the year of publication, files — of upload (Kyiv time). */
  @IsOptional()
  @Matches(/^\d{4}$/)
  year?: string;

  /** Only files of this item of «document_category». */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  category?: string;

  /** With `linkedId`: only rows linked with this record (`/links`). */
  @ApiProperty({ enum: RECORD_TYPES, enumName: 'RecordType', required: false })
  @ValidateIf((q: ListArchiveQuery) => q.linkedId !== undefined)
  @IsIn(RECORD_TYPES)
  linkedType?: RecordType;

  @ValidateIf((q: ListArchiveQuery) => q.linkedType !== undefined)
  @IsUUID()
  linkedId?: string;

  /** Staff: only files taken out of the Archive (no documents). */
  @IsOptional()
  @IsIn(['true'])
  archived?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  @MaxLength(6)
  page?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  @MaxLength(3)
  limit?: string;
}
