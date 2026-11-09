import {
  IsEnum,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { NOT_BLANK } from '../points/dto';
import { DisciplineType } from './discipline.entity';

export class IssueDisciplineDto {
  @IsUUID()
  userId: string;

  @IsEnum(DisciplineType)
  type: DisciplineType;

  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(1000)
  reason: string;

  /** Points taken by a fine; required for `fine`, not allowed otherwise. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  amount?: number;
}

export class ListDisciplineQuery {
  @IsOptional()
  @IsUUID()
  userId?: string;

  /** `active` — not revoked, `revoked`, `all` (default). */
  @IsOptional()
  @IsIn(['active', 'revoked', 'all'])
  state?: 'active' | 'revoked' | 'all';

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  @MaxLength(6)
  page?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  @MaxLength(3)
  limit?: string;
}
