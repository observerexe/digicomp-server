import {
  IsBoolean,
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { NOT_BLANK } from '../points/dto';
import { FaultStatus } from './fault.entities';

export class CreateFaultDto {
  @IsUUID()
  placeId: string;

  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(2000)
  description: string;
}

export class CloseFaultDto {
  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(2000)
  resolution: string;

  /** Return the equipment from maintenance to work. */
  @IsOptional()
  @IsBoolean()
  reactivatePlace?: boolean;
}

export class ListFaultsQuery {
  @IsOptional()
  @IsUUID()
  placeId?: string;

  @IsOptional()
  @IsEnum(FaultStatus)
  status?: FaultStatus;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  @MaxLength(6)
  page?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  @MaxLength(3)
  limit?: string;
}
