import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { Action, Actor, assertCan } from '../auth/policy';
import { RevokeDto } from '../points/dto';
import { PointsEntry, PointsKind } from '../points/points-entry.entity';
import { PointsErrors, PointsService } from '../points/points.service';
import { User } from '../users/user.entity';
import { DisciplineRecord, DisciplineType } from './discipline.entity';
import { IssueDisciplineDto, ListDisciplineQuery } from './dto';
import type { DisciplineListDto, DisciplineRecordDto } from './responses.dto';

export const DisciplineErrors = {
  AmountRequired: 'Fine amount is required',
  AmountOnlyForFine: 'Amount is allowed only for a fine',
} as const;

type Ref = { id: string; name: string | null; avatarUrl: string | null };

function view(
  r: DisciplineRecord,
  users: Map<string, User>,
): DisciplineRecordDto {
  const ref = (id: string | null): Ref | null => {
    if (!id) return null;
    const u = users.get(id);
    return { id, name: u?.name ?? null, avatarUrl: u?.avatarUrl ?? null };
  };
  return {
    id: r.id,
    type: r.type,
    reason: r.reason,
    amount: r.amount,
    user: ref(r.userId),
    issuedBy: ref(r.issuedById),
    createdAt: r.createdAt,
    revoked: r.revokedAt !== null,
    revokedAt: r.revokedAt,
    revokedBy: ref(r.revokedById),
    revokeReason: r.revokeReason,
  };
}

@Injectable()
export class DisciplineService {
  constructor(
    @InjectRepository(DisciplineRecord)
    private records: Repository<DisciplineRecord>,
    @InjectRepository(User) private users: Repository<User>,
    @InjectDataSource() private ds: DataSource,
    private points: PointsService,
    private audit: AuditService,
  ) {}

  /** The member's own records, including revoked ones. */
  async mine(userId: string) {
    const rows = await this.records.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return this.views(rows);
  }

  /** Staff table, newest first. */
  async list(q: ListDisciplineQuery): Promise<DisciplineListDto> {
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(q.limit ?? 50)));
    const qb = this.records
      .createQueryBuilder('r')
      .orderBy('r.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);
    if (q.userId) qb.andWhere('r.userId = :uid', { uid: q.userId });
    if (q.state === 'active') qb.andWhere('r.revokedAt IS NULL');
    if (q.state === 'revoked') qb.andWhere('r.revokedAt IS NOT NULL');
    const [rows, total] = await qb.getManyAndCount();
    return { items: await this.views(rows), total, page, limit };
  }

  issue(dto: IssueDisciplineDto, actor: Actor) {
    const fine = dto.type === DisciplineType.Fine;
    if (fine && dto.amount === undefined) {
      throw new BadRequestException(DisciplineErrors.AmountRequired);
    }
    if (!fine && dto.amount !== undefined) {
      throw new BadRequestException(DisciplineErrors.AmountOnlyForFine);
    }
    return this.ds
      .transaction(async (m) => {
        const target = await this.points.findMember(m, dto.userId);
        assertCan(actor, Action.DisciplineIssue, { target });
        const reason = dto.reason.trim();
        let ledgerEntryId: string | null = null;
        if (fine) {
          const entry = await m.save(
            PointsEntry,
            m.create(PointsEntry, {
              userId: target.id,
              amount: -dto.amount!,
              kind: PointsKind.Fine,
              reason,
              createdById: actor.id,
            }),
          );
          ledgerEntryId = entry.id;
        }
        const rec = await m.save(
          DisciplineRecord,
          m.create(DisciplineRecord, {
            userId: target.id,
            type: dto.type,
            reason,
            amount: fine ? dto.amount! : null,
            issuedById: actor.id,
            ledgerEntryId,
          }),
        );
        await this.audit.log(
          {
            actorId: actor.id,
            action: 'discipline.issued',
            entity: 'user',
            entityId: target.id,
            meta: { recordId: rec.id, type: rec.type, amount: rec.amount },
          },
          m,
        );
        return rec;
      })
      .then(async (rec) => (await this.views([rec]))[0]);
  }

  /** Revoke with a reason: admin any, moderator only their own. Fines are refunded. */
  revoke(id: string, dto: RevokeDto, actor: Actor) {
    return this.ds
      .transaction(async (m) => {
        const rec = await m.findOne(DisciplineRecord, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!rec) throw new NotFoundException('Discipline record not found');
        if (rec.revokedAt) {
          throw new ConflictException(PointsErrors.AlreadyRevoked);
        }
        assertCan(actor, Action.DisciplineRevoke, { ownerId: rec.issuedById });
        if (rec.ledgerEntryId) {
          const entry = await m.findOneByOrFail(PointsEntry, {
            id: rec.ledgerEntryId,
          });
          await this.points.reverse(m, entry, actor, dto.reason);
        }
        rec.revokedAt = new Date();
        rec.revokedById = actor.id;
        rec.revokeReason = dto.reason.trim();
        await m.save(DisciplineRecord, rec);
        await this.audit.log(
          {
            actorId: actor.id,
            action: 'discipline.revoked',
            entity: 'user',
            entityId: rec.userId,
            meta: {
              recordId: rec.id,
              type: rec.type,
              reason: rec.revokeReason,
            },
          },
          m,
        );
        return rec;
      })
      .then(async (rec) => (await this.views([rec]))[0]);
  }

  private async views(rows: DisciplineRecord[]) {
    const ids = new Set<string>();
    for (const r of rows) {
      ids.add(r.userId);
      ids.add(r.issuedById);
      if (r.revokedById) ids.add(r.revokedById);
    }
    const users = new Map<string, User>();
    if (ids.size) {
      for (const u of await this.users.findBy({ id: In([...ids]) })) {
        users.set(u.id, u);
      }
    }
    return rows.map((r) => view(r, users));
  }
}
