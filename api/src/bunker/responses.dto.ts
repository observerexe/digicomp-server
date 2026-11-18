import { ApiProperty } from '@nestjs/swagger';
import { UserRefDto } from '../common/responses.dto';
import { CARD_KINDS, EFFECTS, PERSONAL_KINDS } from './kinds';
import type { CardKind, Effect, PersonalKind } from './kinds';

const kindProp = { enum: CARD_KINDS, enumName: 'BunkerCardKind' } as const;
const personalProp = {
  enum: PERSONAL_KINDS,
  enumName: 'BunkerPersonalKind',
} as const;
const effectProp = { enum: EFFECTS, enumName: 'BunkerEffect' } as const;

export const ROOM_STATUSES = ['lobby', 'playing', 'finished'] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];
const statusProp = {
  enum: ROOM_STATUSES,
  enumName: 'BunkerRoomStatus',
} as const;

export const PHASES = ['turns', 'discussion', 'voting', 'finished'] as const;

export const LOG_TYPES = [
  'round',
  'reveal',
  'timeout',
  'skip',
  'vote',
  'tie',
  'out',
  'lot',
  'special',
  'left',
  'removed',
  'finished',
] as const;

export class BunkerCardDto {
  id: string;

  @ApiProperty(kindProp)
  kind: CardKind;

  /** Catastrophe and threat only; '' for the rest. */
  title: string;

  text: string;

  /** Special cards only. */
  @ApiProperty({ ...effectProp, nullable: true })
  effect: Effect | null;

  /** The kind of personal card swap, replace and reveal_other act on. */
  @ApiProperty({ ...personalProp, nullable: true })
  effectKind: PersonalKind | null;

  /** null — a card of the built-in pack. */
  @ApiProperty({ type: UserRefDto, nullable: true })
  author: UserRefDto | null;

  builtin: boolean;

  /** The reader may change or delete it (own, or moderation). */
  canEdit: boolean;

  /** Packs that hold the card. */
  packCount: number;

  updatedAt: Date;
}

export class BunkerCardListDto {
  @ApiProperty({ type: [BunkerCardDto] })
  items: BunkerCardDto[];

  total: number;
  page: number;
  limit: number;
}

export class BunkerKindCountDto {
  @ApiProperty(kindProp)
  kind: CardKind;

  count: number;
}

export class BunkerPackDto {
  id: string;
  name: string;
  description: string;

  @ApiProperty({ type: UserRefDto, nullable: true })
  author: UserRefDto | null;

  /** The pack that comes with the app: read only, can be copied. */
  builtin: boolean;

  canEdit: boolean;
  cardCount: number;

  /** Cards of each kind (every kind, zeros too). */
  @ApiProperty({ type: [BunkerKindCountDto] })
  counts: BunkerKindCountDto[];

  updatedAt: Date;
}

export class BunkerPackListDto {
  @ApiProperty({ type: [BunkerPackDto] })
  items: BunkerPackDto[];
}

export class BunkerPackDetailDto extends BunkerPackDto {
  @ApiProperty({ type: [BunkerCardDto] })
  cards: BunkerCardDto[];
}

/** A pack as a file: «Експорт» gives it, «Імпорт» takes it. */
export class BunkerPackFileCardDto {
  @ApiProperty(kindProp)
  kind: CardKind;

  title: string;
  text: string;

  @ApiProperty({ ...effectProp, nullable: true })
  effect: Effect | null;

  @ApiProperty({ ...personalProp, nullable: true })
  effectKind: PersonalKind | null;
}

export class BunkerPackFileDto {
  @ApiProperty({ enum: ['digicomp-bunker-pack'] })
  format: 'digicomp-bunker-pack';

  name: string;
  description: string;

  @ApiProperty({ type: [BunkerPackFileCardDto] })
  cards: BunkerPackFileCardDto[];
}

export class BunkerPackRefDto {
  id: string;
  name: string;
}

export class BunkerRoomSettingsDto {
  /** Packs the cards are dealt from; what they lack comes from the built-in one. */
  packIds: string[];

  maxPlayers: number;

  /** Seconds for a turn; null — no timer. */
  @ApiProperty({ type: Number, nullable: true })
  turnSeconds: number | null;

  /** The host plays too (false — only leads the game). */
  hostPlays: boolean;
}

export class BunkerRoomListItemDto {
  id: string;
  name: string;

  @ApiProperty(statusProp)
  status: RoomStatus;

  host: UserRefDto;

  @ApiProperty({ type: [UserRefDto] })
  members: UserRefDto[];

  maxPlayers: number;

  @ApiProperty({ type: [BunkerPackRefDto] })
  packs: BunkerPackRefDto[];

  /** Playing: the round; otherwise null. */
  @ApiProperty({ type: Number, nullable: true })
  round: number | null;

  /** Playing: still in the game. */
  @ApiProperty({ type: Number, nullable: true })
  alive: number | null;
}

export class BunkerRoomListDto {
  @ApiProperty({ type: [BunkerRoomListItemDto] })
  items: BunkerRoomListItemDto[];

  /** The room the reader is in. */
  @ApiProperty({ type: String, nullable: true })
  myRoomId: string | null;
}

export class BunkerMemberDto {
  userId: string;

  /** The page of the room asked for news in the last 30 seconds. */
  online: boolean;
}

export class BunkerSeenCardDto {
  @ApiProperty(personalProp)
  kind: PersonalKind;

  /** null — closed. */
  @ApiProperty({ type: String, nullable: true })
  text: string | null;
}

export class BunkerSpecialDto {
  text: string;

  @ApiProperty(effectProp)
  effect: Effect;

  @ApiProperty({ ...personalProp, nullable: true })
  effectKind: PersonalKind | null;
}

export class BunkerPlayerDto {
  userId: string;

  /** Round the player left the game in; null — still in. */
  @ApiProperty({ type: Number, nullable: true })
  out: number | null;

  /** Left the room or was removed (not voted out). */
  left: boolean;

  @ApiProperty({ type: [BunkerSeenCardDto] })
  cards: BunkerSeenCardDto[];

  specialUsed: boolean;

  /** Shown to all once used, and at the end of the game. */
  @ApiProperty({ type: BunkerSpecialDto, nullable: true })
  special: BunkerSpecialDto | null;
}

export class BunkerMyCardDto {
  @ApiProperty(personalProp)
  kind: PersonalKind;

  text: string;
  revealed: boolean;
}

export class BunkerMeDto {
  @ApiProperty({ type: [BunkerMyCardDto] })
  cards: BunkerMyCardDto[];

  special: BunkerSpecialDto;
  specialUsed: boolean;
}

export class BunkerTableCardDto {
  title: string;
  text: string;
}

export class BunkerFeatureDto {
  /** null — opens in `round`. */
  @ApiProperty({ type: String, nullable: true })
  text: string | null;

  round: number;
}

export class BunkerTurnDto {
  userId: string;

  /** The speaker has revealed this turn's card. */
  revealed: boolean;

  @ApiProperty({ type: String, nullable: true })
  deadline: string | null;
}

export class BunkerVoteDto {
  candidates: string[];

  /** Who has voted (not for whom: the vote is secret). */
  voted: string[];

  @ApiProperty({ type: String, nullable: true })
  myVote: string | null;

  /** A re-vote between the tied. */
  runoff: boolean;

  /** The reader's vote counts twice. */
  double: boolean;
}

export class BunkerTallyDto {
  userId: string;
  votes: number;
}

export class BunkerLogDto {
  at: string;

  @ApiProperty({ enum: LOG_TYPES, enumName: 'BunkerLogType' })
  type: (typeof LOG_TYPES)[number];

  round: number;

  @ApiProperty({ required: false })
  userId?: string;

  @ApiProperty({ required: false })
  targetId?: string;

  @ApiProperty({ ...personalProp, required: false })
  kind?: PersonalKind;

  @ApiProperty({ required: false })
  text?: string;

  @ApiProperty({ ...effectProp, required: false })
  effect?: Effect;

  @ApiProperty({ type: [BunkerTallyDto], required: false })
  tally?: BunkerTallyDto[];
}

export class BunkerGameDto {
  round: number;

  @ApiProperty({ enum: PHASES, enumName: 'BunkerPhase' })
  phase: (typeof PHASES)[number];

  /** Places in the bunker. */
  capacity: number;

  /** Eliminations left in each round (index 0 — round 1). */
  schedule: number[];

  stayMonths: number;

  catastrophe: BunkerTableCardDto;

  @ApiProperty({ type: [BunkerFeatureDto] })
  bunker: BunkerFeatureDto[];

  /** Opens at the end of the game. */
  @ApiProperty({ type: BunkerTableCardDto, nullable: true })
  threat: BunkerTableCardDto | null;

  @ApiProperty({ type: [BunkerPlayerDto] })
  players: BunkerPlayerDto[];

  /** The reader's own cards; null — not playing (the host who only leads). */
  @ApiProperty({ type: BunkerMeDto, nullable: true })
  me: BunkerMeDto | null;

  @ApiProperty({ type: BunkerTurnDto, nullable: true })
  turn: BunkerTurnDto | null;

  /** Still to speak this round, the speaker first. */
  queue: string[];

  @ApiProperty({ type: BunkerVoteDto, nullable: true })
  vote: BunkerVoteDto | null;

  /** Protected from votes this round. */
  immune: string[];

  @ApiProperty({ type: [BunkerLogDto] })
  log: BunkerLogDto[];
}

export class BunkerRoomDto {
  id: string;
  name: string;

  @ApiProperty(statusProp)
  status: RoomStatus;

  hostId: string;

  settings: BunkerRoomSettingsDto;

  @ApiProperty({ type: [BunkerPackRefDto] })
  packs: BunkerPackRefDto[];

  /** In the room now, in the order they joined. */
  @ApiProperty({ type: [BunkerMemberDto] })
  members: BunkerMemberDto[];

  /** Everyone the room names: members and players who left. */
  @ApiProperty({ type: [UserRefDto] })
  users: UserRefDto[];

  @ApiProperty({ type: BunkerGameDto, nullable: true })
  game: BunkerGameDto | null;

  /** Server time: the turn timer counts from it. */
  now: string;
}
