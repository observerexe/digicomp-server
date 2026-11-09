import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateBookingDto {
  @IsUUID()
  placeId: string;

  @IsDateString()
  startsAt: string;

  @IsDateString()
  endsAt: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CancelBookingDto {
  /** Required when cancelling someone else's booking. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** Calendar range; default from today −1 day to +14 days, max 62 days. */
export class ListBookingsQuery {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
