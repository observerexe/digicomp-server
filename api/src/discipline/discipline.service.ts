import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { Action, Actor, assertCan } from '../auth/policy';
import type { Plain } from '../common/responses.dto';
import { PaperAdapterRegistry } from '../paperwork/adapters';
import {
  paperOfRecords,
  papersOf,
  papersReferring,
  type RecordPaper,
  type ReferringPaper,
} from '../paperwork/paper-targets';
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
  HasPaper: 'Discipline record has a paper',
} as const;

/** An error about the fine's size: the editor shows it on the field. */
const amountError = (message: string) =>
  new BadRequestException({ message, field: 'amount' });

type Ref = { id: string; name: string | null; avatarUrl: string | null };

function view(
  r: DisciplineRecord,
  users: Map<string, User>,
  paper: RecordPaper | undefined,
  papers: ReferringPaper[] | undefined,
): Plain<DisciplineRecordDto> {
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
    paper: paper ?? null,
    papers: papers ?? [],
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
    private adapters: PaperAdapterRegistry,
  ) {}

  /** The member's own records, including revoked ones. */
  async mine(actor: Actor) {
    const rows = await this.records.find({
      where: { userId: actor.id },
      order: { createdAt: 'DESC' },
    });
    return this.views(rows, actor);
  }

  /** Staff table, newest first. */
  async list(
    q: ListDisciplineQuery,
    actor: Actor,
  ): Promise<Plain<DisciplineListDto>> {
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
    return { items: await this.views(rows, actor), total, page, limit };
  }

  /**
   * Warning, fine (takes points) or reprimand; a moderator not to self.
   * Only in the transaction of its document («Подання про стягнення»).
   */
  async issue(
    dto: IssueDisciplineDto,
    actor: Actor,
    m: EntityManager,
  ): Promise<DisciplineRecord> {
    const fine = dto.type === DisciplineType.Fine;
    if (fine && dto.amount === undefined) {
      throw amountError(DisciplineErrors.AmountRequired);
    }
    if (!fine && dto.amount !== undefined) {
      throw amountError(DisciplineErrors.AmountOnlyForFine);
    }
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
  }

  /**
   * Revokes a record made before documents; one with a document goes only
   * by cancelling the document (409 DISCIPLINE_HAS_PAPER).
   */
  async revoke(id: string, dto: RevokeDto, actor: Actor) {
    const rec = await this.ds.transaction((m) =>
      this.take(m, id, dto.reason, actor, true),
    );
    return (await this.views([rec], actor))[0];
  }

  /** Its document is cancelled: the record is revoked with the same reason. */
  async revokeByPaper(
    m: EntityManager,
    id: string,
    reason: string,
    actor: Actor,
  ): Promise<void> {
    await this.take(m, id, reason, actor, false);
  }

  /**
   * A record made before documents gets its «Подання» (for-record): from
   * who may revoke it (admin any, a moderator their own), while it stands.
   */
  async adopt(m: EntityManager, id: string, actor: Actor): Promise<void> {
    const rec = await m.findOne(DisciplineRecord, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!rec) throw new NotFoundException('Discipline record not found');
    assertCan(actor, Action.DisciplineRevoke, { ownerId: rec.issuedById });
    if (rec.revokedAt) {
      throw new ConflictException(PointsErrors.AlreadyRevoked);
    }
  }

  /**
   * Revoke with a reason: admin any, moderator only their own. Fines are
   * refunded. `alone` — not through its document: a record with one stays.
   */
  private async take(
    m: EntityManager,
    id: string,
    reason: string,
    actor: Actor,
    alone: boolean,
  ) {
    const rec = await m.findOne(DisciplineRecord, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!rec) throw new NotFoundException('Discipline record not found');
    if (rec.revokedAt) {
      throw new ConflictException(PointsErrors.AlreadyRevoked);
    }
    assertCan(actor, Action.DisciplineRevoke, { ownerId: rec.issuedById });
    if (alone && (await papersOf(m, 'discipline_record', id))) {
      throw new ConflictException(DisciplineErrors.HasPaper);
    }
    if (rec.ledgerEntryId) {
      const entry = await m.findOneByOrFail(PointsEntry, {
        id: rec.ledgerEntryId,
      });
      await this.points.reverse(m, entry, actor, reason);
    }
    rec.revokedAt = new Date();
    rec.revokedById = actor.id;
    rec.revokeReason = reason.trim();
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
          ...(alone ? {} : { byPaper: true }),
        },
      },
      m,
    );
    return rec;
  }

  /** Records with their people, their document and documents about them the actor sees. */
  private async views(rows: DisciplineRecord[], actor: Actor) {
    const userIds = new Set<string>();
    for (const r of rows) {
      userIds.add(r.userId);
      userIds.add(r.issuedById);
      if (r.revokedById) userIds.add(r.revokedById);
    }
    const users = new Map<string, User>();
    if (userIds.size) {
      for (const u of await this.users.findBy({ id: In([...userIds]) })) {
        users.set(u.id, u);
      }
    }
    const ids = rows.map((r) => r.id);
    const m = this.ds.manager;
    const paper = await paperOfRecords(m, 'discipline_record', ids);
    const papers = await papersReferring(
      m,
      this.adapters,
      actor,
      'discipline_record',
      ids,
    );
    return rows.map((r) => view(r, users, paper.get(r.id), papers.get(r.id)));
  }
}
