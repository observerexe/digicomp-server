import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { Action, Actor, assertCan, can } from '../auth/policy';
import { escapeLike } from '../common/like';
import { OrgService } from '../org/org.service';
import { User } from '../users/user.entity';
import type { OkDto, Plain } from '../common/responses.dto';
import { EMPTY_CONTENT } from './content';
import type { CreatePaperDto, ListPapersQuery, UpdatePaperDto } from './dto';
import { Paper, PaperStatus, PaperVisibility } from './paper.entity';
import { paperPrintHtml } from './print';
import type { PaperDto, PaperItemDto, PaperListDto } from './responses.dto';

const UNTITLED = 'Без назви';

/** Seen by every member: published (or later) and visible to all. */
function isShared(p: Paper) {
  return (
    p.status !== PaperStatus.Draft && p.visibility === PaperVisibility.Members
  );
}

function itemView(p: Paper): Plain<PaperItemDto> {
  return {
    id: p.id,
    title: p.title,
    status: p.status,
    visibility: p.visibility,
    author: {
      id: p.authorId,
      name: p.author?.name ?? null,
      avatarUrl: p.author?.avatarUrl ?? null,
    },
    revision: p.revision,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function canEdit(p: Paper, actor: Actor) {
  return (
    p.status === PaperStatus.Draft &&
    can(actor, Action.PapersEdit, { ownerId: p.authorId })
  );
}

@Injectable()
export class PaperworkService {
  constructor(
    @InjectDataSource() private ds: DataSource,
    private audit: AuditService,
    private org: OrgService,
  ) {}

  /** The document if the actor sees it; otherwise as if there is none. */
  private async accessible(
    m: EntityManager,
    id: string,
    actor: Actor,
    lock = false,
  ): Promise<Paper> {
    const repo = m.getRepository(Paper);
    const p = await repo.findOne({
      where: { id },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (
      !p ||
      !can(actor, Action.PapersRead, {
        ownerId: p.authorId,
        shared: isShared(p),
      })
    ) {
      throw new NotFoundException('Paper not found');
    }
    // The lock does not go with a join: the author is loaded apart.
    p.author =
      (await m.getRepository(User).findOneBy({ id: p.authorId })) ?? undefined;
    return p;
  }

  private view(p: Paper, actor: Actor): Plain<PaperDto> {
    return { ...itemView(p), content: p.content, canEdit: canEdit(p, actor) };
  }

  async list(q: ListPapersQuery, actor: Actor): Promise<PaperListDto> {
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(q.limit ?? 50)));
    const qb = this.ds
      .getRepository(Paper)
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.author', 'author')
      // Lists never carry the content: it may be large.
      .select([
        'p.id',
        'p.title',
        'p.status',
        'p.visibility',
        'p.revision',
        'p.authorId',
        'p.createdAt',
        'p.updatedAt',
        'author.id',
        'author.name',
        'author.avatarUrl',
      ]);
    if (!can(actor, Action.PapersReadAll)) {
      // Same rule as PapersRead in policy.ts: own, or published for all.
      qb.andWhere(
        '(p.authorId = :me OR (p.status <> :draft AND p.visibility = :members))',
        {
          me: actor.id,
          draft: PaperStatus.Draft,
          members: PaperVisibility.Members,
        },
      );
    }
    if (q.mine === 'true') qb.andWhere('p.authorId = :me', { me: actor.id });
    if (q.search) {
      qb.andWhere('p.title ILIKE :s', { s: `%${escapeLike(q.search)}%` });
    }
    qb.orderBy('p.updatedAt', 'DESC')
      .addOrderBy('p.id', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);
    const [rows, total] = await qb.getManyAndCount();
    return { items: rows.map(itemView), total, page, limit };
  }

  async get(id: string, actor: Actor): Promise<PaperDto> {
    return this.view(await this.accessible(this.ds.manager, id, actor), actor);
  }

  /** Print page of the current content, header from «Реквізити». */
  async printHtml(id: string, actor: Actor): Promise<string> {
    const p = await this.accessible(this.ds.manager, id, actor);
    const { institution, groupName } = await this.org.get();
    return paperPrintHtml({
      title: p.title,
      content: p.content,
      requisites: { institution, groupName },
    });
  }

  async create(dto: CreatePaperDto, actor: Actor): Promise<PaperDto> {
    return this.ds.transaction(async (m) => {
      const repo = m.getRepository(Paper);
      const saved = await repo.save(
        repo.create({
          title: dto.title?.trim() || UNTITLED,
          content: dto.content ?? EMPTY_CONTENT,
          authorId: actor.id,
        }),
      );
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'paper.created',
          entity: 'paper',
          entityId: saved.id,
          meta: { title: saved.title },
        },
        m,
      );
      return this.view(await this.accessible(m, saved.id, actor), actor);
    });
  }

  /**
   * Changes only the given fields. Title and content — the author of a
   * draft (admin — any); visibility — staff. Any change raises the revision.
   * The author's own saves of a draft are not audited: autosave would flood
   * the log, and a draft is not a record yet.
   */
  async update(
    id: string,
    dto: UpdatePaperDto,
    actor: Actor,
  ): Promise<PaperItemDto> {
    return this.ds.transaction(async (m) => {
      const p = await this.accessible(m, id, actor, true);
      const text = dto.title !== undefined || dto.content !== undefined;
      if (text) {
        assertCan(actor, Action.PapersEdit, { ownerId: p.authorId });
      }
      if (dto.visibility !== undefined) {
        assertCan(actor, Action.PapersVisibility);
      }
      if (text && p.status !== PaperStatus.Draft) {
        throw new ConflictException('Paper is not a draft');
      }
      if (dto.revision !== p.revision) {
        throw new ConflictException('Paper was changed by someone else');
      }

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      const title = dto.title?.trim();
      if (title !== undefined && title !== p.title) {
        changes.title = { from: p.title, to: title };
        p.title = title;
      }
      if (dto.visibility !== undefined && dto.visibility !== p.visibility) {
        changes.visibility = { from: p.visibility, to: dto.visibility };
        p.visibility = dto.visibility;
      }
      // Content is not compared: jsonb does not keep key order.
      if (dto.content !== undefined) p.content = dto.content;
      if (dto.content === undefined && !Object.keys(changes).length) {
        return itemView(p);
      }

      p.revision += 1;
      await m.getRepository(Paper).save(p);
      if (changes.visibility || p.authorId !== actor.id) {
        await this.audit.log(
          {
            actorId: actor.id,
            action: 'paper.updated',
            entity: 'paper',
            entityId: p.id,
            meta: {
              authorId: p.authorId,
              changes,
              ...(dto.content !== undefined ? { content: true } : {}),
            },
          },
          m,
        );
      }
      return itemView(p);
    });
  }

  /** A draft only: no record and no number refer to it yet. */
  async remove(id: string, actor: Actor): Promise<OkDto> {
    return this.ds.transaction(async (m) => {
      const p = await this.accessible(m, id, actor, true);
      assertCan(actor, Action.PapersEdit, { ownerId: p.authorId });
      if (p.status !== PaperStatus.Draft) {
        throw new ConflictException('Paper is not a draft');
      }
      await m.getRepository(Paper).delete(p.id);
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'paper.deleted',
          entity: 'paper',
          entityId: p.id,
          meta: { title: p.title, authorId: p.authorId },
        },
        m,
      );
      return { ok: true };
    });
  }
}
