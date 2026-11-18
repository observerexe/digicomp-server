import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { Action, assertCan, can } from '../auth/policy';
import {
  assertDictionaryItem,
  itemTitleLike,
} from '../dictionaries/dictionary-usage';
import { Role, User } from '../users/user.entity';
import {
  CreatePlaceDto,
  GrantAuthorizationDto,
  ListAuthorizationsQuery,
  ListPlacesQuery,
  UpdatePlaceDto,
} from './dto';
import { PlaceAuthorization } from './place-authorization.entity';
import { Place, PLACE_CATEGORY, PlaceStatus } from './place.entity';
import { WorkSession } from './work-session.entity';
import type { AuthorizationDto, PlaceDto } from './responses.dto';
import type { OkDto } from '../common/responses.dto';
import { escapeLike } from '../common/like';
import { fieldInvalid } from '../paperwork/paper-fields';
import { papersOf } from '../paperwork/paper-targets';

type Actor = { id: string; role: string };

export const PlaceErrors = {
  AuthorizationHasPaper: 'Authorization has a paper',
} as const;

export function authIsValid(a: PlaceAuthorization | null | undefined) {
  return !!a && (!a.expiresAt || a.expiresAt.getTime() > Date.now());
}

@Injectable()
export class PlacesService {
  constructor(
    @InjectRepository(Place) private places: Repository<Place>,
    @InjectRepository(PlaceAuthorization)
    private auths: Repository<PlaceAuthorization>,
    @InjectRepository(WorkSession) private sessions: Repository<WorkSession>,
    @InjectDataSource() private ds: DataSource,
    private audit: AuditService,
  ) {}

  /**
   * By id or by the QR code. Deleted equipment (in the trash or for good)
   * is not found: PLACE_DELETED, so its sticker tells why.
   */
  async resolve(idOrCode: string, manager?: EntityManager) {
    const repo = (manager ?? this.ds.manager).getRepository(Place);
    const by = isUUID(idOrCode, 'all')
      ? { id: idOrCode }
      : { code: idOrCode.toUpperCase() };
    const place = await repo.findOneBy({ ...by, deletedAt: IsNull() });
    if (place) return place;
    if (await repo.existsBy(by)) throw new NotFoundException('Place deleted');
    throw new NotFoundException('Place not found');
  }

  async list(q: ListPlacesQuery, actor: Actor) {
    const qb = this.places.createQueryBuilder('p').where('p.deletedAt IS NULL');
    if (!can(actor, Action.PlacesManage)) {
      qb.andWhere('p.status <> :arch', { arch: PlaceStatus.Archived });
    }
    if (q.status) qb.andWhere('p.status = :status', { status: q.status });
    if (q.category) qb.andWhere('p.category = :cat', { cat: q.category });
    if (q.search) {
      qb.andWhere(
        `(p.title ILIKE :s OR p.code ILIKE :s OR p.location ILIKE :s OR ${itemTitleLike('p.category', 'dict', 's')})`,
        { s: `%${escapeLike(q.search)}%`, dict: PLACE_CATEGORY },
      );
    }
    qb.orderBy('p.title', 'ASC').addOrderBy('p.id', 'ASC');
    const rows = await qb.getMany();
    return this.decorate(rows, actor);
  }

  async get(idOrCode: string, actor: Actor) {
    const place = await this.resolve(idOrCode);
    if (
      place.status === PlaceStatus.Archived &&
      !can(actor, Action.PlacesManage)
    ) {
      throw new NotFoundException('Place not found');
    }
    return (await this.decorate([place], actor))[0];
  }

  async create(dto: CreatePlaceDto, actor: Actor) {
    const code = dto.code.toUpperCase();
    if (await this.places.findOneBy({ code, purgedAt: IsNull() })) {
      throw new ConflictException('Place code already used');
    }
    await assertDictionaryItem(this.ds.manager, PLACE_CATEGORY, dto.category);
    const place = await this.places.save(
      this.places.create({
        code,
        title: dto.title,
        category: dto.category,
        location: dto.location ?? '',
        description: dto.description ?? '',
        needsAuthorization: dto.needsAuthorization ?? true,
        exclusive: dto.exclusive ?? true,
      }),
    );
    await this.audit.log({
      actorId: actor.id,
      action: 'place.created',
      entity: 'place',
      entityId: place.id,
      meta: { code, title: place.title },
    });
    return (await this.decorate([place], actor))[0];
  }

  async update(idOrCode: string, dto: UpdatePlaceDto, actor: Actor) {
    const place = await this.resolve(idOrCode);
    if (dto.category !== undefined) {
      await assertDictionaryItem(
        this.ds.manager,
        PLACE_CATEGORY,
        dto.category,
        place.category,
      );
    }
    const changed: string[] = [];
    for (const k of [
      'title',
      'category',
      'location',
      'description',
      'status',
      'needsAuthorization',
      'exclusive',
    ] as const) {
      const v = dto[k];
      if (v !== undefined && v !== place[k]) {
        (place as unknown as Record<string, unknown>)[k] = v;
        changed.push(k);
      }
    }
    if (changed.length) {
      await this.places.save(place);
      await this.audit.log({
        actorId: actor.id,
        action: 'place.updated',
        entity: 'place',
        entityId: place.id,
        meta: { fields: changed },
      });
    }
    return (await this.decorate([place], actor))[0];
  }

  async listAuthorizations(
    q: ListAuthorizationsQuery,
    actor: Actor,
  ): Promise<AuthorizationDto[]> {
    const where: { userId?: string; placeId?: string } = {};
    if (can(actor, Action.PlacesAuthorize)) {
      if (q.userId) where.userId = q.userId;
    } else {
      where.userId = actor.id;
    }
    if (q.placeId) where.placeId = q.placeId;
    const rows = await this.auths.find({
      where,
      relations: { user: true, place: true, paper: true },
      order: { grantedAt: 'DESC' },
    });
    return rows.map((a) => ({
      id: a.id,
      user: { id: a.user.id, name: a.user.name },
      place: { id: a.place.id, code: a.place.code, title: a.place.title },
      grantedById: a.grantedById,
      grantedAt: a.grantedAt,
      expiresAt: a.expiresAt,
      expired: !authIsValid(a),
      note: a.note,
      paper: a.paper ? { id: a.paper.id, number: a.paper.number } : null,
    }));
  }

  /**
   * Grants a допуск, only in the transaction of its document («Запис про
   * інструктаж і допуск», `paperId`): staff, to an active member, for
   * equipment not archived. A repeat briefing renews the допуск the member
   * has (the same row: new term, who and when) and this document becomes
   * its document.
   */
  async grant(
    dto: GrantAuthorizationDto,
    actor: Actor,
    m: EntityManager,
    paperId: string,
  ): Promise<PlaceAuthorization> {
    assertCan(actor, Action.PlacesAuthorize);
    const user = await m.findOneBy(User, { id: dto.userId });
    if (!user || !user.active || user.role === Role.Guest) {
      throw fieldInvalid('userId');
    }
    const place = await m.findOneBy(Place, {
      id: dto.placeId,
      deletedAt: IsNull(),
    });
    if (!place || place.status === PlaceStatus.Archived) {
      throw fieldInvalid('placeId');
    }
    // Two first briefings at once would both see no допуск.
    await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `authorization:${user.id}:${place.id}`,
    ]);
    const repo = m.getRepository(PlaceAuthorization);
    let row = await repo.findOne({
      where: { userId: user.id, placeId: place.id },
      lock: { mode: 'pessimistic_write' },
    });
    const term = {
      grantedById: actor.id,
      grantedAt: new Date(),
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      note: dto.note?.trim() ?? '',
      paperId,
    };
    const renewed = !!row;
    row = await repo.save(
      row
        ? Object.assign(row, term)
        : repo.create({ userId: user.id, placeId: place.id, ...term }),
    );
    await this.audit.log(
      {
        actorId: actor.id,
        action: 'authorization.granted',
        entity: 'place',
        entityId: place.id,
        meta: {
          userId: user.id,
          expiresAt: term.expiresAt?.toISOString() ?? null,
          paperId,
          ...(renewed ? { renewed: true } : {}),
        },
      },
      m,
    );
    return row;
  }

  /**
   * Revokes a допуск granted before documents; one with a document goes
   * only by cancelling the document (409 AUTHORIZATION_HAS_PAPER).
   */
  async revoke(id: string, actor: Actor): Promise<OkDto> {
    await this.ds.transaction(async (m) => {
      const row = await this.locked(m, id);
      if (await papersOf(m, 'place_authorization', id)) {
        throw new ConflictException(PlaceErrors.AuthorizationHasPaper);
      }
      await this.take(m, row, actor, null);
    });
    return { ok: true };
  }

  /**
   * Its document is cancelled: the допуск is revoked with the same reason —
   * if that document granted its current term (an earlier briefing's
   * document leaves the renewed допуск as it is).
   */
  async revokeByPaper(
    m: EntityManager,
    id: string,
    paperId: string,
    reason: string,
    actor: Actor,
  ): Promise<void> {
    const row = await m.findOne(PlaceAuthorization, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (row?.paperId !== paperId) return;
    assertCan(actor, Action.PlacesAuthorize);
    await this.take(m, row, actor, reason);
  }

  /**
   * A допуск granted before documents gets its «Запис про інструктаж і
   * допуск» (for-record): staff.
   */
  async adopt(
    m: EntityManager,
    id: string,
    paperId: string,
    actor: Actor,
  ): Promise<void> {
    assertCan(actor, Action.PlacesAuthorize);
    // One that has a document already — PAPER_TARGET_TAKEN (for-record).
    const row = await this.locked(m, id);
    await m.update(PlaceAuthorization, row.id, { paperId });
  }

  private async locked(m: EntityManager, id: string) {
    const row = await m.findOne(PlaceAuthorization, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!row) throw new NotFoundException('Authorization not found');
    return row;
  }

  /** Deletes the допуск; `reason` — of its cancelled document. */
  private async take(
    m: EntityManager,
    row: PlaceAuthorization,
    actor: Actor,
    reason: string | null,
  ) {
    await m.delete(PlaceAuthorization, { id: row.id });
    await this.audit.log(
      {
        actorId: actor.id,
        action: 'authorization.revoked',
        entity: 'place',
        entityId: row.placeId,
        meta: {
          userId: row.userId,
          ...(reason === null ? {} : { reason, byPaper: true }),
        },
      },
      m,
    );
  }

  private async decorate(rows: Place[], actor: Actor): Promise<PlaceDto[]> {
    const ids = rows.map((p) => p.id);
    const active = ids.length
      ? await this.sessions.find({
          where: { placeId: In(ids), endedAt: IsNull() },
          relations: { user: true },
        })
      : [];
    const mine = ids.length
      ? await this.auths.find({
          where: { userId: actor.id, placeId: In(ids) },
        })
      : [];
    return rows.map((p) => {
      const sessions = active.filter((s) => s.placeId === p.id);
      const auth = mine.find((a) => a.placeId === p.id);
      return {
        id: p.id,
        code: p.code,
        title: p.title,
        category: p.category,
        location: p.location,
        description: p.description,
        status: p.status,
        needsAuthorization: p.needsAuthorization,
        exclusive: p.exclusive,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        inUse: sessions.length > 0,
        activeSessions: sessions.map((s) => ({
          id: s.id,
          startedAt: s.startedAt,
          user: { id: s.user.id, name: s.user.name },
        })),
        myAuthorization: authIsValid(auth)
          ? { expiresAt: auth!.expiresAt }
          : null,
      };
    });
  }
}
