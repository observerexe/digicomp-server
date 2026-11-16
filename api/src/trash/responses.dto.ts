import { ApiProperty } from '@nestjs/swagger';
import { TRASH_TYPES, type TrashType } from './trash-registry';

export class TrashActorDto {
  id: string;
  name: string;
}

/** A record in the trash. */
export class TrashItemDto {
  @ApiProperty({ enum: TRASH_TYPES, enumName: 'TrashType' })
  type: TrashType;

  id: string;
  title: string;

  /** QR code: equipment, inventory items; null — the type has none. */
  @ApiProperty({ type: String, nullable: true })
  code: string | null;

  deletedAt: Date;

  /** Who deleted it; null — the account is gone. */
  @ApiProperty({ type: TrashActorDto, nullable: true })
  deletedBy: TrashActorDto | null;

  /** When the server deletes it for good. */
  purgeAt: Date;
}

export class TrashListDto {
  @ApiProperty({ type: [TrashItemDto] })
  items: TrashItemDto[];

  total: number;
  page: number;
  limit: number;
}
