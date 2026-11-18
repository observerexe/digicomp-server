import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import type { GameState } from './engine';
import type { CardKind, Effect, PersonalKind } from './kinds';
import type { RoomStatus } from './responses.dto';

/** A card of «Бункер»: a text of one kind, in any number of packs. */
@Entity('bunker_cards')
@Index('IDX_bunker_cards_kind', ['kind'])
@Check(
  'CHK_bunker_cards_kind',
  `"kind" IN ('catastrophe','bunker','threat','profession','biology','health','hobby','phobia','character','baggage','fact','special')`,
)
@Check(
  'CHK_bunker_cards_effect',
  `("kind" = 'special') = ("effect" IS NOT NULL)`,
)
export class BunkerCard {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16 })
  kind: CardKind;

  /** Catastrophe and threat only. */
  @Column({ type: 'varchar', length: 60, default: '' })
  title: string;

  @Column({ type: 'varchar', length: 400 })
  text: string;

  /** Special cards only (kinds.ts, EFFECTS). */
  @Column({ type: 'varchar', length: 16, nullable: true })
  effect: Effect | null;

  @Column({ name: 'effect_kind', type: 'varchar', length: 16, nullable: true })
  effectKind: PersonalKind | null;

  /** null — a card of the built-in pack. */
  @Column({ name: 'author_id', type: 'uuid', nullable: true })
  authorId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'author_id' })
  author?: User | null;

  /** Comes with the app (migration): nobody changes it. */
  @Column({ type: 'boolean', default: false })
  builtin: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('bunker_packs')
export class BunkerPack {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 60 })
  name: string;

  @Column({ type: 'varchar', length: 300, default: '' })
  description: string;

  @Column({ name: 'author_id', type: 'uuid', nullable: true })
  authorId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'author_id' })
  author?: User | null;

  @Column({ type: 'boolean', default: false })
  builtin: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('bunker_pack_cards')
@Index('IDX_bunker_pack_cards_card', ['cardId'])
export class BunkerPackCard {
  @PrimaryColumn({ name: 'pack_id', type: 'uuid' })
  packId: string;

  @PrimaryColumn({ name: 'card_id', type: 'uuid' })
  cardId: string;

  @ManyToOne(() => BunkerPack, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'pack_id' })
  pack?: BunkerPack;

  @ManyToOne(() => BunkerCard, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'card_id' })
  card?: BunkerCard;

  @CreateDateColumn({ name: 'added_at', type: 'timestamptz' })
  addedAt: Date;
}

/** Settings of a room (`bunker_rooms.settings`). */
export type RoomSettings = {
  packIds: string[];
  maxPlayers: number;
  turnSeconds: number | null;
  hostPlays: boolean;
};

/**
 * A room: the lobby, then the game (`state`, see engine.ts), then its end.
 * Removed by the server after 6 hours without an action.
 */
@Entity('bunker_rooms')
@Check('CHK_bunker_rooms_status', `"status" IN ('lobby','playing','finished')`)
export class BunkerRoom {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 60 })
  name: string;

  @Column({ name: 'host_id', type: 'uuid' })
  hostId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'host_id' })
  host?: User;

  @Column({ type: 'varchar', length: 16, default: 'lobby' })
  status: RoomStatus;

  @Column({ type: 'jsonb' })
  settings: RoomSettings;

  /** The game: secret, never sent as is (view.ts). */
  @Column({ type: 'jsonb', nullable: true })
  state: GameState | null;

  /** Last action in the room (not a mere look): the server removes idle rooms. */
  @Column({ name: 'last_action_at', type: 'timestamptz' })
  lastActionAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

/** Who is in a room. One room per person (unique user_id). */
@Entity('bunker_room_members')
@Index('UQ_bunker_room_members_user', ['userId'], { unique: true })
export class BunkerRoomMember {
  @PrimaryColumn({ name: 'room_id', type: 'uuid' })
  roomId: string;

  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => BunkerRoom, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'room_id' })
  room?: BunkerRoom;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @CreateDateColumn({ name: 'joined_at', type: 'timestamptz' })
  joinedAt: Date;

  /** The room's page last asked for news: «у мережі». */
  @Column({ name: 'last_seen_at', type: 'timestamptz' })
  lastSeenAt: Date;
}
