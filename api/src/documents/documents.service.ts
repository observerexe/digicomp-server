import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { Action, can } from '../auth/policy';
import {
  DOCUMENT_EXTENSIONS,
  UploadedFileLike,
  validateUpload,
} from '../files/file-validation';
import { StorageService } from '../files/storage.service';
import { assertDictionaryItem } from '../dictionaries/dictionary-usage';
import { AddVersionDto, CreateDocDto, UpdateDocDto } from './dto';
import { AccessScope, Doc, DOCUMENT_CATEGORY, DocVersion } from './doc.entity';
import type { Plain } from '../common/responses.dto';
import type { DocDto, DocVersionDto } from './responses.dto';

type Actor = { id: string; role: string };

/** An uploaded file kept in the storage, not yet a version of a document. */
export type StoredFile = Pick<
  DocVersion,
  'storedName' | 'fileName' | 'mimeType' | 'size' | 'sha256'
>;

function versionView(v: DocVersion): DocVersionDto {
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

function docView(
  d: Doc,
  latest: DocVersion | undefined,
  count: number,
): Plain<DocDto> {
  return {
    id: d.id,
    title: d.title,
    category: d.category,
    description: d.description,
    accessScope: d.accessScope,
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
    @InjectDataSource() private ds: DataSource,
    private storage: StorageService,
    private audit: AuditService,
  ) {}

  async get(id: string, actor: Actor): Promise<DocDto> {
    const d = await this.accessible(id, actor);
    const vers = await this.versions.find({
      where: { docId: id },
      order: { version: 'DESC' },
    });
    return docView(d, vers[0], vers.length);
  }

  async listVersions(id: string, actor: Actor): Promise<DocVersionDto[]> {
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
    const stored = await this.store(file, DOCUMENT_EXTENSIONS);
    try {
      await assertDictionaryItem(
        this.ds.manager,
        DOCUMENT_CATEGORY,
        dto.category,
      );
      return await this.ds.transaction(async (m) => {
        const { doc, ver } = await this.insertDoc(
          m,
          {
            title: dto.title,
            category: dto.category,
            description: dto.description ?? '',
            accessScope: dto.accessScope ?? AccessScope.Members,
          },
          stored,
          actor,
        );
        return docView(doc, ver, 1);
      });
    } catch (e) {
      await this.discard(stored);
      throw e;
    }
  }

  async addVersion(
    id: string,
    dto: AddVersionDto,
    file: UploadedFileLike | undefined,
    actor: Actor,
  ) {
    const stored = await this.store(file, DOCUMENT_EXTENSIONS);
    try {
      return await this.ds.transaction(async (m) => {
        const doc = await m.findOne(Doc, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!doc || doc.archivedAt || doc.deletedAt) {
          throw new NotFoundException('Document not found');
        }
        const ver = await this.insertVersion(
          m,
          doc,
          stored,
          dto.changeNote ?? '',
          actor,
        );
        return versionView(ver);
      });
    } catch (e) {
      await this.discard(stored);
      throw e;
    }
  }

  /**
   * Checks an uploaded file by its content and keeps it in the storage. A
   * caller whose work then fails discards it.
   */
  async store(
    file: UploadedFileLike | undefined,
    extensions: string[],
  ): Promise<StoredFile> {
    const info = validateUpload(file, extensions);
    const storedName = randomUUID();
    await this.storage.save(`documents/${storedName}`, file!.buffer);
    return {
      storedName,
      fileName: info.fileName,
      mimeType: info.mime,
      size: file!.size,
      sha256: createHash('sha256').update(file!.buffer).digest('hex'),
    };
  }

  async discard(f: StoredFile) {
    await this.storage.remove(`documents/${f.storedName}`);
  }

  /** A new archive document with the stored file as version 1 (in `m`). */
  async insertDoc(
    m: EntityManager,
    fields: Pick<Doc, 'title' | 'category' | 'description' | 'accessScope'>,
    f: StoredFile,
    actor: Actor,
  ): Promise<{ doc: Doc; ver: DocVersion }> {
    const doc = await m.save(
      Doc,
      m.create(Doc, { ...fields, authorId: actor.id, archivedAt: null }),
    );
    const ver = await m.save(
      DocVersion,
      m.create(DocVersion, {
        ...f,
        docId: doc.id,
        version: 1,
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
    return { doc, ver };
  }

  /** The stored file as the next version of `doc` (locked by the caller, in `m`). */
  async insertVersion(
    m: EntityManager,
    doc: Doc,
    f: StoredFile,
    changeNote: string,
    actor: Actor,
  ): Promise<DocVersion> {
    const row = await m
      .createQueryBuilder(DocVersion, 'v')
      .select('MAX(v.version)', 'max')
      .where('v.docId = :id', { id: doc.id })
      .getRawOne<{ max: number | null }>();
    const next = Number(row?.max ?? 0) + 1;
    const ver = await m.save(
      DocVersion,
      m.create(DocVersion, {
        ...f,
        docId: doc.id,
        version: next,
        changeNote,
        uploadedById: actor.id,
      }),
    );
    await m.update(Doc, { id: doc.id }, { updatedAt: new Date() });
    await this.audit.log(
      {
        actorId: actor.id,
        action: 'document.version_added',
        entity: 'document',
        entityId: doc.id,
        meta: { version: next, fileName: ver.fileName },
      },
      m,
    );
    return ver;
  }

  async update(id: string, dto: UpdateDocDto, actor: Actor): Promise<DocDto> {
    const d = await this.accessible(id, actor);
    if (dto.category !== undefined) {
      await assertDictionaryItem(
        this.ds.manager,
        DOCUMENT_CATEGORY,
        dto.category,
        d.category,
      );
    }
    const changed: string[] = [];
    for (const k of [
      'title',
      'category',
      'description',
      'accessScope',
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

  /** «В архів»: out of the Archive's list, kept (staff see it there). */
  async archive(id: string, actor: Actor): Promise<DocDto> {
    return this.setArchived(id, true, actor);
  }

  /** «Повернути з архіву»: back to the Archive's list. */
  async unarchive(id: string, actor: Actor): Promise<DocDto> {
    return this.setArchived(id, false, actor);
  }

  private async setArchived(id: string, archived: boolean, actor: Actor) {
    const d = await this.accessible(id, actor);
    if (!!d.archivedAt !== archived) {
      d.archivedAt = archived ? new Date() : null;
      await this.docs.save(d);
      await this.audit.log({
        actorId: actor.id,
        action: archived ? 'document.archived' : 'document.unarchived',
        entity: 'document',
        entityId: id,
        meta: { title: d.title },
      });
    }
    return this.get(id, actor);
  }

  async download(id: string, versionNo: string | undefined, actor: Actor) {
    await this.accessible(id, actor);
    return this.file(
      this.ds.manager,
      id,
      versionNo ? Number(versionNo) : undefined,
    );
  }

  /** A version of a document (none — the latest) and its file; no access check. */
  async file(m: EntityManager, id: string, versionNo?: number) {
    const ver = await m.findOne(DocVersion, {
      where: { docId: id, ...(versionNo ? { version: versionNo } : {}) },
      order: { version: 'DESC' },
    });
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
      d.deletedAt ||
      (d.archivedAt && !can(actor, Action.DocumentsManage)) ||
      (!can(actor, Action.DocumentsManage) &&
        d.accessScope !== AccessScope.Members)
    ) {
      throw new NotFoundException('Document not found');
    }
    return d;
  }
}
