import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, LessThanOrEqual } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { assertCan, type Actor } from '../auth/policy';
import { escapeLike } from '../common/like';
import type { OkDto } from '../common/responses.dto';
import { StorageService } from '../files/storage.service';
import { RecordLink } from '../links/record-link.entity';
import type { ListTrashQuery } from './dto';
import type { TrashItemDto, TrashListDto } from './responses.dto';
import {
  TRASH_DAYS,
  TrashRegistry,
  type TrashableType,
  type TrashRow,
  type TrashType,
} from './trash-registry';

export const TrashErrors = {
  Deleted: 'Already in the trash',
  NotDeleted: 'Not in the trash',
} as const;

const DAY_MS = 86_400_000;
const AUTO_PURGE_EVERY_MS = 60 * 60 * 1000;

/**
 * The trash: «Видалити» moves a record here (hidden everywhere else),
 * staff restore it, the admin — or the server TRASH_DAYS later — deletes it
 * for good. Records whose history refers to them keep their title then.
 */
@Injectable()
export class TrashService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TrashService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectDataSource() private ds: DataSource,
    private registry: TrashRegistry,
    private storage: StorageService,
    private audit: AuditService,
  ) {}

  /** After every module has registered its type (their onModuleInit). */
  onApplicationBootstrap() {
    if (process.env.TRASH_AUTO_PURGE_DISABLED === 'true') return;
    const run = () =>
      this.autoPurge().catch((e: unknown) =>
        this.logger.error(`Auto-purge failed: ${String(e)}`),
      );
    this.timer = setInterval(run, AUTO_PURGE_EVERY_MS);
    this.timer.unref();
    void run();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** «Видалити»: to the trash (the module's manage right). */
  async delete(type: TrashType, id: string, actor: Actor): Promise<OkDto> {
    const t = this.type(type);
    assertCan(actor, t.manage);
    await this.ds.transaction(async (m) => {
      const row = await this.locked(t, id, m);
      if (row.deletedAt) throw new ConflictException(TrashErrors.Deleted);
      await t.beforeDelete?.(id, actor, m);
      await m.update(
        t.entity,
        { id },
        {
          deletedAt: new Date(),
          deletedById: actor.id,
        },
      );
      await this.log(m, actor.id, 'trash.deleted', type, row, {});
    });
    return { ok: true };
  }

  /** «Відновити» (staff): back where it was. */
  async restore(type: TrashType, id: string, actor: Actor): Promise<OkDto> {
    const t = this.type(type);
    await this.ds.transaction(async (m) => {
      const row = await this.locked(t, id, m);
      if (!row.deletedAt) throw new ConflictException(TrashErrors.NotDeleted);
      await m.update(t.entity, { id }, { deletedAt: null, deletedById: null });
      await this.log(m, actor.id, 'trash.restored', type, row, {});
    });
    return { ok: true };
  }

  /**
   * «Видалити назавжди» (the admin; `actor` null — the server). With
   * history (its module's rows, documents of the editor beyond drafts) the
   * record keeps its title; otherwise it is erased with its links and files.
   */
  async purge(
    type: TrashType,
    id: string,
    actor: Actor | null,
    meta: Record<string, unknown> = {},
  ): Promise<OkDto> {
    const t = this.type(type);
    const files = await this.ds.transaction(async (m) => {
      const row = await this.locked(t, id, m);
      if (!row.deletedAt) throw new ConflictException(TrashErrors.NotDeleted);
      const keep =
        (await this.papersRefer(type, id, m)) || (await t.hasHistory(id, m));
      const files = await t.purge(id, keep, m);
      if (keep) {
        await m.update(t.entity, { id }, { purgedAt: new Date() });
      } else {
        await m.delete(RecordLink, { fromType: type, fromId: id });
        await m.delete(RecordLink, { toType: type, toId: id });
        await m.delete(t.entity, { id });
      }
      await this.log(m, actor?.id ?? null, 'trash.purged', type, row, {
        kept: keep,
        ...meta,
      });
      return files;
    });
    for (const f of files) {
      await this.storage
        .remove(f)
        .catch((e: unknown) =>
          this.logger.warn(`File ${f} not removed: ${String(e)}`),
        );
    }
    return { ok: true };
  }

  /** What lies in the trash, last deleted first. */
  async list(q: ListTrashQuery): Promise<TrashListDto> {
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(q.limit ?? 50)));
    const parts = this.registry
      .entries()
      .filter(([type]) => !q.type || q.type === type)
      .map(([type, t]) => {
        const meta = this.ds.getMetadata(t.entity);
        const code = meta.findColumnWithPropertyName('code')
          ? 'code'
          : 'NULL::varchar';
        return `SELECT '${type}'::text AS type, id, title, ${code} AS code, deleted_at, deleted_by_id
          FROM "${meta.tableName}" WHERE deleted_at IS NOT NULL AND purged_at IS NULL`;
      });
    if (!parts.length) return { items: [], total: 0, page, limit };
    const search = q.search?.trim() ? `%${escapeLike(q.search.trim())}%` : null;
    const union = `(${parts.join(' UNION ALL ')}) t`;
    const where = `$1::text IS NULL OR t.title ILIKE $1 OR t.code ILIKE $1`;
    const [{ total }] = await this.ds.query<{ total: number }[]>(
      `SELECT count(*)::int AS total FROM ${union} WHERE ${where}`,
      [search],
    );
    const rows = await this.ds.query<
      {
        type: TrashType;
        id: string;
        title: string;
        code: string | null;
        deleted_at: Date;
        deleted_by_id: string | null;
        name: string | null;
      }[]
    >(
      `SELECT t.*, u.name FROM ${union}
       LEFT JOIN users u ON u.id = t.deleted_by_id
       WHERE ${where}
       ORDER BY t.deleted_at DESC, t.id LIMIT $2 OFFSET $3`,
      [search, limit, (page - 1) * limit],
    );
    const items: TrashItemDto[] = rows.map((r) => ({
      type: r.type,
      id: r.id,
      title: r.title,
      code: r.code,
      deletedAt: r.deleted_at,
      deletedBy:
        r.deleted_by_id && r.name !== null
          ? { id: r.deleted_by_id, name: r.name }
          : null,
      purgeAt: new Date(r.deleted_at.getTime() + TRASH_DAYS * DAY_MS),
    }));
    return { items, total, page, limit };
  }

  /** The server deletes for good what lay in the trash TRASH_DAYS. */
  async autoPurge(now = new Date()) {
    const cutoff = new Date(now.getTime() - TRASH_DAYS * DAY_MS);
    let count = 0;
    for (const [type, t] of this.registry.entries()) {
      const rows = await this.ds.manager.find(t.entity, {
        select: { id: true },
        where: { deletedAt: LessThanOrEqual(cutoff), purgedAt: IsNull() },
      });
      for (const { id } of rows) {
        try {
          await this.purge(type, id, null, { auto: true, days: TRASH_DAYS });
          count++;
        } catch (e) {
          this.logger.error(`Auto-purge of ${type} ${id}: ${String(e)}`);
        }
      }
    }
    if (count) this.logger.log(`Purged ${count} record(s) from the trash`);
    return count;
  }

  private type(type: TrashType): TrashableType {
    const t = this.registry.get(type);
    if (!t) throw new BadRequestException('Record type cannot be deleted');
    return t;
  }

  /** The record's row, locked; a record deleted for good is not found. */
  private async locked(t: TrashableType, id: string, m: EntityManager) {
    const row = await m.findOne(t.entity, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!row || row.purgedAt) throw new NotFoundException('Record not found');
    return row;
  }

  /** Documents of the editor beyond drafts refer to it or are about it. */
  private async papersRefer(type: TrashType, id: string, m: EntityManager) {
    const [{ refer }] = await m.query<{ refer: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM record_links l JOIN papers p ON p.id = l.from_id
         WHERE l.from_type = 'paper' AND l.to_type = $1 AND l.to_id = $2
           AND p.status <> 'draft'
       ) OR EXISTS (
         SELECT 1 FROM papers p
         WHERE p.target_type = $1 AND p.target_id = $2 AND p.status <> 'draft'
       ) AS refer`,
      [type, id],
    );
    return refer;
  }

  private log(
    m: EntityManager,
    actorId: string | null,
    action: string,
    type: TrashType,
    row: TrashRow,
    meta: Record<string, unknown>,
  ) {
    return this.audit.log(
      {
        actorId: actorId ?? undefined,
        action,
        entity: type,
        entityId: row.id,
        meta: { title: row.title, ...meta },
      },
      m,
    );
  }
}
