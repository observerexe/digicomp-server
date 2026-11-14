import { ApiProperty } from '@nestjs/swagger';
import { RECORD_TYPES, type FieldSource, type RecordType } from './field-types';

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

  /** Where the value lives; default `column`. */
  @ApiProperty({
    enum: ['column', 'relation', 'computed'],
    enumName: 'FieldSource',
    required: false,
  })
  source?: FieldSource;
}

export class RecordSchemaDto {
  @ApiProperty({ enum: RECORD_TYPES, enumName: 'RecordType' })
  type: RecordType;

  label: string;

  /** Changes with any change of the schema. */
  version: string;

  @ApiProperty({ type: [RecordFieldDto] })
  fields: RecordFieldDto[];
}
