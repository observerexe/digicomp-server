import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomInt } from 'crypto';
import { DataSource, EntityManager, In, LessThan } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { Action, assertCan } from '../auth/policy';
import { User } from '../users/user.entity';
import {
  BunkerPack,
  BunkerRoom,
  BunkerRoomMember,
  RoomSettings,
} from './bunker.entities';
import { BunkerCardsService, userRef } from './bunker-cards.service';
import type { CreateRoomDto, RoomActionDto, UpdateRoomDto } from './dto';
import {
  E,
  GameAction,
  GameError,
  GameState,
  apply,
  createGame,
  missingKind,
  removePlayer,
  tick,
} from './engine';
import { MIN_PLAYERS } from './kinds';
import type {
  BunkerRoomDto,
  BunkerRoomListDto,
  BunkerRoomListItemDto,
} from './responses.dto';
import { viewFor } from './view';

type Actor = { id: string; role: string };

/** «У мережі»: the room's page asked for news this recently. */
const ONLINE_MS = 30_000;
/** How often a look marks the member as seen (fewer writes). */
const SEEN_EVERY_MS = 10_000;
/** A room without an action this long is removed. */
export const IDLE_MS = 6 * 60 * 60 * 1000;
const CLEANUP_EVERY_MS = 60 * 60 * 1000;

const rng = (n: number) => randomInt(n);

/** A rule of the game said no: 403 or 409 with its message (errorCode). */
function gameError(e: unknown): never {
  if (e instanceof GameError) {
    throw e.status === 403
      ? new ForbiddenException(e.message)
      : new ConflictException(e.message);
  }
  throw e;
}

/** Rooms of «Бункер»: the lobby, the game (engine.ts), who sees what (view.ts). */
@Injectable()
export class BunkerRoomsService implements OnModuleInit, OnModuleDestroy {
  private logger = new Logger(BunkerRoomsService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectDataSource() private ds: DataSource,
    private audit: AuditService,
    private cards: BunkerCardsService,
  ) {}

  onModuleInit() {
    if (process.env.BUNKER_CLEANUP_DISABLED === 'true') return;
    const run = () =>
      this.cleanup().catch((e: unknown) =>
        this.logger.error(`Room cleanup failed: ${String(e)}`),
      );
    this.timer = setInterval(run, CLEANUP_EVERY_MS);
    this.timer.unref();
    void run();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Removes rooms where nothing happened for 6 hours. Returns how many. */
  async cleanup(now = new Date()) {
    const idle = await this.ds.getRepository(BunkerRoom).find({
      where: { lastActionAt: LessThan(new Date(now.getTime() - IDLE_MS)) },
      select: { id: true, name: true },
    });
    for (const r of idle) {
      await this.ds.transaction(async (m) => {
        await m.delete(BunkerRoom, r.id);
        await this.audit.log(
          {
            action: 'bunker.room_closed',
            entity: 'bunker_room',
            entityId: r.id,
            meta: { name: r.name, reason: 'idle' },
          },
          m,
        );
      });
    }
    return idle.length;
  }

  /** Players of the game to be: members, the host only if they play. */
  private players(
    r: { hostId: string; settings: RoomSettings },
    members: BunkerRoomMember[],
  ) {
    return members
      .filter((x) => r.settings.hostPlays || x.userId !== r.hostId)
      .map((x) => x.userId);
  }

  async list(actor: Actor): Promise<BunkerRoomListDto> {
    const m = this.ds.manager;
    const mine = await m.findOneBy(BunkerRoomMember, { userId: actor.id });
    const rooms = await m.find(BunkerRoom, {
      relations: { host: true },
      order: { createdAt: 'DESC' },
      select: {
        id: true,
        name: true,
        status: true,
        hostId: true,
        settings: true,
        createdAt: true,
        host: { id: true, name: true, avatarUrl: true, color: true },
      },
    });
    // A finished game is seen only by those still in its room.
    const shown = rooms.filter(
      (r) => r.status !== 'finished' || r.id === mine?.roomId,
    );
    const ids = shown.map((r) => r.id);
    const members = ids.length
      ? await m.find(BunkerRoomMember, {
          where: { roomId: In(ids) },
          relations: { user: true },
          order: { joinedAt: 'ASC' },
        })
      : [];
    const states = new Map<string, GameState | null>();
    const playing = shown
      .filter((r) => r.status === 'playing')
      .map((r) => r.id);
    if (playing.length) {
      const rows = await m.find(BunkerRoom, {
        where: { id: In(playing) },
        select: { id: true, state: true },
      });
      for (const r of rows) states.set(r.id, r.state);
    }
    const packIds = [...new Set(shown.flatMap((r) => r.settings.packIds))];
    const packs = await this.cards.packRefs(m, packIds);
    const items: BunkerRoomListItemDto[] = shown.map((r) => {
      const s = states.get(r.id);
      return {
        id: r.id,
        name: r.name,
        status: r.status,
        host: userRef(r.host, r.hostId),
        members: members
          .filter((x) => x.roomId === r.id)
          .map((x) => userRef(x.user, x.userId)),
        maxPlayers: r.settings.maxPlayers,
        packs: r.settings.packIds.flatMap((id) =>
          packs.filter((p) => p.id === id),
        ),
        round: s ? s.round : null,
        alive: s ? s.players.filter((p) => p.out === null).length : null,
      };
    });
    return { items, myRoomId: mine?.roomId ?? null };
  }

  private async room(m: EntityManager, id: string, lock = false) {
    const r = await m.findOne(BunkerRoom, {
      where: { id },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!r) throw new NotFoundException('Bunker room not found');
    return r;
  }

  private members(m: EntityManager, roomId: string) {
    return m.find(BunkerRoomMember, {
      where: { roomId },
      order: { joinedAt: 'ASC' },
    });
  }

  private async packIds(m: EntityManager, ids: string[]) {
    const unique = [...new Set(ids)];
    if (
      unique.length &&
      (await m.countBy(BunkerPack, { id: In(unique) })) !== unique.length
    ) {
      throw new NotFoundException('Bunker pack not found');
    }
    return unique;
  }

  /**
   * Frees the person for a new room: leaves a finished game; a lobby or a
   * game in progress — no (one room at a time).
   */
  private async free(m: EntityManager, userId: string, now: Date) {
    const mine = await m.findOneBy(BunkerRoomMember, { userId });
    if (!mine) return;
    const r = await this.room(m, mine.roomId, true);
    if (r.status !== 'finished')
      throw new ConflictException('Already in another room');
    await this.leaveRoom(m, r, userId, 'left', now);
  }

  async create(dto: CreateRoomDto, actor: Actor) {
    const now = new Date();
    const id = await this.ds.transaction(async (m) => {
      await this.free(m, actor.id, now);
      const settings: RoomSettings = {
        packIds: await this.packIds(m, dto.packIds),
        maxPlayers: dto.maxPlayers,
        turnSeconds: dto.turnSeconds,
        hostPlays: dto.hostPlays,
      };
      const r = await m.save(
        BunkerRoom,
        m.create(BunkerRoom, {
          name: dto.name.trim(),
          hostId: actor.id,
          status: 'lobby',
          settings,
          state: null,
          lastActionAt: now,
        }),
      );
      await m.insert(BunkerRoomMember, {
        roomId: r.id,
        userId: actor.id,
        lastSeenAt: now,
      });
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'bunker.room_created',
          entity: 'bunker_room',
          entityId: r.id,
          meta: { name: r.name },
        },
        m,
      );
      return r.id;
    });
    return this.get(id, actor);
  }

  /** The room as the reader sees it; a turn whose time is up is applied first. */
  async get(id: string, actor: Actor): Promise<BunkerRoomDto> {
    const now = new Date();
    const m = this.ds.manager;
    let r = await this.room(m, id);
    const member = await m.findOneBy(BunkerRoomMember, {
      roomId: id,
      userId: actor.id,
    });
    if (!member) throw new ForbiddenException('Not in this room');
    if (r.state && tick(structuredClone(r.state), now, rng)) {
      r = await this.ds.transaction(async (tm) => {
        const locked = await this.room(tm, id, true);
        if (locked.state && tick(locked.state, now, rng)) {
          await tm.update(BunkerRoom, id, { state: locked.state as object });
        }
        return locked;
      });
    }
    if (now.getTime() - member.lastSeenAt.getTime() > SEEN_EVERY_MS) {
      await m.update(
        BunkerRoomMember,
        { roomId: id, userId: actor.id },
        { lastSeenAt: now },
      );
      member.lastSeenAt = now;
    }
    return this.view(m, r, actor, now);
  }

  private async view(
    m: EntityManager,
    r: BunkerRoom,
    actor: Actor,
    now: Date,
  ): Promise<BunkerRoomDto> {
    const members = await this.members(m, r.id);
    const ids = new Set([
      ...members.map((x) => x.userId),
      ...(r.state?.players.map((p) => p.userId) ?? []),
    ]);
    const users = ids.size
      ? await m.find(User, { where: { id: In([...ids]) } })
      : [];
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      hostId: r.hostId,
      settings: r.settings,
      packs: await this.cards.packRefs(m, r.settings.packIds),
      members: members.map((x) => ({
        userId: x.userId,
        online: now.getTime() - x.lastSeenAt.getTime() < ONLINE_MS,
      })),
      users: [...ids].map((uid) =>
        userRef(
          users.find((u) => u.id === uid),
          uid,
        ),
      ),
      game: r.state ? viewFor(r.state, actor.id) : null,
      now: now.toISOString(),
    };
  }

  /**
   * One change of a room under its row lock: the room's members only (or
   * `outsider`), a timed-out turn applied first, the room marked active.
   */
  private async change(
    id: string,
    actor: Actor,
    fn: (
      m: EntityManager,
      r: BunkerRoom,
      members: BunkerRoomMember[],
      now: Date,
    ) => Promise<void> | void,
    opts: { outsider?: boolean } = {},
  ) {
    const now = new Date();
    return this.ds.transaction(async (m) => {
      const r = await this.room(m, id, true);
      const members = await this.members(m, id);
      if (!opts.outsider && !members.some((x) => x.userId === actor.id)) {
        throw new ForbiddenException('Not in this room');
      }
      if (r.state) tick(r.state, now, rng);
      try {
        await fn(m, r, members, now);
      } catch (e) {
        if (e instanceof HttpException) throw e;
        gameError(e);
      }
      if (!(await m.existsBy(BunkerRoom, { id }))) return null;
      if (r.state?.phase === 'finished' && r.status === 'playing')
        r.status = 'finished';
      await m.update(BunkerRoom, id, {
        name: r.name,
        hostId: r.hostId,
        status: r.status,
        settings: r.settings,
        state: r.state as object | null,
        lastActionAt: now,
      });
      return this.view(m, r, actor, now);
    });
  }

  private host(r: BunkerRoom, actor: Actor) {
    if (r.hostId !== actor.id) throw new ForbiddenException(E.NotHost);
  }

  async update(id: string, dto: UpdateRoomDto, actor: Actor) {
    return this.change(id, actor, async (m, r, members) => {
      this.host(r, actor);
      if (r.status !== 'lobby')
        throw new ConflictException('Game already started');
      if (dto.name !== undefined) r.name = dto.name.trim();
      const s = { ...r.settings };
      if (dto.packIds) s.packIds = await this.packIds(m, dto.packIds);
      if (dto.maxPlayers !== undefined) s.maxPlayers = dto.maxPlayers;
      if (dto.turnSeconds !== undefined) s.turnSeconds = dto.turnSeconds;
      if (dto.hostPlays !== undefined) s.hostPlays = dto.hostPlays;
      if (
        this.players({ hostId: r.hostId, settings: s }, members).length >
        s.maxPlayers
      ) {
        throw new ConflictException('Too many players');
      }
      r.settings = s;
    });
  }

  async join(id: string, actor: Actor) {
    return this.change(
      id,
      actor,
      async (m, r, members, now) => {
        if (members.some((x) => x.userId === actor.id)) return;
        if (r.status !== 'lobby')
          throw new ConflictException('Game already started');
        if (this.players(r, members).length >= r.settings.maxPlayers) {
          throw new ConflictException('Room is full');
        }
        await this.free(m, actor.id, now);
        await m.insert(BunkerRoomMember, {
          roomId: id,
          userId: actor.id,
          lastSeenAt: now,
        });
      },
      { outsider: true },
    );
  }

  /**
   * Out of the room: out of the game too (the eliminations left are spread
   * again); the host's role passes to the next person; an empty room goes.
   */
  private async leaveRoom(
    m: EntityManager,
    r: BunkerRoom,
    userId: string,
    how: 'left' | 'removed',
    now: Date,
  ) {
    await m.delete(BunkerRoomMember, { roomId: r.id, userId });
    if (r.state && r.status === 'playing') {
      removePlayer(r.state, userId, how, now);
      if (r.state.phase === 'finished') r.status = 'finished';
    }
    const rest = await this.members(m, r.id);
    if (!rest.length) {
      await m.delete(BunkerRoom, r.id);
      await this.audit.log(
        {
          actorId: userId,
          action: 'bunker.room_closed',
          entity: 'bunker_room',
          entityId: r.id,
          meta: { name: r.name, reason: 'empty' },
        },
        m,
      );
      return;
    }
    if (r.hostId === userId) {
      // Someone still in the game first, then the one who joined earliest.
      const inGame =
        r.state?.players.filter((p) => p.out === null).map((p) => p.userId) ??
        [];
      r.hostId = (
        rest.find((x) => inGame.includes(x.userId)) ?? rest[0]
      ).userId;
    }
    await m.update(BunkerRoom, r.id, {
      hostId: r.hostId,
      status: r.status,
      state: r.state as object | null,
      lastActionAt: now,
    });
  }

  async leave(id: string, actor: Actor) {
    await this.change(id, actor, (m, r, _members, now) =>
      this.leaveRoom(m, r, actor.id, 'left', now),
    );
    return { ok: true as const };
  }

  /** The host removes someone (written to the audit: an action over another person). */
  async removeMember(id: string, userId: string, actor: Actor) {
    return this.change(id, actor, async (m, r, members, now) => {
      this.host(r, actor);
      if (userId === actor.id)
        throw new BadRequestException('Use leave to leave the room');
      if (!members.some((x) => x.userId === userId))
        throw new NotFoundException('Bunker member not found');
      await this.leaveRoom(m, r, userId, 'removed', now);
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'bunker.player_removed',
          entity: 'bunker_room',
          entityId: id,
          meta: { userId, name: r.name },
        },
        m,
      );
    });
  }

  async passHost(id: string, userId: string, actor: Actor) {
    return this.change(id, actor, (_m, r, members) => {
      this.host(r, actor);
      if (!members.some((x) => x.userId === userId))
        throw new NotFoundException('Bunker member not found');
      r.hostId = userId;
    });
  }

  async start(id: string, actor: Actor) {
    return this.change(id, actor, async (m, r, members, now) => {
      this.host(r, actor);
      if (r.status !== 'lobby')
        throw new ConflictException('Game already started');
      const players = this.players(r, members);
      if (players.length < MIN_PLAYERS)
        throw new ConflictException('Not enough players');
      if (players.length > r.settings.maxPlayers)
        throw new ConflictException('Too many players');
      const pool = await this.cards.pool(m, r.settings.packIds, players.length);
      const kind = missingKind(pool, players.length);
      if (kind)
        throw new ConflictException({ message: 'Not enough cards', kind });
      r.state = createGame(
        { players, pool, turnSeconds: r.settings.turnSeconds },
        now,
        rng,
      );
      r.status = 'playing';
    });
  }

  /** «Зіграти ще раз»: back to the lobby with whoever is in the room. */
  async restart(id: string, actor: Actor) {
    return this.change(id, actor, (_m, r) => {
      this.host(r, actor);
      if (r.status !== 'finished')
        throw new ConflictException('Game is not over');
      r.status = 'lobby';
      r.state = null;
    });
  }

  async act(id: string, dto: RoomActionDto, actor: Actor) {
    const action = toAction(dto);
    return this.change(id, actor, (_m, r, _members, now) => {
      if (r.status === 'lobby' || !r.state)
        throw new ConflictException('Game has not started');
      apply(
        r.state,
        { userId: actor.id, isHost: r.hostId === actor.id },
        action,
        now,
        rng,
      );
    });
  }

  /** Closes the room: its host, or moderation (another's room — to the audit). */
  async close(id: string, actor: Actor) {
    await this.ds.transaction(async (m) => {
      const r = await this.room(m, id, true);
      if (r.hostId !== actor.id) {
        const host = await m.findOneBy(User, { id: r.hostId });
        assertCan(actor, Action.BunkerModerate, {
          target: host ? { id: host.id, role: host.role } : undefined,
        });
      }
      await m.delete(BunkerRoom, id);
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'bunker.room_closed',
          entity: 'bunker_room',
          entityId: id,
          meta: { name: r.name, hostId: r.hostId },
        },
        m,
      );
    });
    return { ok: true as const };
  }
}

function toAction(dto: RoomActionDto): GameAction {
  switch (dto.type) {
    case 'reveal':
      if (!dto.kind) throw new BadRequestException('kind is required');
      return { type: 'reveal', kind: dto.kind };
    case 'vote':
      if (!dto.targetId) throw new BadRequestException('targetId is required');
      return { type: 'vote', targetId: dto.targetId };
    case 'special':
      return { type: 'special', targetId: dto.targetId };
    default:
      return { type: dto.type };
  }
}
