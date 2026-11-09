import { ApiProperty } from '@nestjs/swagger';

export class BookingUserDto {
  id: string;
  name?: string;

  @ApiProperty({ type: String, nullable: true, required: false })
  avatarUrl?: string | null;
}

export class BookingPlaceDto {
  id: string;
  code?: string;
  title?: string;
}

export class BookingDto {
  id: string;
  startsAt: Date;
  endsAt: Date;
  note: string;
  createdAt: Date;
  cancelled: boolean;

  @ApiProperty({ type: Date, nullable: true })
  cancelledAt: Date | null;

  @ApiProperty({ type: String, nullable: true })
  cancelledById: string | null;

  cancelReason: string;
  user: BookingUserDto;
  place: BookingPlaceDto;
}
