import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { Action, Actor, assertCan } from '../auth/policy';
import { User } from '../users/user.entity';
import { AwardPointsDto, LeaderboardQuery, RevokeDto } from './dto';
import { PointsEntry, PointsKind } from './points-entry.entity';
import type { LeaderboardRowDto, PointsHistoryDto } from './responses.dto';

export const PointsErrors = {
  UnknownMember: 'Unknown or inactive member',
  AlreadyRevoked: 'Already revoked',
  NotRevocable: 'Entry cannot be revoked',
} as const;

/** Month boundaries for the leaderboard. */
export const POINTS_TIMEZONE = 'Europe/Kyiv';

type HistoryRow = {
  id: string;
  kind: PointsKind;
  amount: number;
  reason: string;
  taskId: string | null;
  taskTitle: string | null;
  reversesId: string | null;
  createdById: string | null;
  createdByName: string | null;
  revoked: boolean;
  createdAt: Date;
};

@Injectable()
export class PointsService {
  constructor(
    @InjectDataSource() private ds: DataSource,
    private audit: AuditService,
  ) {}

  async balance(userId: string, m: EntityManager = this.ds.manager) {
    const [row] = await m.query<{ total: number }[]>(
      'SELECT COALESCE(SUM(amount),0)::int AS total FROM points_ledger WHERE user_id = $1',
      [userId],
    );
    return row.total;
  }

  /** Balance and the last 100 ledger entries of a user. */
  async history(userId: string): Promise<PointsHistoryDto> {
    const rows = await this.ds.query<HistoryRow[]>(
      `SELECT p.id, p.kind, p.amount, p.reason, p.task_id AS "taskId",
              t.title AS "taskTitle", p.reverses_id AS "reversesId",
              p.created_by_id AS "createdById", c.name AS "createdByName",
              EXISTS (SELECT 1 FROM points_ledger r WHERE r.reverses_id = p.id) AS revoked,
              p.created_at AS "createdAt"
       FROM points_ledger p
       LEFT JOIN users c ON c.id = p.created_by_id
       LEFT JOIN tasks t ON t.id = p.task_id
       WHERE p.user_id = $1
       ORDER BY p.created_at DESC, p.id
       LIMIT 100`,
      [userId],
    );
    return {
      balance: await this.balance(userId),
      history: rows.map(({ createdById, createdByName, ...r }) => ({
        ...r,
        createdBy: createdById
          ? { id: createdById, name: createdByName }
          : null,
      })),
    };
  }

  async historyOf(userId: string) {
    await this.findMember(this.ds.manager, userId, false);
    return this.history(userId);
  }

  /** Manual award (not to self for a moderator). */
  award(dto: AwardPointsDto, actor: Actor) {
    return this.ds.transaction(async (m) => {
      const target = await this.findMember(m, dto.userId);
      assertCan(actor, Action.PointsAward, { target });
      const entry = await m.save(
        PointsEntry,
        m.create(PointsEntry, {
          userId: target.id,
          amount: dto.amount,
          kind: PointsKind.Manual,
          reason: dto.reason.trim(),
          createdById: actor.id,
        }),
      );
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'points.awarded',
          entity: 'user',
          entityId: target.id,
          meta: {
            entryId: entry.id,
            amount: entry.amount,
            reason: entry.reason,
          },
        },
        m,
      );
      return entry;
    });
  }

  /** Revoke a manual award: admin any, moderator only their own. */
  revoke(entryId: string, dto: RevokeDto, actor: Actor) {
    return this.ds.transaction(async (m) => {
      const entry = await m.findOne(PointsEntry, {
        where: { id: entryId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!entry) throw new NotFoundException('Points entry not found');
      // Task points are final; fines are revoked through /discipline.
      if (entry.kind !== PointsKind.Manual) {
        throw new ConflictException(PointsErrors.NotRevocable);
      }
      assertCan(actor, Action.PointsRevoke, { ownerId: entry.createdById });
      const reversal = await this.reverse(m, entry, actor, dto.reason);
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'points.revoked',
          entity: 'user',
          entityId: entry.userId,
          meta: {
            entryId: entry.id,
            amount: entry.amount,
            reason: reversal.reason,
          },
        },
        m,
      );
      return reversal;
    });
  }

  /**
   * Adds the compensating entry. The ledger is append-only; the unique
   * reverses_id guards against revoking twice.
   */
  async reverse(
    m: EntityManager,
    entry: PointsEntry,
    actor: Actor,
    reason: string,
  ) {
    const done = await m.existsBy(PointsEntry, { reversesId: entry.id });
    if (done) throw new ConflictException(PointsErrors.AlreadyRevoked);
    return m.save(
      PointsEntry,
      m.create(PointsEntry, {
        userId: entry.userId,
        amount: -entry.amount,
        kind: PointsKind.Reversal,
        reason: reason.trim(),
        reversesId: entry.id,
        createdById: actor.id,
      }),
    );
  }

  /**
   * Ranking of active members. Revoked entries and their reversals are left
   * out, so a fine revoked next month does not add points to that month.
   */
  leaderboard(q: LeaderboardQuery = {}): Promise<LeaderboardRowDto[]> {
    const month = q.period === 'month';
    return this.ds.query<LeaderboardRowDto[]>(
      `WITH effective AS (
         SELECT p.user_id, p.amount
         FROM points_ledger p
         WHERE p.reverses_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM points_ledger r WHERE r.reverses_id = p.id)
           AND ($1::boolean = false
                OR p.created_at::timestamptz >= date_trunc('month', now(), $2))
       )
       SELECT u.id, u.name, u.avatar_url AS "avatarUrl", u.position,
              COALESCE(SUM(e.amount), 0)::int AS total,
              RANK() OVER (ORDER BY COALESCE(SUM(e.amount), 0) DESC)::int AS rank
       FROM users u
       LEFT JOIN effective e ON e.user_id = u.id
       WHERE u.active
       GROUP BY u.id
       ORDER BY total DESC, u.name ASC`,
      [month, POINTS_TIMEZONE],
    );
  }

  async findMember(m: EntityManager, id: string, activeOnly = true) {
    const u = await m.findOneBy(User, { id });
    if (!u || (activeOnly && !u.active)) {
      throw new NotFoundException(PointsErrors.UnknownMember);
    }
    return u;
  }
}
