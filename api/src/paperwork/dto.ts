import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RECORD_TYPES, type RecordType } from '../records/field-types';
import { NOT_BLANK } from '../points/dto';
import { IsPaperContent, type PaperContent } from './content';
import { PaperStatus, PaperVisibility } from './paper.entity';

/** Field key → value (null or left out — empty). */
const VALUES = {
  type: 'object',
  additionalProperties: true,
  description: 'Field key → value; keys left out are emptied',
} as const;

/** A record a new document is about. */
export class PaperAboutDto {
  @ApiProperty({ enum: RECORD_TYPES, enumName: 'RecordType' })
  @IsIn(RECORD_TYPES)
  type: RecordType;

  @IsUUID()
  id: string;
}

export class CreatePaperDto {
  /** Without a title — «Без назви» (from a template — its title). */
  @IsOptional()
  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(200)
  title?: string;

  /** ProseMirror document; without it — one empty paragraph. Not with `templateId`. */
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsPaperContent()
  content?: PaperContent;

  /** Make the document from the template's current version (its body, its fields). */
  @IsOptional()
  @IsUUID()
  templateId?: string;

  /**
   * With `templateId`: the record the document is about — it goes into the
   * first field of the template the actor fills that refers to its type
   * (`ref:<type>`); without one — into the first such column of
   * «Повторювані рядки» (the first row). Checked as any save of the draft.
   * A template without such a field — as without `about`.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => PaperAboutDto)
  about?: PaperAboutDto;
}

/** A document for a record made without one: published at once. */
export class PaperForRecordDto {
  /** A template that creates records of the record's type. */
  @IsUUID()
  templateId: string;

  @IsUUID()
  targetId: string;
}

/** A copy of a document: same template version, the given text and values. */
export class CopyPaperDto {
  @IsOptional()
  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(200)
  title?: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsPaperContent()
  content: PaperContent;

  @ApiPropertyOptional(VALUES)
  @IsOptional()
  @IsObject()
  values?: Record<string, unknown>;
}

/** Only the given fields change. */
export class UpdatePaperDto {
  /** The revision the change is based on; another one — 409 PAPER_CONFLICT. */
  @IsInt()
  @Min(1)
  revision: number;

  @IsOptional()
  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsPaperContent()
  content?: PaperContent;

  /** All values of the template's fields (keys left out are emptied). */
  @ApiPropertyOptional(VALUES)
  @IsOptional()
  @IsObject()
  values?: Record<string, unknown>;

  /** Staff only. Takes effect once the document is published. */
  @IsOptional()
  @IsEnum(PaperVisibility)
  visibility?: PaperVisibility;
}

export class ListPapersQuery {
  /** `true` — only the actor's own documents (tab «Мої»). */
  @IsOptional()
  @IsIn(['true'])
  mine?: string;

  /** Only documents in this state (the Home's «Мої чернетки» — `draft`). */
  @IsOptional()
  @IsEnum(PaperStatus)
  status?: PaperStatus;

  /**
   * `me` — documents published by others that refer to the actor: by a
   * field `ref:user`, «@» or a cell of rows (the Home's «Нове про мене»).
   */
  @IsOptional()
  @IsIn(['me'])
  about?: string;

  /**
   * `freeze` — published documents waiting to be frozen by hand: their
   * template does not freeze them itself (or there is none) and their
   * records are ready; only those the actor may freeze (the Home of staff).
   */
  @IsOptional()
  @IsIn(['freeze'])
  due?: string;

  /** Part of the title. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  @MaxLength(6)
  page?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  @MaxLength(3)
  limit?: string;
}

export class PrintPaperQuery {
  /** The snapshot's number (1, 2, …); none — the latest one, if frozen. */
  @IsOptional()
  @IsNumberString({ no_symbols: true })
  @MaxLength(6)
  snapshot?: string;
}

export class CancelPaperDto {
  /** Why: kept on the document and in the audit. */
  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(1000)
  reason: string;
}
