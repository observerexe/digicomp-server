import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
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
import { EndSessionDto, ListSessionsQuery, StartSessionDto } from './dto';
import { PlaceAuthorization } from './place-authorization.entity';
import { Place, PlaceStatus } from './place.entity';
import { authIsValid, isSupervisor, PlacesService } from './places.service';
import { WorkSession } from './work-session.entity';

type Actor = { id: string; role: string };

function isUniqueViolation(e: unknown) {
  const err = e as { code?: string; driverError?: { code?: string } };
  return err?.code === '23505' || err?.driverError?.code === '23505';
}

function toView(s: WorkSession) {
  return {
    id: s.id,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    endedById: s.endedById,
    safetyConfirmed: s.safetyConfirmed,
    note: s.note,
    equipmentState: s.equipmentState,
    endReason: s.endReason,
    user: s.user ? { id: s.user.id, name: s.user.name } : { id: s.userId },
    place: s.place
      ? { id: s.place.id, code: s.place.code, title: s.place.title }
      : { id: s.placeId },
  };
}

@Injectable()
export class WorkSessionsService {
  constructor(
    @InjectRepository(WorkSession) private repo: Repository<WorkSession>,
    @InjectDataSource() private ds: DataSource,
    private places: PlacesService,
    private audit: AuditService,
  ) {}

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
        if (!dto.safetyConfirmed) {
          throw new BadRequestException('Safety confirmation required');
        }
        if (place.needsAuthorization && !isSupervisor(actor.role)) {
          const auth = await m.findOneBy(PlaceAuthorization, {
            userId: actor.id,
            placeId: place.id,
          });
          if (!authIsValid(auth)) {
            throw new ForbiddenException('Not authorized for this place');
          }
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
        if (!isSupervisor(actor.role)) {
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

  async list(q: ListSessionsQuery, actor: Actor) {
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(q.limit ?? 50)));
    const where: FindOptionsWhere<WorkSession> = {};
    if (isSupervisor(actor.role)) {
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
}
