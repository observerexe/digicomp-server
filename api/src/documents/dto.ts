import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { RECORD_TYPES, type RecordType } from '../records/field-types';
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

export class ListDocsQuery {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** Item key of the «document_category» dictionary. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  category?: string;

  /** With `linkedId`: only documents linked with this record (`/links`). */
  @ApiProperty({ enum: RECORD_TYPES, enumName: 'RecordType', required: false })
  @ValidateIf((q: ListDocsQuery) => q.linkedId !== undefined)
  @IsIn(RECORD_TYPES)
  linkedType?: RecordType;

  @ValidateIf((q: ListDocsQuery) => q.linkedType !== undefined)
  @IsUUID()
  linkedId?: string;

  @IsOptional()
  @IsIn(['true'])
  archived?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  @MaxLength(6)
  page?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  @MaxLength(3)
  limit?: string;
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
