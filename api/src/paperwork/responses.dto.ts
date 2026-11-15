import { ApiProperty } from '@nestjs/swagger';
import { UserRefDto } from '../common/responses.dto';
import { RECORD_TYPES, type RecordType } from '../records/field-types';
import type { FieldValues, PaperContent } from './content';
import { PaperStatus, PaperVisibility } from './paper.entity';
import { FIELD_FILLERS, type FieldFiller } from './template-fields';

/** A document without its content (lists, the answer to a save). */
export class PaperItemDto {
  id: string;
  title: string;

  @ApiProperty({ enum: PaperStatus, enumName: 'PaperStatus' })
  status: PaperStatus;

  @ApiProperty({ enum: PaperVisibility, enumName: 'PaperVisibility' })
  visibility: PaperVisibility;

  author: UserRefDto;

  /** Send it with the next change (PATCH). */
  revision: number;

  createdAt: Date;
  updatedAt: Date;
}

/** One choice of an `enum` field. */
export class PaperFieldOptionDto {
  key: string;
  label: string;

  /** Stays where already chosen; not offered. */
  archived?: boolean;
}

/** A field of the document's template, with what filling it needs. */
export class PaperFieldDto {
  key: string;
  label: string;

  /** `text`, `int`, …, `ref:<record type>`, `list<…>`; `richtext` — a zone on the sheet. */
  type: string;

  required: boolean;

  @ApiProperty({ enum: FIELD_FILLERS, enumName: 'TemplateFieldFiller' })
  fill: FieldFiller;

  /** May be changed after the document is published. */
  editable: boolean;

  /** Shown in the print. */
  print: boolean;

  /** Limits: the template's and the bound field's of the record, the tighter. */
  @ApiProperty({ type: Number, nullable: true })
  min: number | null;

  @ApiProperty({ type: Number, nullable: true })
  max: number | null;

  @ApiProperty({ type: Number, nullable: true })
  maxLength: number | null;

  @ApiProperty({ type: Number, nullable: true })
  maxItems: number | null;

  /** decimal: digits after the point (null — 2). */
  @ApiProperty({ type: Number, nullable: true })
  scale: number | null;

  /** enum, list<enum>: the choices in order; null for other types. */
  @ApiProperty({ type: [PaperFieldOptionDto], nullable: true })
  options: PaperFieldOptionDto[] | null;

  /** A zone of plain paragraphs (bound to a text field of the record). */
  plain: boolean;

  /** The actor may fill it now. */
  canFill: boolean;
}

/** The template a document is made from (the version it keeps to). */
export class PaperTemplateRefDto {
  id: string;
  title: string;
  version: number;

  @ApiProperty({ type: [PaperFieldDto] })
  fields: PaperFieldDto[];
}

/** A record the document refers to (a `ref:*` field, «@»), as the reader sees it. */
export class PaperRefDto {
  @ApiProperty({ enum: RECORD_TYPES, enumName: 'RecordType' })
  type: RecordType;

  id: string;
  title: string;

  /** The record is in the archive (a member — blocked, a document — cancelled). */
  archived: boolean;

  /** QR code, for records opened by it (equipment, inventory). */
  @ApiProperty({ required: false })
  code?: string;
}

export class PaperDto extends PaperItemDto {
  /** ProseMirror document. */
  @ApiProperty({ type: 'object', additionalProperties: true })
  content: PaperContent;

  /** Values of the template's fields by key. */
  @ApiProperty({ type: 'object', additionalProperties: true })
  values: FieldValues;

  /** null — a free document. */
  @ApiProperty({ type: PaperTemplateRefDto, nullable: true })
  template: PaperTemplateRefDto | null;

  /**
   * Records of `ref:*` values and «@» in the text the reader sees. One
   * not here — not seen, or deleted: «запис недоступний».
   */
  @ApiProperty({ type: [PaperRefDto] })
  refs: PaperRefDto[];

  /** The actor may change and delete it: their own draft (admin — any). */
  canEdit: boolean;
}

export class PaperListDto {
  @ApiProperty({ type: [PaperItemDto] })
  items: PaperItemDto[];

  total: number;
  page: number;
  limit: number;
}
