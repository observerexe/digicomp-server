import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { Action, Actor, assertCan } from '../auth/policy';
import {
  AVATAR_EXTENSIONS,
  UploadedFileLike,
  validateUpload,
} from '../files/file-validation';
import { StorageService } from '../files/storage.service';
import { Place, PlaceStatus } from '../places/place.entity';
import { PlacesService } from '../places/places.service';
import { User } from '../users/user.entity';
import { CloseFaultDto, CreateFaultDto, ListFaultsQuery } from './dto';
import { FaultPhoto, FaultReport, FaultStatus } from './fault.entities';
import type { Plain } from '../common/responses.dto';
import type { FaultDetailDto, FaultDto, FaultListDto } from './responses.dto';

export const FAULT_MAX_PHOTOS = 3;
export const FAULT_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const STORAGE_DIR = 'faults';

export const FaultErrors = {
  Closed: 'Fault report is closed',
  PhotoLimit: 'Too many photos',
} as const;

type Ref = { id: string; name: string | null; avatarUrl: string | null };

@Injectable()
export class FaultsService {
  constructor(
    @InjectRepository(FaultReport) private faults: Repository<FaultReport>,
    @InjectRepository(FaultPhoto) private photos: Repository<FaultPhoto>,
    @InjectRepository(User) private users: Repository<User>,
    @InjectDataSource() private ds: DataSource,
    private places: PlacesService,
    private storage: StorageService,
    private audit: AuditService,
  ) {}

  async create(dto: CreateFaultDto, actor: Actor) {
    const place = await this.places.resolve(dto.placeId);
    if (place.status === PlaceStatus.Archived) {
      throw new NotFoundException('Place not found');
    }
    const id = await this.ds.transaction(async (m) => {
      const f = await m.save(
        FaultReport,
        m.create(FaultReport, {
          placeId: place.id,
          reporterId: actor.id,
          description: dto.description.trim(),
        }),
      );
      await this.log(m, actor, 'fault.created', f.id, { placeId: place.id });
      return f.id;
    });
    return this.get(id);
  }

  async list(q: ListFaultsQuery): Promise<FaultListDto> {
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(q.limit ?? 50)));
    const qb = this.faults
      .createQueryBuilder('f')
      .leftJoinAndSelect('f.place', 'p')
      .orderBy('f.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);
    if (q.placeId) qb.andWhere('f.placeId = :pid', { pid: q.placeId });
    if (q.status) qb.andWhere('f.status = :st', { st: q.status });
    const [rows, total] = await qb.getManyAndCount();
    const counts = await this.photoCounts(rows.map((r) => r.id));
    const users = await this.userRefs(rows);
    const items = rows.map((f) => ({
      ...this.view(f, users),
      photosCount: counts.get(f.id) ?? 0,
    }));
    return { items, total, page, limit };
  }

  async get(id: string): Promise<FaultDetailDto> {
    const f = await this.faults.findOne({
      where: { id },
      relations: { place: true },
    });
    if (!f) throw new NotFoundException('Fault report not found');
    const photos = await this.photos.find({
      where: { faultId: id },
      order: { createdAt: 'ASC' },
    });
    return {
      ...this.view(f, await this.userRefs([f])),
      photos: photos.map((p) => ({
        id: p.id,
        mimeType: p.mimeType,
        size: p.size,
        uploadedById: p.uploadedById,
        createdAt: p.createdAt,
      })),
    };
  }

  async addPhoto(id: string, file: UploadedFileLike | undefined, actor: Actor) {
    const f = await this.find(id);
    assertCan(actor, Action.FaultsAttach, { ownerId: f.reporterId });
    if (f.status === FaultStatus.Closed) {
      throw new ConflictException(FaultErrors.Closed);
    }
    const info = validateUpload(file, AVATAR_EXTENSIONS);
    if (file!.size > FAULT_PHOTO_MAX_BYTES) {
      throw new BadRequestException('File too large');
    }
    const storedName = `${randomUUID()}.${info.ext}`;
    await this.storage.save(`${STORAGE_DIR}/${storedName}`, file!.buffer);
    try {
      await this.ds.transaction(async (m) => {
        // Lock the report so two uploads cannot exceed the limit.
        await m.findOne(FaultReport, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        const count = await m.count(FaultPhoto, { where: { faultId: id } });
        if (count >= FAULT_MAX_PHOTOS) {
          throw new ConflictException(FaultErrors.PhotoLimit);
        }
        await m.insert(FaultPhoto, {
          faultId: id,
          mimeType: info.mime,
          size: file!.size,
          storedName,
          uploadedById: actor.id,
        });
        await this.log(m, actor, 'fault.photo_added', id, {});
      });
    } catch (e) {
      await this.storage.remove(`${STORAGE_DIR}/${storedName}`);
      throw e;
    }
    return this.get(id);
  }

  async photo(id: string, photoId: string) {
    const p = await this.photos.findOneBy({ id: photoId, faultId: id });
    if (!p) throw new NotFoundException('File not found');
    const stream = await this.storage.streamOrFail(
      `${STORAGE_DIR}/${p.storedName}`,
    );
    return { photo: p, stream };
  }

  /** open → in_progress without touching the equipment. */
  inProgress(id: string, actor: Actor) {
    return this.transition(id, actor, false);
  }

  /** One action: report in progress and the equipment on maintenance. */
  maintenance(id: string, actor: Actor) {
    return this.transition(id, actor, true);
  }

  async close(id: string, dto: CloseFaultDto, actor: Actor) {
    await this.ds.transaction(async (m) => {
      const f = await this.lock(m, id);
      if (f.status === FaultStatus.Closed) {
        throw new ConflictException(FaultErrors.Closed);
      }
      f.status = FaultStatus.Closed;
      f.resolution = dto.resolution.trim();
      f.closedById = actor.id;
      f.closedAt = new Date();
      await m.save(FaultReport, f);
      let reactivated = false;
      if (dto.reactivatePlace) {
        const res = await m.update(
          Place,
          { id: f.placeId, status: PlaceStatus.Maintenance },
          { status: PlaceStatus.Active },
        );
        reactivated = !!res.affected;
        if (reactivated) {
          await this.placeUpdated(m, actor, f.placeId, id, 'active');
        }
      }
      await this.log(m, actor, 'fault.closed', id, { reactivated });
    });
    return this.get(id);
  }

  private async transition(id: string, actor: Actor, maintenance: boolean) {
    await this.ds.transaction(async (m) => {
      const f = await this.lock(m, id);
      if (f.status === FaultStatus.Closed) {
        throw new ConflictException(FaultErrors.Closed);
      }
      const from = f.status;
      f.status = FaultStatus.InProgress;
      await m.save(FaultReport, f);
      let placeChanged = false;
      if (maintenance) {
        const res = await m.update(
          Place,
          { id: f.placeId, status: PlaceStatus.Active },
          { status: PlaceStatus.Maintenance },
        );
        placeChanged = !!res.affected;
        if (placeChanged) {
          await this.placeUpdated(m, actor, f.placeId, id, 'maintenance');
        }
      }
      await this.log(
        m,
        actor,
        maintenance ? 'fault.maintenance' : 'fault.in_progress',
        id,
        { from, placeChanged },
      );
    });
    return this.get(id);
  }

  private placeUpdated(
    m: EntityManager,
    actor: Actor,
    placeId: string,
    faultId: string,
    to: 'active' | 'maintenance',
  ) {
    return this.audit.log(
      {
        actorId: actor.id,
        action: 'place.updated',
        entity: 'place',
        entityId: placeId,
        meta: { fields: ['status'], to, faultId },
      },
      m,
    );
  }

  private view(f: FaultReport, users: Map<string, Ref>): Plain<FaultDto> {
    const ref = (uid: string | null) =>
      uid ? (users.get(uid) ?? { id: uid, name: null, avatarUrl: null }) : null;
    return {
      id: f.id,
      description: f.description,
      status: f.status,
      resolution: f.resolution,
      place: f.place
        ? {
            id: f.place.id,
            code: f.place.code,
            title: f.place.title,
            status: f.place.status,
          }
        : { id: f.placeId },
      reporter: ref(f.reporterId),
      closedBy: ref(f.closedById),
      closedAt: f.closedAt,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
    };
  }

  private async userRefs(rows: FaultReport[]) {
    const ids = new Set<string>();
    for (const r of rows) {
      ids.add(r.reporterId);
      if (r.closedById) ids.add(r.closedById);
    }
    const map = new Map<string, Ref>();
    if (ids.size) {
      for (const u of await this.users.findBy({ id: In([...ids]) })) {
        map.set(u.id, { id: u.id, name: u.name, avatarUrl: u.avatarUrl });
      }
    }
    return map;
  }

  private async photoCounts(ids: string[]) {
    const map = new Map<string, number>();
    if (!ids.length) return map;
    const rows = await this.ds.query<{ fault_id: string; n: number }[]>(
      'SELECT fault_id, count(*)::int AS n FROM fault_photos WHERE fault_id = ANY($1) GROUP BY fault_id',
      [ids],
    );
    for (const r of rows) map.set(r.fault_id, r.n);
    return map;
  }

  private async find(id: string) {
    const f = await this.faults.findOneBy({ id });
    if (!f) throw new NotFoundException('Fault report not found');
    return f;
  }

  private async lock(m: EntityManager, id: string) {
    const f = await m.findOne(FaultReport, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!f) throw new NotFoundException('Fault report not found');
    return f;
  }

  private log(
    m: EntityManager,
    actor: Actor,
    action: string,
    id: string,
    meta: Record<string, unknown>,
  ) {
    return this.audit.log(
      { actorId: actor.id, action, entity: 'fault', entityId: id, meta },
      m,
    );
  }
}
