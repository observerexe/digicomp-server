import { ApiProperty } from '@nestjs/swagger';
import { UserRefDto } from '../common/responses.dto';
import { RECORD_TYPES, type RecordType } from '../records/field-types';
import type { FieldValues, PaperContent } from './content';
import { PaperStatus, PaperVisibility } from './paper.entity';
import { FIELD_FILLERS, type FieldFiller } from './template-fields';
import { TemplateKind } from './template.entities';

/** The document a record was created with (or got later): open it to read or change the record. */
export class RecordPaperDto {
  id: string;

  /** «ТЗ-2026-014»; null — the template gives no numbers. */
  @ApiProperty({ type: String, nullable: true })
  number: string | null;
}

/** A document that refers to a record (a field `ref:*` or «@»), as the reader sees it. */
export class ReferringPaperDto extends RecordPaperDto {
  title: string;

  @ApiProperty({ enum: PaperStatus, enumName: 'PaperStatus' })
  status: PaperStatus;
}

/** A document without its content (lists, the answer to a save). */
export class PaperItemDto {
  id: string;
  title: string;

  /** `ТЗ-2026-014`: given when published, if the template has a prefix. */
  @ApiProperty({ type: String, nullable: true })
  number: string | null;

  @ApiProperty({ enum: PaperStatus, enumName: 'PaperStatus' })
  status: PaperStatus;

  @ApiProperty({ enum: PaperVisibility, enumName: 'PaperVisibility' })
  visibility: PaperVisibility;

  author: UserRefDto;

  /** Send it with the next change (PATCH). */
  revision: number;

  @ApiProperty({ type: Date, nullable: true })
  publishedAt: Date | null;

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

  /**
   * `text`, `int`, …, `ref:<record type>`, `list<…>`; `richtext` — a zone on
   * the sheet; `rows` — «Повторювані рядки» (value: a list of rows, a row —
   * values of `columns` by their keys).
   */
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

  /** Key of the record's field it is bound to; once published it shows the record as it is now. */
  @ApiProperty({ type: String, nullable: true })
  binding: string | null;

  /** Bound to what the record gets later (assignees, acceptance…): nobody fills it; it shows the record once published. */
  auto: boolean;

  /** The actor may fill it now (a draft), or change it (a published document, see `canChange`). */
  canFill: boolean;

  /** rows: fields of its columns (filled, changed and printed as the rows); null for other types. */
  @ApiProperty({ type: () => [PaperFieldDto], nullable: true })
  columns: PaperFieldDto[] | null;
}

/** The template a document is made from (the version it keeps to). */
export class PaperTemplateRefDto {
  id: string;
  title: string;
  version: number;

  /** `creates` — publishing creates a record of `target`. */
  @ApiProperty({ enum: TemplateKind, enumName: 'TemplateKind' })
  kind: TemplateKind;

  @ApiProperty({ enum: RECORD_TYPES, enumName: 'RecordType', nullable: true })
  target: RecordType | null;

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

/** The latest signed scan of a snapshot (`GET /papers/:id/signed`). */
export class PaperSignedDto {
  /** Its version in the archive document of the snapshot (1 — the first scan). */
  version: number;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedAt: Date;
}

/** A snapshot of a frozen document. */
export class PaperSnapshotDto {
  /** 1, 2, … within the document (`print?snapshot=`). */
  n: number;
  /** Hex SHA-256 of the sheet: the check page `/papers/verify/:sha`. */
  sha256: string;
  createdAt: Date;
  /** The signed scan; null — none uploaded. */
  @ApiProperty({ type: PaperSignedDto, nullable: true })
  signed: PaperSignedDto | null;
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

  /** The record the document created; it stays when the record is gone (cancelled). */
  @ApiProperty({ enum: RECORD_TYPES, enumName: 'RecordType', nullable: true })
  targetType: RecordType | null;

  @ApiProperty({ type: String, nullable: true })
  targetId: string | null;

  /** Why it was cancelled. */
  @ApiProperty({ type: String, nullable: true })
  cancelReason: string | null;

  /** The actor may change and delete it: their own draft (admin — any). */
  canEdit: boolean;

  /**
   * The actor may publish it (a draft: their own, staff — any). A document
   * that creates a record also needs the record's right (checked on publishing).
   */
  canPublish: boolean;

  /** The actor may cancel it (published: their own, staff — any; the record's rule — on cancelling). */
  canCancel: boolean;

  /**
   * Published: the actor may change some fields «можна змінити» (`canFill`) —
   * bound ones while they may change the record, the rest in their own document (staff — any).
   */
  canChange: boolean;

  /**
   * Published, and its records are ready: the actor may freeze it for print
   * and signature (a member — own free document; staff — any).
   */
  canFreeze: boolean;

  /**
   * Frozen (or signed): the actor may upload the signed scan (a member — own
   * free document; staff — any).
   */
  canSign: boolean;

  /** The latest snapshot (frozen, signed; cancelled after freezing); null — none. */
  @ApiProperty({ type: PaperSnapshotDto, nullable: true })
  snapshot: PaperSnapshotDto | null;
}

/** Who froze a snapshot. */
export class PaperVerifyPersonDto {
  id: string;
  name: string;
}

/**
 * The check of a printed document by its hash: the snapshot is genuine and
 * what its document is now. Everyone signed in gets it; `paperId` — only who
 * sees the document.
 */
export class PaperVerifyDto {
  sha256: string;
  /** The snapshot's number within its document. */
  n: number;
  /** No later snapshot of the document. */
  latest: boolean;
  frozenAt: Date;

  @ApiProperty({ type: PaperVerifyPersonDto, nullable: true })
  frozenBy: PaperVerifyPersonDto | null;

  @ApiProperty({ type: String, nullable: true })
  number: string | null;

  title: string;

  @ApiProperty({ enum: PaperStatus, enumName: 'PaperStatus' })
  status: PaperStatus;

  @ApiProperty({ type: String, nullable: true })
  cancelReason: string | null;

  /** The document, if the reader sees it (open, print this snapshot); else null. */
  @ApiProperty({ type: String, nullable: true })
  paperId: string | null;
}

export class PaperListDto {
  @ApiProperty({ type: [PaperItemDto] })
  items: PaperItemDto[];

  total: number;
  page: number;
  limit: number;
}
