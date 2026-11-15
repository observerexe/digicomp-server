import {
  BadRequestException,
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
import { RecordFieldsService } from '../records/record-fields.service';
import { User } from '../users/user.entity';
import type { OkDto, Plain } from '../common/responses.dto';
import {
  EMPTY_CONTENT,
  valueText,
  type FieldValues,
  type PaperContent,
} from './content';
import type {
  CopyPaperDto,
  CreatePaperDto,
  ListPapersQuery,
  UpdatePaperDto,
} from './dto';
import { Paper, PaperStatus, PaperVisibility } from './paper.entity';
import {
  checkContent,
  checkValues,
  fieldInvalid,
  resolveFields,
  type PaperField,
} from './paper-fields';
import { paperPrintHtml } from './print';
import type {
  PaperDto,
  PaperFieldDto,
  PaperItemDto,
  PaperListDto,
} from './responses.dto';
import { PaperTemplate, PaperTemplateVersion } from './template.entities';
import { TemplatesService } from './templates.service';

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

/** The template of a document, the version it keeps to and its fields. */
type Form = {
  template: PaperTemplate;
  version: PaperTemplateVersion;
  fields: PaperField[];
};

@Injectable()
export class PaperworkService {
  constructor(
    @InjectDataSource() private ds: DataSource,
    private audit: AuditService,
    private org: OrgService,
    private templates: TemplatesService,
    private recordFields: RecordFieldsService,
  ) {}

  /** Fields of the version with limits and choices (see resolveFields). */
  private async fieldsOf(
    m: EntityManager,
    template: PaperTemplate,
    version: PaperTemplateVersion,
  ): Promise<PaperField[]> {
    const schema = template.target
      ? await this.recordFields.schema(template.target)
      : null;
    return resolveFields(m, version.fields, schema);
  }

  /** The document's template; null — a free document. */
  private async formOf(m: EntityManager, p: Paper): Promise<Form | null> {
    if (!p.templateVersionId) return null;
    const version = await m.findOneByOrFail(PaperTemplateVersion, {
      id: p.templateVersionId,
    });
    const template = await m.findOneByOrFail(PaperTemplate, {
      id: version.templateId,
    });
    return {
      template,
      version,
      fields: await this.fieldsOf(m, template, version),
    };
  }

  /**
   * Content and values of a document checked against its template:
   * values — whole and valid (see checkValues), content — keeping to the body.
   */
  private checked(
    form: Form | null,
    actor: Actor,
    input: { content?: PaperContent; values?: Record<string, unknown> },
    old: { content: PaperContent; values: FieldValues },
  ) {
    const staff = can(actor, Action.PapersFillStaff);
    if (input.content !== undefined) {
      checkContent(
        input.content,
        form?.version.body ?? null,
        form?.fields ?? [],
        old.content,
        staff,
      );
    }
    if (input.values === undefined) return undefined;
    if (!form) {
      const key = Object.keys(input.values)[0];
      if (key !== undefined) throw fieldInvalid(key);
      return {};
    }
    return checkValues(input.values, form.fields, old.values, staff);
  }

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

  private async view(
    m: EntityManager,
    p: Paper,
    actor: Actor,
  ): Promise<Plain<PaperDto>> {
    const form = await this.formOf(m, p);
    const editable = canEdit(p, actor);
    const staff = can(actor, Action.PapersFillStaff);
    return {
      ...itemView(p),
      content: p.content,
      values: p.values,
      template: form && {
        id: form.template.id,
        title: form.template.title,
        version: form.version.number,
        fields: form.fields.map((f): Plain<PaperFieldDto> => ({
          ...f,
          canFill:
            editable &&
            !f.type.includes('ref:') &&
            (f.fill === 'author' || staff),
        })),
      },
      canEdit: editable,
    };
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
    const m = this.ds.manager;
    return this.view(m, await this.accessible(m, id, actor), actor);
  }

  /**
   * Print page of the current content with the values of fields,
   * header from «Реквізити».
   */
  async printHtml(id: string, actor: Actor): Promise<string> {
    const m = this.ds.manager;
    const p = await this.accessible(m, id, actor);
    const form = await this.formOf(m, p);
    const fields = new Map((form?.fields ?? []).map((f) => [f.key, f]));
    const { institution, groupName } = await this.org.get();
    return paperPrintHtml({
      title: p.title,
      content: p.content,
      requisites: { institution, groupName },
      fill: {
        text: (key) => {
          const f = fields.get(key);
          const v = p.values[key];
          return f && v !== undefined ? valueText(f.type, v, f.options) : null;
        },
        hidden: (key) => !fields.get(key)?.print,
      },
    });
  }

  /** A free document, or one made from a template's current version. */
  async create(dto: CreatePaperDto, actor: Actor): Promise<PaperDto> {
    if (dto.templateId && dto.content) {
      throw new BadRequestException(
        'Content of a template document is its body',
      );
    }
    return this.ds.transaction(async (m) => {
      const from = dto.templateId
        ? await this.templates.forPaper(m, dto.templateId, actor)
        : null;
      return this.insert(m, actor, {
        title: dto.title?.trim() || from?.template.title || UNTITLED,
        content: from?.version.body ?? dto.content ?? EMPTY_CONTENT,
        values: {},
        from,
        meta: {},
      });
    });
  }

  /**
   * A copy of a document the actor sees (saving their text when someone
   * else changed the original): the same template version, the given
   * content and values, checked as any save.
   */
  async copy(id: string, dto: CopyPaperDto, actor: Actor): Promise<PaperDto> {
    return this.ds.transaction(async (m) => {
      const source = await this.accessible(m, id, actor);
      let from: {
        template: PaperTemplate;
        version: PaperTemplateVersion;
      } | null = null;
      if (source.templateVersionId) {
        const v = await m.findOneByOrFail(PaperTemplateVersion, {
          id: source.templateVersionId,
        });
        from = await this.templates.forPaper(m, v.templateId, actor, v.id);
      }
      const form = from && {
        ...from,
        fields: await this.fieldsOf(m, from.template, from.version),
      };
      const values =
        this.checked(
          form,
          actor,
          { content: dto.content, values: dto.values ?? {} },
          { content: from?.version.body ?? EMPTY_CONTENT, values: {} },
        ) ?? {};
      return this.insert(m, actor, {
        title: dto.title?.trim() || source.title,
        content: dto.content,
        values,
        from,
        meta: { copyOf: source.id },
      });
    });
  }

  private async insert(
    m: EntityManager,
    actor: Actor,
    p: {
      title: string;
      content: PaperContent;
      values: FieldValues;
      from: { template: PaperTemplate; version: PaperTemplateVersion } | null;
      meta: Record<string, unknown>;
    },
  ): Promise<PaperDto> {
    const repo = m.getRepository(Paper);
    const saved = await repo.save(
      repo.create({
        title: p.title,
        content: p.content,
        values: p.values,
        templateVersionId: p.from?.version.id ?? null,
        visibility: p.from?.template.visibility ?? PaperVisibility.Author,
        authorId: actor.id,
      }),
    );
    await this.audit.log(
      {
        actorId: actor.id,
        action: 'paper.created',
        entity: 'paper',
        entityId: saved.id,
        meta: {
          title: saved.title,
          ...(p.from
            ? {
                templateId: p.from.template.id,
                version: p.from.version.number,
              }
            : {}),
          ...p.meta,
        },
      },
      m,
    );
    return this.view(m, await this.accessible(m, saved.id, actor), actor);
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
      const text =
        dto.title !== undefined ||
        dto.content !== undefined ||
        dto.values !== undefined;
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
      const values =
        dto.content !== undefined || dto.values !== undefined
          ? this.checked(await this.formOf(m, p), actor, dto, p)
          : undefined;

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
      // Content and values are not compared: jsonb does not keep key order.
      if (dto.content !== undefined) p.content = dto.content;
      if (values !== undefined) p.values = values;
      const filled = dto.content !== undefined || values !== undefined;
      if (!filled && !Object.keys(changes).length) return itemView(p);

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
              ...(values !== undefined ? { values: true } : {}),
            },
          },
          m,
        );
      }
      return itemView(p);
    });
  }

  /** How many documents hold this item in a field of a template (not bound). */
  async countItem(m: EntityManager, dictionary: string, item: string) {
    const [row] = await m.query<{ n: number }[]>(
      `SELECT count(DISTINCT p.id)::int AS n
         FROM "papers" p
         JOIN "paper_template_versions" v ON v.id = p.template_version_id
         CROSS JOIN LATERAL jsonb_array_elements(v.fields) f
        WHERE f->>'dictionary' = $1
          AND p.values -> (f->>'key') @> to_jsonb(CAST($2 AS text))`,
      [dictionary, item],
    );
    return row?.n ?? 0;
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
