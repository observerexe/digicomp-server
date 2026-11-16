import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { TRASH_TYPES, type TrashType } from './trash-registry';

export class TrashRecordParams {
  @ApiProperty({ enum: TRASH_TYPES, enumName: 'TrashType' })
  @IsIn(TRASH_TYPES)
  type: TrashType;

  @IsUUID()
  id: string;
}

export class ListTrashQuery {
  @ApiProperty({ enum: TRASH_TYPES, enumName: 'TrashType', required: false })
  @IsOptional()
  @IsIn(TRASH_TYPES)
  type?: TrashType;

  /** Part of the title (or code). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  @MaxLength(6)
  page?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  @MaxLength(3)
  limit?: string;
}
