import { ApiProperty } from '@nestjs/swagger';
import { PALETTE, type PaletteColor } from './palette';

export class DictionaryItemDto {
  id: string;

  /** Stored in records; never changes. */
  key: string;

  title: string;

  @ApiProperty({ enum: PALETTE, enumName: 'PaletteColor' })
  color: PaletteColor;

  position: number;

  /** Not offered for new values; old records keep it. */
  archived: boolean;
}

export class DictionaryDto {
  id: string;

  /** Modules and templates refer to the dictionary by key; never changes. */
  key: string;

  title: string;

  /** A module relies on it: it cannot be deleted. */
  required: boolean;

  /** In display order, archived included. */
  @ApiProperty({ type: [DictionaryItemDto] })
  items: DictionaryItemDto[];

  createdAt: Date;
  updatedAt: Date;
}
