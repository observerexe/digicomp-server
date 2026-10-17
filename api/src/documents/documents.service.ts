import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { DataSource, In, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import {
  DOCUMENT_EXTENSIONS,
  UploadedFileLike,
  validateUpload,
} from '../files/file-validation';
import { StorageService } from '../files/storage.service';
import { Place } from '../places/place.entity';
import {
  AddVersionDto,
  CreateDocDto,
  ListDocsQuery,
  UpdateDocDto,
} from './dto';
import { AccessScope, Doc, DocVersion } from './doc.entity';

type Actor = { id: string; role: string };

function supervisor(role: string) {
  return role === 'admin' || role === 'coordinator';
}

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => '\\' + c);
}

function versionView(v: DocVersion) {
  return {
    id: v.id,
    version: v.version,
    fileName: v.fileName,
    mimeType: v.mimeType,
    size: v.size,
    sha256: v.sha256,
    changeNote: v.changeNote,
    uploadedById: v.uploadedById,
    createdAt: v.createdAt,
  };
}

function docView(d: Doc, latest: DocVersion | undefined, count: number) {
  return {
    id: d.id,
    title: d.title,
    category: d.category,
    description: d.description,
    accessScope: d.accessScope,
    placeId: d.placeId,
    inventoryItemId: d.inventoryItemId,
    authorId: d.authorId,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    archived: !!d.archivedAt,
    version: latest?.version ?? null,
    fileName: latest?.fileName ?? null,
    mimeType: latest?.mimeType ?? null,
    size: latest?.size ?? null,
    versionsCount: count,
  };
}

@Injectable()
export class DocumentsService {
  constructor(
    @InjectRepository(Doc) private docs: Repository<Doc>,
    @InjectRepository(DocVersion) private versions: Repository<DocVersion>,
    @InjectRepository(Place) private places: Repository<Place>,
    @InjectDataSource() private ds: DataSource,
    private storage: StorageService,
    private audit: AuditService,
  ) {}

  async list(q: ListDocsQuery, actor: Actor) {
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(q.limit ?? 50)));
    const qb = this.docs.createQueryBuilder('d');
    if (!supervisor(actor.role)) {
      qb.andWhere('d.accessScope = :scope', { scope: AccessScope.Members });
    }
    if (actor.role === 'admin' && q.archived === 'true') {
      qb.andWhere('d.archivedAt IS NOT NULL');
    } else {
      qb.andWhere('d.archivedAt IS NULL');
    }
    if (q.category) qb.andWhere('d.category = :cat', { cat: q.category });
    if (q.placeId) qb.andWhere('d.placeId = :pid', { pid: q.placeId });
    if (q.inventoryItemId) {
      qb.andWhere('d.inventoryItemId = :iid', { iid: q.inventoryItemId });
    }
    if (q.search) {
      qb.andWhere(
        '(d.title ILIKE :s OR d.category ILIKE :s OR d.description ILIKE :s)',
        { s: `%${escapeLike(q.search)}%` },
      );
    }
    qb.orderBy('d.updatedAt', 'DESC')
      .addOrderBy('d.id', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);
    const [rows, total] = await qb.getManyAndCount();
    const vers = rows.length
      ? await this.versions.find({
          where: { docId: In(rows.map((d) => d.id)) },
          order: { version: 'DESC' },
        })
      : [];
    const items = rows.map((d) => {
      const own = vers.filter((v) => v.docId === d.id);
      return docView(d, own[0], own.length);
    });
    return { items, total, page, limit };
  }

  async get(id: string, actor: Actor) {
    const d = await this.accessible(id, actor);
    const vers = await this.versions.find({
      where: { docId: id },
      order: { version: 'DESC' },
    });
    return docView(d, vers[0], vers.length);
  }

  async listVersions(id: string, actor: Actor) {
    await this.accessible(id, actor);
    const vers = await this.versions.find({
      where: { docId: id },
      order: { version: 'DESC' },
    });
    return vers.map(versionView);
  }

  async create(
    dto: CreateDocDto,
    file: UploadedFileLike | undefined,
    actor: Actor,
  ) {
    const info = validateUpload(file, DOCUMENT_EXTENSIONS);
    if (dto.placeId) await this.requirePlace(dto.placeId);
    const storedName = randomUUID();
    await this.storage.save(`documents/${storedName}`, file!.buffer);
    try {
      return await this.ds.transaction(async (m) => {
        const doc = await m.save(
          Doc,
          m.create(Doc, {
            title: dto.title,
            category: dto.category,
            description: dto.description ?? '',
            accessScope: dto.accessScope ?? AccessScope.Members,
            placeId: dto.placeId ?? null,
            inventoryItemId: dto.inventoryItemId ?? null,
            authorId: actor.id,
            archivedAt: null,
          }),
        );
        const ver = await m.save(
          DocVersion,
          m.create(DocVersion, {
            docId: doc.id,
            version: 1,
            fileName: info.fileName,
            mimeType: info.mime,
            size: file!.size,
            sha256: createHash('sha256').update(file!.buffer).digest('hex'),
            storedName,
            changeNote: '',
            uploadedById: actor.id,
          }),
        );
        await this.audit.log(
          {
            actorId: actor.id,
            action: 'document.created',
            entity: 'document',
            entityId: doc.id,
            meta: { title: doc.title, version: 1, fileName: ver.fileName },
          },
          m,
        );
        return docView(doc, ver, 1);
      });
    } catch (e) {
      await this.storage.remove(`documents/${storedName}`);
      throw e;
    }
  }

  async addVersion(
    id: string,
    dto: AddVersionDto,
    file: UploadedFileLike | undefined,
    actor: Actor,
  ) {
    const info = validateUpload(file, DOCUMENT_EXTENSIONS);
    const storedName = randomUUID();
    await this.storage.save(`documents/${storedName}`, file!.buffer);
    try {
      return await this.ds.transaction(async (m) => {
        const doc = await m.findOne(Doc, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!doc || doc.archivedAt) {
          throw new NotFoundException('Document not found');
        }
        const row = await m
          .createQueryBuilder(DocVersion, 'v')
          .select('MAX(v.version)', 'max')
          .where('v.docId = :id', { id })
          .getRawOne<{ max: number | null }>();
        const next = Number(row?.max ?? 0) + 1;
        const ver = await m.save(
          DocVersion,
          m.create(DocVersion, {
            docId: id,
            version: next,
            fileName: info.fileName,
            mimeType: info.mime,
            size: file!.size,
            sha256: createHash('sha256').update(file!.buffer).digest('hex'),
            storedName,
            changeNote: dto.changeNote ?? '',
            uploadedById: actor.id,
          }),
        );
        await m.update(Doc, { id }, { updatedAt: new Date() });
        await this.audit.log(
          {
            actorId: actor.id,
            action: 'document.version_added',
            entity: 'document',
            entityId: id,
            meta: { version: next, fileName: ver.fileName },
          },
          m,
        );
        return versionView(ver);
      });
    } catch (e) {
      await this.storage.remove(`documents/${storedName}`);
      throw e;
    }
  }

  async update(id: string, dto: UpdateDocDto, actor: Actor) {
    const d = await this.accessible(id, actor);
    if (dto.placeId) await this.requirePlace(dto.placeId);
    const changed: string[] = [];
    for (const k of [
      'title',
      'category',
      'description',
      'accessScope',
      'placeId',
      'inventoryItemId',
    ] as const) {
      const v = dto[k];
      if (v !== undefined && v !== d[k]) {
        (d as unknown as Record<string, unknown>)[k] = v;
        changed.push(k);
      }
    }
    if (changed.length) {
      await this.docs.save(d);
      await this.audit.log({
        actorId: actor.id,
        action: 'document.updated',
        entity: 'document',
        entityId: id,
        meta: { fields: changed },
      });
    }
    return this.get(id, actor);
  }

  async archive(id: string, actor: Actor) {
    const d = await this.accessible(id, actor);
    d.archivedAt = new Date();
    await this.docs.save(d);
    await this.audit.log({
      actorId: actor.id,
      action: 'document.archived',
      entity: 'document',
      entityId: id,
      meta: { title: d.title },
    });
    return { ok: true };
  }

  async download(id: string, versionNo: string | undefined, actor: Actor) {
    await this.accessible(id, actor);
    let ver: DocVersion | null;
    if (versionNo) {
      ver = await this.versions.findOneBy({
        docId: id,
        version: Number(versionNo),
      });
    } else {
      ver = await this.versions.findOne({
        where: { docId: id },
        order: { version: 'DESC' },
      });
    }
    if (!ver) throw new NotFoundException('Version not found');
    const stream = await this.storage.streamOrFail(
      `documents/${ver.storedName}`,
    );
    return { ver, stream };
  }

  private async accessible(id: string, actor: Actor) {
    const d = await this.docs.findOneBy({ id });
    if (
      !d ||
      (d.archivedAt && actor.role !== 'admin') ||
      (!supervisor(actor.role) && d.accessScope !== AccessScope.Members)
    ) {
      throw new NotFoundException('Document not found');
    }
    return d;
  }

  private async requirePlace(id: string) {
    if (!(await this.places.existsBy({ id }))) {
      throw new BadRequestException('Unknown place');
    }
  }
}
