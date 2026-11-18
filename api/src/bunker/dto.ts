import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  CARD_KINDS,
  EFFECTS,
  LONG_TEXT_MAX,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PERSONAL_KINDS,
  TITLE_MAX,
  TURN_SECONDS,
} from './kinds';
import type { CardKind, Effect, PersonalKind } from './kinds';

const kindProp = { enum: CARD_KINDS, enumName: 'BunkerCardKind' } as const;
const personalProp = {
  enum: PERSONAL_KINDS,
  enumName: 'BunkerPersonalKind',
} as const;
const effectProp = { enum: EFFECTS, enumName: 'BunkerEffect' } as const;

export class ListCardsQuery {
  @IsOptional()
  @ApiProperty({ ...kindProp, required: false })
  @IsIn(CARD_KINDS)
  kind?: CardKind;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** Only the reader's cards. */
  @IsOptional()
  @IsIn(['true'])
  mine?: string;

  /** Leave out the cards of this pack. */
  @IsOptional()
  @IsUUID()
  notInPack?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  @MaxLength(6)
  page?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  @MaxLength(3)
  limit?: string;
}

/** A card's fields; what fits which kind — `cardProblem` (cards.ts). */
export class CardFieldsDto {
  @ApiProperty(kindProp)
  @IsIn(CARD_KINDS)
  kind: CardKind;

  /** Catastrophe and threat: required; other kinds: none. */
  @IsOptional()
  @IsString()
  @MaxLength(TITLE_MAX)
  title?: string;

  /** Up to 140 characters (catastrophe and threat — 400). */
  @IsString()
  @MinLength(1)
  @MaxLength(LONG_TEXT_MAX)
  text: string;

  /** Special cards: what the card does. */
  @IsOptional()
  @ApiProperty({ ...effectProp, required: false, nullable: true })
  @ValidateIf((o: CardFieldsDto) => o.effect !== null)
  @IsIn(EFFECTS)
  effect?: Effect | null;

  /** swap, replace, reveal_other: the kind of personal card. */
  @IsOptional()
  @ApiProperty({ ...personalProp, required: false, nullable: true })
  @ValidateIf((o: CardFieldsDto) => o.effectKind !== null)
  @IsIn(PERSONAL_KINDS)
  effectKind?: PersonalKind | null;
}

export class CreateCardDto extends CardFieldsDto {
  /** Add the new card to this pack at once (it must be the reader's to change). */
  @IsOptional()
  @IsUUID()
  packId?: string;
}

export class UpdateCardDto {
  @IsOptional()
  @ApiProperty({ ...kindProp, required: false })
  @IsIn(CARD_KINDS)
  kind?: CardKind;

  @IsOptional()
  @IsString()
  @MaxLength(TITLE_MAX)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(LONG_TEXT_MAX)
  text?: string;

  @IsOptional()
  @ApiProperty({ ...effectProp, required: false, nullable: true })
  @ValidateIf((o: UpdateCardDto) => o.effect !== null)
  @IsIn(EFFECTS)
  effect?: Effect | null;

  @IsOptional()
  @ApiProperty({ ...personalProp, required: false, nullable: true })
  @ValidateIf((o: UpdateCardDto) => o.effectKind !== null)
  @IsIn(PERSONAL_KINDS)
  effectKind?: PersonalKind | null;
}

export class CreatePackDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  /** «Копія»: the new pack holds the same cards as this one. */
  @IsOptional()
  @IsUUID()
  copyOf?: string;
}

export class UpdatePackDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;
}

export class PackCardsDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  cardIds: string[];
}

export class ImportPackDto {
  @ApiProperty({ enum: ['digicomp-bunker-pack'] })
  @IsIn(['digicomp-bunker-pack'])
  format: 'digicomp-bunker-pack';

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CardFieldsDto)
  @ApiProperty({ type: [CardFieldsDto] })
  cards: CardFieldsDto[];
}

export class RoomSettingsInputDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name: string;

  /** Packs to deal from; what they lack comes from the built-in one. */
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  packIds: string[];

  @IsInt()
  @Min(MIN_PLAYERS)
  @Max(MAX_PLAYERS)
  maxPlayers: number;

  /** 30, 60 or 120; null — no timer. */
  @ApiProperty({ type: Number, nullable: true, enum: TURN_SECONDS })
  @ValidateIf((o: RoomSettingsInputDto) => o.turnSeconds !== null)
  @IsIn(TURN_SECONDS)
  turnSeconds: number | null;

  @IsBoolean()
  hostPlays: boolean;
}

export class CreateRoomDto extends RoomSettingsInputDto {}

export class UpdateRoomDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  packIds?: string[];

  @IsOptional()
  @IsInt()
  @Min(MIN_PLAYERS)
  @Max(MAX_PLAYERS)
  maxPlayers?: number;

  @IsOptional()
  @ApiProperty({
    type: Number,
    nullable: true,
    enum: TURN_SECONDS,
    required: false,
  })
  @ValidateIf((o: UpdateRoomDto) => o.turnSeconds !== null)
  @IsIn(TURN_SECONDS)
  turnSeconds?: number | null;

  @IsOptional()
  @IsBoolean()
  hostPlays?: boolean;
}

export class PassHostDto {
  @IsUUID()
  userId: string;
}

export const ACTION_TYPES = [
  'reveal',
  'end_turn',
  'skip_turn',
  'start_vote',
  'vote',
  'close_vote',
  'next_round',
  'special',
] as const;

/** A move in the game: reveal needs `kind`, vote needs `targetId`. */
export class RoomActionDto {
  @ApiProperty({ enum: ACTION_TYPES, enumName: 'BunkerActionType' })
  @IsIn(ACTION_TYPES)
  type: (typeof ACTION_TYPES)[number];

  @IsOptional()
  @ApiProperty({ ...personalProp, required: false })
  @IsIn(PERSONAL_KINDS)
  kind?: PersonalKind;

  /** The player voted against, or the one a special card acts on. */
  @IsOptional()
  @IsUUID()
  targetId?: string;
}
