import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { NOT_BLANK } from '../points/dto';
import {
  FIELD_TYPES,
  RECORD_TYPES,
  type FieldType,
  type RecordType,
} from '../records/field-types';
import { FIELD_KEY, IsPaperContent, type PaperContent } from './content';
import { PaperVisibility } from './paper.entity';
import { TemplateCreators, TemplateKind } from './template.entities';
import {
  FIELD_FILLERS,
  TEMPLATE_LIMITS,
  type FieldFiller,
} from './template-fields';

/** Capital letters (Latin or Cyrillic) and digits: «ТЗ», «ВБ». */
export const NUMBER_PREFIX = /^[\p{Lu}\d]{1,10}$/u;

const BOUND = TEMPLATE_LIMITS.bound;

/** A field of a template version. Its sense is checked when the version is published. */
export class TemplateFieldDto {
  @Matches(FIELD_KEY)
  key: string;

  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(100)
  label: string;

  /** `text`, `richtext`, `int`, …, `ref:<record type>` or `list<…>` of one of them. */
  @ApiProperty({ type: String })
  @IsIn(FIELD_TYPES)
  type: FieldType;

  @IsBoolean()
  required: boolean;

  /** `author` — the author of the document; `staff` — a moderator or the admin. */
  @ApiProperty({ enum: FIELD_FILLERS, enumName: 'TemplateFieldFiller' })
  @IsIn(FIELD_FILLERS)
  fill: FieldFiller;

  /** May be changed after the document is published. */
  @IsBoolean()
  editable: boolean;

  /** Shown in the print. */
  @IsBoolean()
  print: boolean;

  /** Key of a field of the target's schema (`/records/:type/schema`); null — not bound. */
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  binding?: string | null;

  /** int, decimal. */
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-BOUND)
  @Max(BOUND)
  min?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-BOUND)
  @Max(BOUND)
  max?: number | null;

  /** text, richtext, list<text>. */
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(TEMPLATE_LIMITS.textMax)
  maxLength?: number | null;

  /** list<…>. */
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(TEMPLATE_LIMITS.itemsMax)
  maxItems?: number | null;

  /** enum, list<enum> not bound: key of the dictionary of its values. */
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  dictionary?: string | null;
}

export class CreateTemplateDto {
  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(200)
  title: string;

  /** Cannot be changed later. */
  @ApiProperty({ enum: TemplateKind, enumName: 'TemplateKind' })
  @IsEnum(TemplateKind)
  kind: TemplateKind;

  /** Record type: required for `creates` and `report`, none for `free`. Cannot be changed later. */
  @ApiPropertyOptional({ enum: RECORD_TYPES, enumName: 'RecordType' })
  @IsOptional()
  @IsIn(RECORD_TYPES)
  target?: RecordType;

  /** Without it documents get no number. */
  @IsOptional()
  @Matches(NUMBER_PREFIX)
  numberPrefix?: string;

  /** `creates` only. Default false. */
  @IsOptional()
  @IsBoolean()
  autoFreeze?: boolean;

  /** Default `staff`. */
  @ApiPropertyOptional({ enum: TemplateCreators, enumName: 'TemplateCreators' })
  @IsOptional()
  @IsEnum(TemplateCreators)
  creators?: TemplateCreators;

  /** Visibility of new documents. Default `author`. */
  @ApiPropertyOptional({ enum: PaperVisibility, enumName: 'PaperVisibility' })
  @IsOptional()
  @IsEnum(PaperVisibility)
  visibility?: PaperVisibility;
}

/** Only the given fields change. */
export class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(200)
  title?: string;

  /** null — documents get no number. */
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Matches(NUMBER_PREFIX)
  numberPrefix?: string | null;

  @IsOptional()
  @IsBoolean()
  autoFreeze?: boolean;

  @ApiPropertyOptional({ enum: TemplateCreators, enumName: 'TemplateCreators' })
  @IsOptional()
  @IsEnum(TemplateCreators)
  creators?: TemplateCreators;

  @ApiPropertyOptional({ enum: PaperVisibility, enumName: 'PaperVisibility' })
  @IsOptional()
  @IsEnum(PaperVisibility)
  visibility?: PaperVisibility;

  /** true — to the archive (no new documents), false — back. */
  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

/** A save of a draft version; only the given parts change. */
export class UpdateTemplateVersionDto {
  /** The revision the change is based on; another one — 409 PAPER_CONFLICT. */
  @IsInt()
  @Min(1)
  revision: number;

  /** ProseMirror document. */
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsPaperContent()
  body?: PaperContent;

  /** Every field of the version, in order. */
  @ApiPropertyOptional({ type: [TemplateFieldDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TEMPLATE_LIMITS.fields)
  @ValidateNested({ each: true })
  @Type(() => TemplateFieldDto)
  fields?: TemplateFieldDto[];
}
