import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { User } from '../users/user.entity';
import {
  CreatePlaceDto,
  GrantAuthorizationDto,
  ListAuthorizationsQuery,
  ListPlacesQuery,
  UpdatePlaceDto,
} from './dto';
import { PlaceAuthorization } from './place-authorization.entity';
import { Place, PlaceStatus } from './place.entity';
import { WorkSession } from './work-session.entity';

type Actor = { id: string; role: string };

export function isSupervisor(role: string) {
  return role === 'admin' || role === 'coordinator';
}

export function authIsValid(a: PlaceAuthorization | null | undefined) {
  return !!a && (!a.expiresAt || a.expiresAt.getTime() > Date.now());
}

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => '\\' + c);
}

@Injectable()
export class PlacesService {
  constructor(
    @InjectRepository(Place) private places: Repository<Place>,
    @InjectRepository(PlaceAuthorization)
    private auths: Repository<PlaceAuthorization>,
    @InjectRepository(WorkSession) private sessions: Repository<WorkSession>,
    @InjectRepository(User) private users: Repository<User>,
    @InjectDataSource() private ds: DataSource,
    private audit: AuditService,
  ) {}

  async resolve(idOrCode: string, manager?: EntityManager) {
    const repo = (manager ?? this.ds.manager).getRepository(Place);
    const place = isUUID(idOrCode, 'all')
      ? await repo.findOneBy({ id: idOrCode })
      : await repo.findOneBy({ code: idOrCode.toUpperCase() });
    if (!place) throw new NotFoundException('Place not found');
    return place;
  }

  async list(q: ListPlacesQuery, actor: Actor) {
    const qb = this.places.createQueryBuilder('p');
    if (!isSupervisor(actor.role)) {
      qb.andWhere('p.status <> :arch', { arch: PlaceStatus.Archived });
    }
    if (q.status) qb.andWhere('p.status = :status', { status: q.status });
    if (q.category) qb.andWhere('p.category = :cat', { cat: q.category });
    if (q.search) {
      qb.andWhere(
        '(p.title ILIKE :s OR p.code ILIKE :s OR p.location ILIKE :s OR p.category ILIKE :s)',
        { s: `%${escapeLike(q.search)}%` },
      );
    }
    qb.orderBy('p.title', 'ASC').addOrderBy('p.id', 'ASC');
    const rows = await qb.getMany();
    return this.decorate(rows, actor);
  }

  async get(idOrCode: string, actor: Actor) {
    const place = await this.resolve(idOrCode);
    if (place.status === PlaceStatus.Archived && !isSupervisor(actor.role)) {
      throw new NotFoundException('Place not found');
    }
    return (await this.decorate([place], actor))[0];
  }

  async create(dto: CreatePlaceDto, actor: Actor) {
    const code = dto.code.toUpperCase();
    if (await this.places.findOneBy({ code })) {
      throw new ConflictException('Place code already used');
    }
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

  async listAuthorizations(q: ListAuthorizationsQuery, actor: Actor) {
    const where: { userId?: string; placeId?: string } = {};
    if (isSupervisor(actor.role)) {
      if (q.userId) where.userId = q.userId;
    } else {
      where.userId = actor.id;
    }
    if (q.placeId) where.placeId = q.placeId;
    const rows = await this.auths.find({
      where,
      relations: { user: true, place: true },
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
    }));
  }

  async grant(dto: GrantAuthorizationDto, actor: Actor) {
    const user = await this.users.findOneBy({ id: dto.userId });
    if (!user || !user.active) throw new NotFoundException('User not found');
    const place = await this.resolve(dto.placeId);
    let row = await this.auths.findOneBy({
      userId: user.id,
      placeId: place.id,
    });
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (row) {
      row.expiresAt = expiresAt;
      row.note = dto.note ?? row.note;
      row.grantedById = actor.id;
    } else {
      row = this.auths.create({
        userId: user.id,
        placeId: place.id,
        grantedById: actor.id,
        expiresAt,
        note: dto.note ?? '',
      });
    }
    row = await this.auths.save(row);
    await this.audit.log({
      actorId: actor.id,
      action: 'authorization.granted',
      entity: 'place',
      entityId: place.id,
      meta: { userId: user.id, expiresAt: expiresAt?.toISOString() ?? null },
    });
    return {
      id: row.id,
      userId: row.userId,
      placeId: row.placeId,
      grantedById: row.grantedById,
      grantedAt: row.grantedAt,
      expiresAt: row.expiresAt,
      note: row.note,
    };
  }

  async revoke(id: string, actor: Actor) {
    const row = await this.auths.findOneBy({ id });
    if (!row) throw new NotFoundException('Authorization not found');
    await this.auths.delete({ id });
    await this.audit.log({
      actorId: actor.id,
      action: 'authorization.revoked',
      entity: 'place',
      entityId: row.placeId,
      meta: { userId: row.userId },
    });
    return { ok: true };
  }

  private async decorate(rows: Place[], actor: Actor) {
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
