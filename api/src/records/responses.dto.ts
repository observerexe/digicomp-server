import { ApiProperty } from '@nestjs/swagger';
import {
  EXTRA_TYPES,
  RECORD_TYPES,
  type ExtraType,
  type FieldSource,
  type RecordType,
} from './field-types';

export class EnumOptionDto {
  key: string;
  label: string;
}

export class RecordFieldDto {
  /** Same key as in the API of the record. */
  key: string;
  label: string;

  /**
   * `text`, `richtext`, `int`, `decimal`, `date`, `datetime`, `bool`, `enum`, `color`,
   * `ref:<record type>` or `list<…>` of one of them.
   */
  type: string;

  /** Must be given when the record is created. */
  required?: boolean;
  /** May be empty (null). */
  nullable?: boolean;
  /** May be set when the record is created. */
  create?: boolean;
  /** May be changed later. */
  update?: boolean;
  min?: number;
  max?: number;
  /** decimal: digits after the point. */
  scale?: number;
  /** text: length bounds (for a list — of each item). */
  minLength?: number;
  maxLength?: number;
  /** text: the whole value must match this regex. */
  pattern?: string;
  maxItems?: number;

  /** enum: fixed values. */
  @ApiProperty({ type: [EnumOptionDto], required: false })
  options?: EnumOptionDto[];

  /** enum: key of the dictionary whose item keys are the values. */
  dictionary?: string;

  /** Where the value lives; default `column`. `extra` — an extra field (field-defs). */
  @ApiProperty({
    enum: ['column', 'relation', 'computed', 'extra'],
    enumName: 'FieldSource',
    required: false,
  })
  source?: FieldSource;

  /** Extra field in the archive: old values stay, new ones are not taken. */
  archived?: boolean;
}

export class RecordSchemaDto {
  @ApiProperty({ enum: RECORD_TYPES, enumName: 'RecordType' })
  type: RecordType;

  label: string;

  /** Staff may add extra fields (`/records/:type/field-defs`). */
  extensible: boolean;

  /** Changes with any change of the schema, extra fields included. */
  version: string;

  @ApiProperty({ type: [RecordFieldDto] })
  fields: RecordFieldDto[];
}

/** An extra field of a record type (values in the record's `extra`). */
export class FieldDefDto {
  id: string;
  /** Made from the label at creation; never changes. */
  key: string;
  label: string;

  @ApiProperty({ enum: EXTRA_TYPES, enumName: 'ExtraFieldType' })
  type: ExtraType;

  required: boolean;

  @ApiProperty({ type: String, nullable: true })
  dictionary: string | null;

  @ApiProperty({ type: Number, nullable: true })
  min: number | null;

  @ApiProperty({ type: Number, nullable: true })
  max: number | null;

  @ApiProperty({ type: Number, nullable: true })
  maxLength: number | null;

  @ApiProperty({ type: Number, nullable: true })
  maxItems: number | null;

  position: number;
  archived: boolean;
}
