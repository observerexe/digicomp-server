import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { SmartKind } from './smart-entity.entity';

export class CreateSmartEntityDto {
  @Matches(/^(light|sensor|scene)\.[a-z0-9_]{1,100}$/)
  entityId: string;

  @IsEnum(SmartKind)
  kind: SmartKind;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  room?: string;
}

export class UpdateSmartEntityDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  room?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class LightStateDto {
  @IsBoolean()
  on: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  brightness?: number;
}
