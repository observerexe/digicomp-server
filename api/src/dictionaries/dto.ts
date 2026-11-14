import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PALETTE, type PaletteColor } from './palette';

const TITLE = /\S/;

export class CreateDictionaryDto {
  @IsString()
  @MaxLength(100)
  @Matches(TITLE)
  title: string;
}

export class UpdateDictionaryDto {
  @IsString()
  @MaxLength(100)
  @Matches(TITLE)
  title: string;
}

export class CreateDictionaryItemDto {
  @IsString()
  @MaxLength(100)
  @Matches(TITLE)
  title: string;

  /** Default gray. */
  @IsOptional()
  @IsIn(PALETTE)
  color?: PaletteColor;
}

export class UpdateDictionaryItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(TITLE)
  title?: string;

  @IsOptional()
  @IsIn(PALETTE)
  color?: PaletteColor;

  /** true — to the archive, false — back. */
  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

export class ReorderDictionaryItemsDto {
  /** Every item key of the dictionary (archived too), in the new order. */
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  keys: string[];
}
