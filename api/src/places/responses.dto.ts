import { ApiProperty } from '@nestjs/swagger';
import { PlaceRefDto } from '../common/responses.dto';

export class AuthorizationUserDto {
  id: string;
  name: string;
}

/** Permission to work on a piece of equipment («допуск»). */
export class AuthorizationDto {
  id: string;
  user: AuthorizationUserDto;
  place: PlaceRefDto;
  grantedById: string;
  grantedAt: Date;

  /** null — no end date. */
  @ApiProperty({ type: Date, nullable: true })
  expiresAt: Date | null;

  expired: boolean;
  note: string;
}
