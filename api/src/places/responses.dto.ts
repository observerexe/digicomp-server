import { ApiProperty } from '@nestjs/swagger';
import { PlaceRefDto, UserRefDto } from '../common/responses.dto';
import { PlaceStatus } from './place.entity';

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

export class PlaceSessionRefDto {
  id: string;
  startedAt: Date;
  user: AuthorizationUserDto;
}

export class MyAuthorizationDto {
  /** null — no end date. */
  @ApiProperty({ type: Date, nullable: true })
  expiresAt: Date | null;
}

export class PlaceDto {
  id: string;

  /** QR code, upper case (CNC-1). */
  code: string;

  title: string;
  category: string;
  location: string;
  description: string;

  @ApiProperty({ enum: PlaceStatus, enumName: 'PlaceStatus' })
  status: PlaceStatus;

  needsAuthorization: boolean;

  /** One session at a time. */
  exclusive: boolean;

  createdAt: Date;
  updatedAt: Date;
  inUse: boolean;

  @ApiProperty({ type: [PlaceSessionRefDto] })
  activeSessions: PlaceSessionRefDto[];

  /** The caller's valid authorization, null when there is none. */
  @ApiProperty({ type: MyAuthorizationDto, nullable: true })
  myAuthorization: MyAuthorizationDto | null;
}

export class SessionUserDto {
  id: string;
  name?: string;
}

export class SessionPlaceDto {
  id: string;
  code?: string;
  title?: string;
}

export class WorkSessionDto {
  id: string;
  startedAt: Date;

  @ApiProperty({ type: Date, nullable: true })
  endedAt: Date | null;

  @ApiProperty({ type: String, nullable: true })
  endedById: string | null;

  safetyConfirmed: boolean;
  note: string;
  equipmentState: string;
  endReason: string;

  /** Closed by the server after SESSION_AUTO_CLOSE_HOURS. */
  autoClosed: boolean;

  user: SessionUserDto;
  place: SessionPlaceDto;
}

export class WorkSessionListDto {
  @ApiProperty({ type: [WorkSessionDto] })
  items: WorkSessionDto[];

  total: number;
  page: number;
  limit: number;
}

/** «Останні сеанси» on the equipment page: visible to everyone, no notes. */
export class RecentSessionDto {
  id: string;
  startedAt: Date;

  @ApiProperty({ type: Date, nullable: true })
  endedAt: Date | null;

  autoClosed: boolean;
  user: UserRefDto;
}
