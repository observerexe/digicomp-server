import { ApiProperty } from '@nestjs/swagger';
import { UserRefDto } from '../common/responses.dto';
import { AccessScope } from '../documents/doc.entity';
import { PaperStatus } from '../paperwork/paper.entity';
import { ArchiveKind } from './dto';

/** An uploaded file of the Archive (`/documents/:id`). */
export class ArchiveFileDto {
  /** Item key of the «document_category» dictionary. */
  category: string;

  @ApiProperty({ enum: AccessScope, enumName: 'AccessScope' })
  accessScope: AccessScope;

  archived: boolean;

  /** Latest version; null for a document without files. */
  @ApiProperty({ type: Number, nullable: true })
  version: number | null;

  @ApiProperty({ type: String, nullable: true })
  fileName: string | null;

  @ApiProperty({ type: Number, nullable: true })
  size: number | null;
}

/** A frozen editor document (`/papers/:id`). */
export class ArchivePaperDto {
  @ApiProperty({ type: String, nullable: true })
  number: string | null;

  @ApiProperty({ enum: PaperStatus, enumName: 'PaperStatus' })
  status: PaperStatus;

  /** Title of its template; null — a free document. */
  @ApiProperty({ type: String, nullable: true })
  template: string | null;

  author: UserRefDto;
}

export class ArchiveItemDto {
  @ApiProperty({ enum: ArchiveKind, enumName: 'ArchiveKind' })
  kind: ArchiveKind;

  id: string;
  title: string;
  updatedAt: Date;

  @ApiProperty({ type: ArchiveFileDto, nullable: true })
  file: ArchiveFileDto | null;

  @ApiProperty({ type: ArchivePaperDto, nullable: true })
  paper: ArchivePaperDto | null;
}

export class ArchiveListDto {
  @ApiProperty({ type: [ArchiveItemDto] })
  items: ArchiveItemDto[];

  total: number;
  page: number;
  limit: number;

  /** Years of all the reader sees in the Archive (filters aside), newest first. */
  @ApiProperty({ type: [Number] })
  years: number[];

  /** Categories of all the files the reader sees (filters aside). */
  @ApiProperty({ type: [String] })
  categories: string[];
}
