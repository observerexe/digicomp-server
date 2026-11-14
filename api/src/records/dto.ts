import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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
} from 'class-validator';
import { NOT_BLANK } from '../points/dto';
import { EXTRA_LIMITS } from './extra-values';
import { EXTRA_TYPES, type ExtraType } from './field-types';

const BOUND = EXTRA_LIMITS.bound;
const SCALE = { maxDecimalPlaces: EXTRA_LIMITS.scale };

export class CreateFieldDefDto {
  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(100)
  label: string;

  /** Cannot be changed later. */
  @ApiProperty({ enum: EXTRA_TYPES, enumName: 'ExtraFieldType' })
  @IsIn(EXTRA_TYPES)
  type: ExtraType;

  /** Must be filled when a record is created. Default false. */
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  /** enum, list<enum>: key of the dictionary (required for them). Cannot be changed later. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  dictionary?: string;

  /** int, decimal: the least value. */
  @IsOptional()
  @IsNumber(SCALE)
  @Min(-BOUND)
  @Max(BOUND)
  min?: number;

  /** int, decimal: the greatest value. */
  @IsOptional()
  @IsNumber(SCALE)
  @Min(-BOUND)
  @Max(BOUND)
  max?: number;

  /** text: the longest value. Default 200. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(EXTRA_LIMITS.textMax)
  maxLength?: number;

  /** list<enum>: at most this many items. Default 10. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(EXTRA_LIMITS.itemsMax)
  maxItems?: number;
}

export class UpdateFieldDefDto {
  @IsOptional()
  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(100)
  label?: string;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  /** null — no lower bound. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber(SCALE)
  @Min(-BOUND)
  @Max(BOUND)
  min?: number | null;

  /** null — no upper bound. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber(SCALE)
  @Min(-BOUND)
  @Max(BOUND)
  max?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(EXTRA_LIMITS.textMax)
  maxLength?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(EXTRA_LIMITS.itemsMax)
  maxItems?: number;

  /** true — to the archive (values stay, new ones are not taken), false — back. */
  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

export class ReorderFieldDefsDto {
  /** Every field key of the type (archived too), in the new order. */
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  keys: string[];
}
