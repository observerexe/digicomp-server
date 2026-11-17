import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { Action, assertCan, can, type Actor } from '../auth/policy';
import type { UploadedFileLike } from '../files/file-validation';
import { StorageService } from '../files/storage.service';
import { imagesOf, type PaperNode } from '../../../shared/editor-schema';
import { PaperAdapterRegistry } from './adapters';
import { imageInfo } from './image-info';
import { PaperImage, PaperImageUse } from './paper-image.entity';
import { whereSeen } from './paper.links';
import { Paper, PaperStatus } from './paper.entity';
import {
  PaperTemplate,
  PaperTemplateVersion,
  TemplateCreators,
} from './template.entities';
import type { PaperImageDto } from './responses.dto';

/** The browser shrinks a picture before upload; the API takes no more. */
export const PAPER_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PAPER_IMAGE_MAX_SIDE = 2000;
/** An image no document or template holds goes this long after its upload. */
const UNUSED_MS = 24 * 60 * 60 * 1000;
const PURGE_EVERY_MS = 60 * 60 * 1000;
const DIR = 'paper-images';

export const PaperImageErrors = {
  NotFound: 'Paper image not found',
  TooLarge: 'Image is too large',
} as const;

const ext = (mime: string) => (mime === 'image/png' ? 'png' : 'jpg');
const fileOf = (i: Pick<PaperImage, 'id' | 'mimeType'>) =>
  `${DIR}/${i.id}.${ext(i.mimeType)}`;

/** An image's file for a DOCX copy. */
export type ImageFile = {
  type: 'png' | 'jpg';
  data: Buffer;
  width: number;
  height: number;
};

/**
 * «Зображення» of editor documents and templates: upload, who sees one,
 * which documents hold it (paper_image_uses) and the hourly clean-up of
 * the ones nothing holds.
 */
@Injectable()
export class PaperImagesService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(PaperImagesService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectDataSource() private ds: DataSource,
    private storage: StorageService,
    private audit: AuditService,
    private adapters: PaperAdapterRegistry,
  ) {}

  onApplicationBootstrap() {
    if (process.env.PAPER_IMAGES_AUTO_PURGE_DISABLED === 'true') return;
    const run = () =>
      this.purgeUnused().catch((e: unknown) =>
        this.logger.error(`Image clean-up failed: ${String(e)}`),
      );
    this.timer = setInterval(run, PURGE_EVERY_MS);
    this.timer.unref();
    void run();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** A PNG or JPEG (by its content) up to 5 MB and 2000 px a side. */
  async upload(
    file: UploadedFileLike | undefined,
    actor: Actor,
  ): Promise<PaperImageDto> {
    assertCan(actor, Action.PaperImagesUpload);
    if (!file || !file.buffer?.length) {
      throw new BadRequestException('File is required');
    }
    if (file.size > PAPER_IMAGE_MAX_BYTES) {
      throw new BadRequestException('File too large');
    }
    const info = imageInfo(file.buffer);
    if (!info) throw new BadRequestException('File type is not allowed');
    if (
      info.width > PAPER_IMAGE_MAX_SIDE ||
      info.height > PAPER_IMAGE_MAX_SIDE
    ) {
      throw new BadRequestException(PaperImageErrors.TooLarge);
    }
    const image = {
      id: randomUUID(),
      mimeType: info.mime,
      width: info.width,
      height: info.height,
      size: file.buffer.length,
      sha256: createHash('sha256').update(file.buffer).digest('hex'),
      uploadedById: actor.id,
    };
    // The file first: a row without its file never shows.
    await this.storage.save(fileOf(image), file.buffer);
    try {
      await this.ds.transaction(async (m) => {
        await m.insert(PaperImage, image);
        await this.audit.log(
          {
            actorId: actor.id,
            action: 'paper.image_uploaded',
            entity: 'paper_image',
            entityId: image.id,
            meta: {
              width: image.width,
              height: image.height,
              size: image.size,
            },
          },
          m,
        );
      });
    } catch (e) {
      await this.storage.remove(fileOf(image));
      throw e;
    }
    return { id: image.id, width: image.width, height: image.height };
  }

  /** The image's file, if the actor sees it; otherwise as if there is none. */
  async open(id: string, actor: Actor) {
    const m = this.ds.manager;
    const image = await m.findOneBy(PaperImage, { id });
    const shared =
      !!image && (await this.heldWhereSeen(m, [id], actor)).has(id);
    if (
      !image ||
      !can(actor, Action.PaperImagesRead, {
        ownerId: image.uploadedById,
        shared,
      })
    ) {
      throw new NotFoundException(PaperImageErrors.NotFound);
    }
    return { image, stream: await this.storage.streamOrFail(fileOf(image)) };
  }

  /**
   * Images new to a document or a template (`old` did not hold them) exist
   * and the actor sees them; otherwise PAPER_IMAGE_NOT_FOUND. They are
   * locked till the save commits: the clean-up does not take them meanwhile.
   */
  async checkNew(
    m: EntityManager,
    next: PaperNode,
    old: PaperNode | null,
    actor: Actor,
  ) {
    const had = new Set(old ? imagesOf(old) : []);
    const ids = imagesOf(next).filter((id) => !had.has(id));
    if (!ids.length) return;
    const rows = await m
      .getRepository(PaperImage)
      .createQueryBuilder('i')
      .select(['i.id', 'i.uploadedById'])
      .where('i.id IN (:...ids)', { ids })
      .setLock('for_key_share')
      .getMany();
    const held = await this.heldWhereSeen(m, ids, actor);
    const seen = new Set(
      rows
        .filter((i) =>
          can(actor, Action.PaperImagesRead, {
            ownerId: i.uploadedById,
            shared: held.has(i.id),
          }),
        )
        .map((i) => i.id),
    );
    if (ids.some((id) => !seen.has(id))) {
      throw new NotFoundException(PaperImageErrors.NotFound);
    }
  }

  /**
   * The images a document holds, as its content is: a draft's set is its
   * content's; a document past its draft only gains (its snapshots refer to
   * the images it had).
   */
  async syncPaper(
    m: EntityManager,
    p: Pick<Paper, 'id' | 'status'>,
    content: PaperNode,
  ) {
    await this.sync(
      m,
      'paper_id',
      p.id,
      imagesOf(content),
      p.status === PaperStatus.Draft,
    );
  }

  /** The images a version of a template holds: its body's. */
  async syncVersion(m: EntityManager, versionId: string, body: PaperNode) {
    await this.sync(m, 'template_version_id', versionId, imagesOf(body), true);
  }

  private async sync(
    m: EntityManager,
    column: 'paper_id' | 'template_version_id',
    ownerId: string,
    want: string[],
    replace: boolean,
  ) {
    if (replace) {
      await m.query(
        `DELETE FROM "paper_image_uses" WHERE "${column}" = $1 AND NOT ("image_id" = ANY($2::uuid[]))`,
        [ownerId, want],
      );
    }
    if (!want.length) return;
    await m.query(
      `INSERT INTO "paper_image_uses" ("image_id", "${column}")
       SELECT "id", $1 FROM "paper_images" WHERE "id" = ANY($2::uuid[])
       ON CONFLICT DO NOTHING`,
      [ownerId, want],
    );
  }

  /** Files of the images a sheet shows (a DOCX copy); a lost file is left out. */
  async files(html: string): Promise<Map<string, ImageFile>> {
    const ids = [
      ...new Set(
        [...html.matchAll(/\/api\/paper-images\/([0-9a-f-]{36})/g)].map(
          (x) => x[1]!,
        ),
      ),
    ];
    const out = new Map<string, ImageFile>();
    if (!ids.length) return out;
    const rows = await this.ds.manager.findBy(PaperImage, { id: In(ids) });
    for (const i of rows) {
      try {
        out.set(i.id, {
          type: ext(i.mimeType) as ImageFile['type'],
          data: await this.storage.read(fileOf(i)),
          width: i.width,
          height: i.height,
        });
      } catch {
        this.logger.warn(`Image file is missing: ${i.id}`);
      }
    }
    return out;
  }

  /**
   * Images no document or template holds, a day after upload: rows, then
   * files. A save that takes one meanwhile holds its lock (see checkNew):
   * the delete fails on it and the next run leaves it.
   */
  async purgeUnused(now = new Date()): Promise<number> {
    const res = await this.ds
      .createQueryBuilder()
      .delete()
      .from(PaperImage)
      .where('created_at < :before', {
        before: new Date(now.getTime() - UNUSED_MS),
      })
      .andWhere(
        'NOT EXISTS (SELECT 1 FROM "paper_image_uses" u WHERE u.image_id = "paper_images"."id")',
      )
      .returning('"id", "mime_type"')
      .execute();
    const rows = (res.raw ?? []) as { id: string; mime_type: string }[];
    for (const r of rows) {
      await this.storage.remove(fileOf({ id: r.id, mimeType: r.mime_type }));
    }
    if (rows.length) {
      await this.audit.log({
        action: 'paper.images_purged',
        entity: 'paper_image',
        meta: { count: rows.length },
      });
    }
    return rows.length;
  }

  /**
   * Among `ids`, the images a document the actor sees holds (staff — every
   * document), or a template version they see: staff — any; others — the
   * current version of a published template open to all, not archived.
   */
  private async heldWhereSeen(
    m: EntityManager,
    ids: string[],
    actor: Actor,
  ): Promise<Set<string>> {
    const out = new Set<string>();
    const papers = await whereSeen(
      m
        .getRepository(Paper)
        .createQueryBuilder('p')
        .innerJoin(PaperImageUse, 'u', 'u.paper_id = p.id')
        .select('u.image_id', 'id')
        .where('u.image_id IN (:...ids)', { ids }),
      actor,
      this.adapters,
    ).getRawMany<{ id: string }>();
    for (const r of papers) out.add(r.id);
    const templates = m
      .getRepository(PaperImageUse)
      .createQueryBuilder('u')
      .innerJoin(PaperTemplateVersion, 'v', 'v.id = u.template_version_id')
      .innerJoin(PaperTemplate, 't', 't.id = v.template_id')
      .select('u.image_id', 'id')
      .where('u.image_id IN (:...ids)', { ids });
    if (!can(actor, Action.PaperTemplatesManage)) {
      templates
        .andWhere('t.current_version_id = v.id')
        .andWhere('t.archived_at IS NULL')
        .andWhere('t.creators = :all', { all: TemplateCreators.All });
    }
    for (const r of await templates.getRawMany<{ id: string }>()) {
      out.add(r.id);
    }
    return out;
  }
}
