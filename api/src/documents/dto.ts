import {
  IsEnum,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AccessScope } from './doc.entity';

export class CreateDocDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  /** Item key of the «document_category» dictionary. */
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  category: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsEnum(AccessScope)
  accessScope?: AccessScope;
}

export class UpdateDocDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  /** Item key of the «document_category» dictionary. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsEnum(AccessScope)
  accessScope?: AccessScope;
}

export class AddVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  changeNote?: string;
}

export class DownloadQuery {
  @IsOptional()
  @IsNumberString({ no_symbols: true })
  @MaxLength(6)
  version?: string;
  /** `1` — show a PDF in the app instead of downloading (other types ignore it). */
  @IsOptional()
  @IsIn(['1'])
  inline?: string;
}
