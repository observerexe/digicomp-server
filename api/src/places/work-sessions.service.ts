import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  DataSource,
  FindOptionsWhere,
  IsNull,
  LessThanOrEqual,
  MoreThanOrEqual,
  Not,
  Repository,
} from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { Action, assertCan, can } from '../auth/policy';
import { Booking } from '../bookings/booking.entity';
import {
  EndSessionDto,
  ExportSessionsQuery,
  ListSessionsQuery,
  StartSessionDto,
} from './dto';
import { LogRow, sessionsCsv, sessionsReportHtml } from './session-log';
import { PlaceAuthorization } from './place-authorization.entity';
import { Place, PlaceStatus } from './place.entity';
import { authIsValid, PlacesService } from './places.service';
import { WorkSession } from './work-session.entity';
import type {
  RecentSessionDto,
  WorkSessionDto,
  WorkSessionListDto,
} from './responses.dto';

type Actor = { id: string; role: string };

/** Sessions longer than this are closed by the server (forgotten «Завершити»). */
export function autoCloseHours() {
  const v = Number(process.env.SESSION_AUTO_CLOSE_HOURS ?? 12);
  return Number.isFinite(v) && v > 0 ? v : 12;
}

const AUTO_CLOSE_EVERY_MS = 10 * 60 * 1000;
const AUTO_CLOSE_REASON = 'закрито автоматично';
/** Upper bound for one export, protects the server from huge reports. */
export const EXPORT_MAX_ROWS = 5000;

function isUniqueViolation(e: unknown) {
  const err = e as { code?: string; driverError?: { code?: string } };
  return err?.code === '23505' || err?.driverError?.code === '23505';
}

function toView(s: WorkSession): WorkSessionDto {
  return {
    id: s.id,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    endedById: s.endedById,
    safetyConfirmed: s.safetyConfirmed,
    note: s.note,
    equipmentState: s.equipmentState,
    endReason: s.endReason,
    autoClosed: s.autoClosed,
    user: s.user ? { id: s.user.id, name: s.user.name } : { id: s.userId },
    place: s.place
      ? { id: s.place.id, code: s.place.code, title: s.place.title }
      : { id: s.placeId },
  };
}

@Injectable()
export class WorkSessionsService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private logger = new Logger('WorkSessions');

  constructor(
    @InjectRepository(WorkSession) private repo: Repository<WorkSession>,
    @InjectDataSource() private ds: DataSource,
    private places: PlacesService,
    private audit: AuditService,
  ) {}

  onModuleInit() {
    if (process.env.SESSION_AUTO_CLOSE_DISABLED === 'true') return;
    const run = () =>
      this.autoCloseStale().catch((e: unknown) =>
        this.logger.error(`Auto-close failed: ${String(e)}`),
      );
    this.timer = setInterval(run, AUTO_CLOSE_EVERY_MS);
    this.timer.unref();
    void run();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Closes sessions older than the limit. The end is set to start + limit,
   * so the log does not show days of work; marked auto_closed.
   */
  async autoCloseStale(now = new Date()) {
    const hours = autoCloseHours();
    return this.ds.transaction(async (m) => {
      const rows = await m.query<
        [{ id: string; user_id: string; place_id: string }[], number]
      >(
        `UPDATE work_sessions
         SET ended_at = started_at + make_interval(hours => $1::int),
             auto_closed = true,
             end_reason = $3
         WHERE ended_at IS NULL
           AND started_at + make_interval(hours => $1::int) <= $2
         RETURNING id, user_id, place_id`,
        [hours, now, AUTO_CLOSE_REASON],
      );
      const closed = rows[0];
      for (const r of closed) {
        await this.audit.log(
          {
            action: 'session.auto_closed',
            entity: 'session',
            entityId: r.id,
            meta: { userId: r.user_id, placeId: r.place_id, hours },
          },
          m,
        );
      }
      if (closed.length) {
        this.logger.log(`Auto-closed ${closed.length} session(s)`);
      }
      return closed.length;
    });
  }

  async start(idOrCode: string, dto: StartSessionDto, actor: Actor) {
    const found = await this.places.resolve(idOrCode);
    try {
      return await this.ds.transaction(async (m) => {
        const place = await m.findOne(Place, {
          where: { id: found.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!place) throw new NotFoundException('Place not found');

        if (dto.idempotencyKey) {
          const prev = await m.findOne(WorkSession, {
            where: { userId: actor.id, idempotencyKey: dto.idempotencyKey },
            relations: { user: true, place: true },
          });
          if (prev) return toView(prev);
        }
        if (place.status !== PlaceStatus.Active) {
          throw new ConflictException('Place is not available');
        }
        // Someone else's booking covers now: the slot is theirs.
        if (!can(actor, Action.SessionsIgnoreBooking)) {
          const now = new Date();
          const foreign = await m
            .createQueryBuilder(Booking, 'b')
            .where('b.placeId = :pid', { pid: place.id })
            .andWhere('b.cancelledAt IS NULL')
            .andWhere('b.startsAt <= :now AND b.endsAt > :now', { now })
            .andWhere('b.userId <> :me', { me: actor.id })
            .getExists();
          if (foreign) throw new ConflictException('Place is booked');
        }
        if (!dto.safetyConfirmed) {
          throw new BadRequestException('Safety confirmation required');
        }
        if (
          place.needsAuthorization &&
          !can(actor, Action.SessionsStart, { authorized: false })
        ) {
          const auth = await m.findOneBy(PlaceAuthorization, {
            userId: actor.id,
            placeId: place.id,
          });
          assertCan(actor, Action.SessionsStart, {
            authorized: authIsValid(auth),
          });
        }
        const mine = await m.findOneBy(WorkSession, {
          userId: actor.id,
          endedAt: IsNull(),
        });
        if (mine) {
          throw new ConflictException('You already have an active session');
        }
        if (place.exclusive) {
          const busy = await m.countBy(WorkSession, {
            placeId: place.id,
            endedAt: IsNull(),
          });
          if (busy > 0) throw new ConflictException('Place is in use');
        }
        const saved = await m.save(
          WorkSession,
          m.create(WorkSession, {
            userId: actor.id,
            placeId: place.id,
            startedAt: new Date(),
            endedAt: null,
            endedById: null,
            safetyConfirmed: true,
            note: dto.note ?? '',
            idempotencyKey: dto.idempotencyKey ?? null,
          }),
        );
        await this.audit.log(
          {
            actorId: actor.id,
            action: 'session.started',
            entity: 'session',
            entityId: saved.id,
            meta: { placeId: place.id, code: place.code },
          },
          m,
        );
        const full = await m.findOneOrFail(WorkSession, {
          where: { id: saved.id },
          relations: { user: true, place: true },
        });
        return toView(full);
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException('You already have an active session');
      }
      throw e;
    }
  }

  /** Last 10 sessions on a place for everyone: who, when, how long. */
  async recent(idOrCode: string, actor: Actor): Promise<RecentSessionDto[]> {
    const place = await this.places.get(idOrCode, actor);
    const rows = await this.repo.find({
      where: { placeId: place.id },
      relations: { user: true },
      order: { startedAt: 'DESC' },
      take: 10,
    });
    return rows.map((s) => ({
      id: s.id,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      autoClosed: s.autoClosed,
      user: {
        id: s.userId,
        name: s.user?.name ?? null,
        avatarUrl: s.user?.avatarUrl ?? null,
      },
    }));
  }

  async end(id: string, dto: EndSessionDto, actor: Actor) {
    return this.ds.transaction(async (m) => {
      const s = await m.findOne(WorkSession, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!s) throw new NotFoundException('Session not found');
      if (s.endedAt) throw new ConflictException('Session already ended');
      const own = s.userId === actor.id;
      if (!own) {
        if (!can(actor, Action.SessionsEndOther)) {
          throw new ForbiddenException('Not your session');
        }
        if (!dto.reason?.trim()) {
          throw new BadRequestException(
            'Reason is required to end another user session',
          );
        }
      }
      s.endedAt = new Date();
      s.endedById = actor.id;
      if (dto.note !== undefined) s.note = dto.note;
      s.equipmentState = dto.equipmentState ?? '';
      s.endReason = own ? '' : dto.reason!.trim();
      await m.save(WorkSession, s);
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'session.ended',
          entity: 'session',
          entityId: s.id,
          meta: { forced: !own, reason: s.endReason },
        },
        m,
      );
      const full = await m.findOneOrFail(WorkSession, {
        where: { id },
        relations: { user: true, place: true },
      });
      return toView(full);
    });
  }

  async list(q: ListSessionsQuery, actor: Actor): Promise<WorkSessionListDto> {
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(q.limit ?? 50)));
    const where: FindOptionsWhere<WorkSession> = {};
    if (can(actor, Action.SessionsReadAll)) {
      if (q.userId) where.userId = q.userId;
    } else {
      where.userId = actor.id;
    }
    if (q.placeId) where.placeId = q.placeId;
    if (q.from && q.to) {
      where.startedAt = Between(new Date(q.from), new Date(q.to));
    } else if (q.from) {
      where.startedAt = MoreThanOrEqual(new Date(q.from));
    } else if (q.to) {
      where.startedAt = LessThanOrEqual(new Date(q.to));
    }
    if (q.active !== undefined) {
      where.endedAt = q.active === 'true' ? IsNull() : Not(IsNull());
    }
    const [rows, total] = await this.repo.findAndCount({
      where,
      relations: { user: true, place: true },
      order: { startedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items: rows.map(toView), total, page, limit };
  }

  /** [from, to) of the export; default — current month in Kyiv time. */
  private async period(q: ExportSessionsQuery) {
    if (q.from && q.to) return { from: new Date(q.from), to: new Date(q.to) };
    const [r] = await this.ds.query<{ f: Date; t: Date }[]>(
      `SELECT (date_trunc('month', now() AT TIME ZONE 'Europe/Kyiv')) AT TIME ZONE 'Europe/Kyiv' AS f,
              (date_trunc('month', now() AT TIME ZONE 'Europe/Kyiv') + interval '1 month') AT TIME ZONE 'Europe/Kyiv' AS t`,
    );
    return {
      from: q.from ? new Date(q.from) : r.f,
      to: q.to ? new Date(q.to) : r.t,
    };
  }

  /** Rows for CSV and the print page, ordered by start. */
  async logRows(q: ExportSessionsQuery) {
    const { from, to } = await this.period(q);
    if (to <= from) throw new BadRequestException('Invalid period');
    const qb = this.repo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.user', 'u')
      .leftJoinAndSelect('s.place', 'p')
      .where('s.startedAt >= :from AND s.startedAt < :to', { from, to })
      .orderBy('s.startedAt', 'ASC')
      .addOrderBy('s.id', 'ASC')
      .take(EXPORT_MAX_ROWS + 1);
    if (q.placeId) qb.andWhere('s.placeId = :pid', { pid: q.placeId });
    if (q.userId) qb.andWhere('s.userId = :uid', { uid: q.userId });
    const sessions = await qb.getMany();
    if (sessions.length > EXPORT_MAX_ROWS) {
      throw new BadRequestException('Too many rows, narrow the period');
    }
    const enders = new Map<string, string>();
    const ids = [
      ...new Set(sessions.map((s) => s.endedById).filter(Boolean)),
    ] as string[];
    if (ids.length) {
      const users = await this.ds.query<{ id: string; name: string }[]>(
        'SELECT id, name FROM users WHERE id = ANY($1)',
        [ids],
      );
      for (const u of users) enders.set(u.id, u.name);
    }
    const rows: LogRow[] = sessions.map((s) => ({
      placeTitle: s.place.title,
      placeCode: s.place.code,
      userName: s.user.name,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      endedByName: s.endedById ? (enders.get(s.endedById) ?? null) : null,
      endedByOther: !!s.endedById && s.endedById !== s.userId,
      endReason: s.endReason,
      autoClosed: s.autoClosed,
    }));
    const filters: string[] = [];
    if (q.placeId && sessions[0])
      filters.push(`Обладнання: ${sessions[0].place.title}`);
    else if (q.placeId) filters.push('Фільтр за обладнанням');
    if (q.userId && sessions[0])
      filters.push(`Особа: ${sessions[0].user.name}`);
    else if (q.userId) filters.push('Фільтр за особою');
    return { rows, from, to, filters };
  }

  async exportCsv(q: ExportSessionsQuery) {
    const { rows } = await this.logRows(q);
    return sessionsCsv(rows);
  }

  async reportHtml(q: ExportSessionsQuery) {
    const { rows, from, to, filters } = await this.logRows(q);
    return sessionsReportHtml(rows, {
      from,
      to,
      filters,
      generatedAt: new Date(),
    });
  }
}
