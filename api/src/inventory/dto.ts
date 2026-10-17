import {
  IsDateString,
  IsIn,
  IsNumber,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class ListItemsQuery {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsIn(['true'])
  lowStock?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  @MaxLength(6)
  page?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  @MaxLength(3)
  limit?: string;
}

export class CreateItemDto {
  @Matches(/^[A-Za-z0-9_-]{2,60}$/)
  code: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  category: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  unit?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(1000000)
  quantity?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(1000000)
  minQuantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}

export class UpdateItemDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  unit?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(1000000)
  minQuantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}

export class MovementDto {
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(-1000000)
  @Max(1000000)
  delta: number;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  note: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  idempotencyKey?: string;
}

export class ListMovementsQuery {
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  @MaxLength(6)
  page?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  @MaxLength(3)
  limit?: string;
}
