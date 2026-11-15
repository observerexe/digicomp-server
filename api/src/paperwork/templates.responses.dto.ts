import { ApiProperty } from '@nestjs/swagger';
import { UserRefDto } from '../common/responses.dto';
import { RECORD_TYPES, type RecordType } from '../records/field-types';
import type { PaperContent } from './content';
import { PaperVisibility } from './paper.entity';
import { TemplateCreators, TemplateKind } from './template.entities';
import { TemplateFieldDto } from './templates.dto';

/** A template without its versions (lists). */
export class TemplateItemDto {
  id: string;
  title: string;

  @ApiProperty({ enum: TemplateKind, enumName: 'TemplateKind' })
  kind: TemplateKind;

  @ApiProperty({ enum: RECORD_TYPES, enumName: 'RecordType', nullable: true })
  target: RecordType | null;

  @ApiProperty({ type: String, nullable: true })
  numberPrefix: string | null;

  autoFreeze: boolean;

  @ApiProperty({ enum: TemplateCreators, enumName: 'TemplateCreators' })
  creators: TemplateCreators;

  /** Visibility of new documents. */
  @ApiProperty({ enum: PaperVisibility, enumName: 'PaperVisibility' })
  visibility: PaperVisibility;

  archived: boolean;

  /** Number of the version new documents are made from; null — none published yet. */
  @ApiProperty({ type: Number, nullable: true })
  currentVersion: number | null;

  /** Number of the draft version; always null for members. */
  @ApiProperty({ type: Number, nullable: true })
  draftVersion: number | null;

  /** The target's schema changed and a binding of the current version broke: no new documents until a new version is published. */
  needsUpdate: boolean;

  createdAt: Date;
  updatedAt: Date;
}

/** A version without its body and fields. */
export class TemplateVersionItemDto {
  number: number;

  /** Send it with the next save of the draft (PATCH). */
  revision: number;

  /** null — a draft. */
  @ApiProperty({ type: Date, nullable: true })
  publishedAt: Date | null;

  @ApiProperty({ type: UserRefDto, nullable: true })
  publishedBy: UserRefDto | null;

  updatedAt: Date;
}

/** A version in the template's list. */
export class TemplateVersionRowDto extends TemplateVersionItemDto {
  /** Documents made from the version; null for members. */
  @ApiProperty({ type: Number, nullable: true })
  documents: number | null;
}

export class TemplateDto extends TemplateItemDto {
  /** Newest first. Members get only the current version. */
  @ApiProperty({ type: [TemplateVersionRowDto] })
  versions: TemplateVersionRowDto[];
}

export class TemplateVersionDto extends TemplateVersionItemDto {
  templateId: string;

  /** ProseMirror document. */
  @ApiProperty({ type: 'object', additionalProperties: true })
  body: PaperContent;

  @ApiProperty({ type: [TemplateFieldDto] })
  fields: TemplateFieldDto[];

  /** Version of the target's schema the bindings were checked against when published. */
  @ApiProperty({ type: String, nullable: true })
  schemaVersion: string | null;
}
