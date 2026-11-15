import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { Action, Actor, assertCan, can } from '../auth/policy';
import { escapeLike } from '../common/like';
import { LinkRegistry } from '../links/link-registry';
import { removeLinksOf } from '../links/links.sql';
import { RecordLink } from '../links/record-link.entity';
import { OrgService } from '../org/org.service';
import { RecordFieldsService } from '../records/record-fields.service';
import type { RecordType } from '../records/field-types';
import { User } from '../users/user.entity';
import type { OkDto, Plain } from '../common/responses.dto';
import {
  EMPTY_CONTENT,
  isFillable,
  normalizeValue,
  valueText,
  withZoneText,
  zonesOf,
  zoneText,
  type FieldValues,
  type PaperContent,
} from './content';
import { PaperAdapterRegistry, type RecordValues } from './adapters';
import type {
  CancelPaperDto,
  CopyPaperDto,
  CreatePaperDto,
  ListPapersQuery,
  UpdatePaperDto,
} from './dto';
import { Paper, PaperStatus, PaperVisibility } from './paper.entity';
import { seenThroughTarget, whereSeen } from './paper.links';
import {
  checkNewRefs,
  fillableType,
  seenRefs,
  syncLinks,
  TARGET_ROLE,
} from './paper-refs';
import {
  checkContent,
  checkValues,
  fieldInvalid,
  PaperFieldErrors,
  resolveFields,
  type PaperField,
} from './paper-fields';
import { paperPrintHtml } from './print';
import type {
  PaperDto,
  PaperFieldDto,
  PaperItemDto,
  PaperListDto,
  PaperRefDto,
} from './responses.dto';
import {
  PaperTemplate,
  PaperTemplateVersion,
  TemplateKind,
} from './template.entities';
import { TemplatesService } from './templates.service';

const UNTITLED = 'Без назви';

/** Messages mapped to stable errorCode in common/http-exception.filter.ts. */
export const PaperErrors = {
  NotDraft: 'Paper is not a draft',
  NotPublished: 'Paper is not published',
  RequiredMissing: 'Required paper field is missing',
} as const;

/** Published, not cancelled: it shows its record as it is now. */
const LIVE = new Set([
  PaperStatus.Published,
  PaperStatus.Frozen,
  PaperStatus.Signed,
]);

/** Text and values as the document shows them (bound fields — from the record). */
type Shown = { content: PaperContent; values: FieldValues };

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
    number: p.number,
    status: p.status,
    visibility: p.visibility,
    author: {
      id: p.authorId,
      name: p.author?.name ?? null,
      avatarUrl: p.author?.avatarUrl ?? null,
    },
    revision: p.revision,
    publishedAt: p.publishedAt,
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

/** A zone's text; '' — empty. */
function zoneOf(content: PaperContent, key: string) {
  const zone = zonesOf(content).find((z) => z.attrs?.key === key);
  return zone ? zoneText(zone) : '';
}

/** Every required field has a value (a zone — some text). */
function requireFilled(
  fields: PaperField[],
  p: { values: FieldValues; content: PaperContent },
) {
  const missing = fields.find((f) =>
    !f.required
      ? false
      : isFillable(f.type)
        ? p.values[f.key] === undefined
        : zoneOf(p.content, f.key) === '',
  );
  if (missing) {
    throw new BadRequestException({
      message: PaperErrors.RequiredMissing,
      field: missing.key,
    });
  }
}

/** Values of bound fields by the keys of the record's fields (empty — null). */
function recordValues(
  fields: PaperField[],
  p: { values: FieldValues; content: PaperContent },
): RecordValues {
  const out: RecordValues = {};
  for (const f of fields) {
    if (f.binding === null) continue;
    out[f.binding] = isFillable(f.type)
      ? (p.values[f.key] ?? null)
      : zoneOf(p.content, f.key) || null;
  }
  return out;
}

/**
 * Runs the record's module; an error about a field of the record (`field`
 * — its key) comes out with the key of the template's field bound to it.
 */
async function withFieldKeys<T>(
  fields: PaperField[],
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (!(e instanceof HttpException) || e.getStatus() !== 400) throw e;
    const body = e.getResponse();
    if (typeof body !== 'object') throw e;
    const key = (body as { field?: unknown }).field;
    const f = fields.find((x) => x.binding !== null && x.binding === key);
    if (!f) throw e;
    throw new BadRequestException({ ...body, field: f.key });
  }
}

/** The next number of the prefix this year (Kyiv time): `ТЗ-2026-014`. */
async function nextNumber(m: EntityManager, prefix: string) {
  const [row] = await m.query<{ year: number; last: number }[]>(
    `INSERT INTO "paper_counters" ("prefix", "year", "last")
     VALUES ($1, EXTRACT(YEAR FROM now() AT TIME ZONE 'Europe/Kyiv')::int, 1)
     ON CONFLICT ("prefix", "year")
       DO UPDATE SET "last" = "paper_counters"."last" + 1
     RETURNING "year", "last"`,
    [prefix],
  );
  return `${prefix}-${row.year}-${String(row.last).padStart(3, '0')}`;
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
    private links: LinkRegistry,
    private adapters: PaperAdapterRegistry,
  ) {}

  /** Records the document refers to that the actor sees. */
  private refsOf(m: EntityManager, p: Paper, form: Form | null, actor: Actor) {
    return seenRefs(
      this.links,
      form?.fields ?? [],
      p.values,
      p.content,
      actor,
      m,
    );
  }

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
        shared: isShared(p) || (await this.seenThroughRecord(m, p, actor)),
      })
    ) {
      throw new NotFoundException('Paper not found');
    }
    // The lock does not go with a join: the author is loaded apart.
    p.author =
      (await m.getRepository(User).findOneBy({ id: p.authorId })) ?? undefined;
    return p;
  }

  /** A published document the actor sees through the record it created. */
  private async seenThroughRecord(m: EntityManager, p: Paper, actor: Actor) {
    if (p.status === PaperStatus.Draft || !p.targetType) return false;
    if (can(actor, Action.PapersReadAll)) return true;
    const seen = seenThroughTarget(this.adapters, actor);
    if (!seen) return false;
    return m
      .getRepository(Paper)
      .createQueryBuilder('p')
      .where('p.id = :id', { id: p.id })
      .andWhere(`(${seen.sql})`, seen.params)
      .getExists();
  }

  /**
   * What the document shows: once published (until cancelled), fields bound
   * to its record show the record as it is now; without the record — as
   * they were written.
   */
  private async shown(
    m: EntityManager,
    p: Paper,
    form: Form | null,
  ): Promise<Shown> {
    const own = { content: p.content, values: p.values };
    if (!form || !p.targetType || !p.targetId || !LIVE.has(p.status)) {
      return own;
    }
    const record = await this.adapters
      .get(p.targetType)
      ?.resolve(p.targetId, m);
    if (!record) return own;
    let content = p.content;
    const values = { ...p.values };
    for (const f of form.fields) {
      if (f.binding === null) continue;
      const raw = record.values[f.binding];
      if (!isFillable(f.type)) {
        content = withZoneText(
          content,
          f.key,
          typeof raw === 'string' ? raw : '',
        );
        continue;
      }
      const v = raw === undefined ? undefined : normalizeValue(f, raw);
      if (v === null) delete values[f.key];
      else if (v !== undefined) values[f.key] = v;
    }
    return { content, values };
  }

  private async view(
    m: EntityManager,
    p: Paper,
    actor: Actor,
  ): Promise<Plain<PaperDto>> {
    const form = await this.formOf(m, p);
    const editable = canEdit(p, actor);
    const staff = can(actor, Action.PapersFillStaff);
    const { content, values } = await this.shown(m, p, form);
    const owner = { ownerId: p.authorId };
    return {
      ...itemView(p),
      content,
      values,
      targetType: p.targetType,
      targetId: p.targetId,
      cancelReason: p.cancelReason,
      template: form && {
        id: form.template.id,
        title: form.template.title,
        kind: form.template.kind,
        target: form.template.target,
        version: form.version.number,
        fields: form.fields.map((f): Plain<PaperFieldDto> => ({
          ...f,
          canFill:
            editable &&
            fillableType(this.links, f.type) &&
            (f.fill === 'author' || staff),
        })),
      },
      refs: (await this.refsOf(m, p, form, actor)).map(
        (r): Plain<PaperRefDto> => ({ ...r, type: r.type as RecordType }),
      ),
      canEdit: editable,
      canPublish:
        p.status === PaperStatus.Draft &&
        can(actor, Action.PapersPublish, owner),
      canCancel: LIVE.has(p.status) && can(actor, Action.PapersCancel, owner),
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
        'p.number',
        'p.status',
        'p.visibility',
        'p.revision',
        'p.authorId',
        'p.publishedAt',
        'p.createdAt',
        'p.updatedAt',
        'author.id',
        'author.name',
        'author.avatarUrl',
      ]);
    whereSeen(qb, actor, this.adapters);
    if (q.mine === 'true') qb.andWhere('p.authorId = :me', { me: actor.id });
    if (q.search) {
      qb.andWhere('(p.title ILIKE :s OR p.number ILIKE :s)', {
        s: `%${escapeLike(q.search)}%`,
      });
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
    const { content, values } = await this.shown(m, p, form);
    const fields = new Map((form?.fields ?? []).map((f) => [f.key, f]));
    const refs = new Map(
      (await this.refsOf(m, p, form, actor)).map((r) => [
        `${r.type}:${r.id}`,
        r.title,
      ]),
    );
    const title = (type: string, id: string) =>
      refs.get(`${type}:${id}`) ?? null;
    const { institution, groupName } = await this.org.get();
    return paperPrintHtml({
      title: p.title,
      content,
      requisites: { institution, groupName },
      fill: {
        number: p.number,
        text: (key) => {
          const f = fields.get(key);
          const v = values[key];
          return f && v !== undefined
            ? valueText(f.type, v, f.options, title)
            : null;
        },
        hidden: (key) => !fields.get(key)?.print,
        title,
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
      const content = from?.version.body ?? dto.content ?? EMPTY_CONTENT;
      // What a template's body refers to is the template's own.
      const fresh = from
        ? new Set<string>()
        : await checkNewRefs(
            this.links,
            [],
            { values: {}, content },
            { values: {}, content: EMPTY_CONTENT },
            actor,
            m,
          );
      return this.insert(m, actor, {
        title: dto.title?.trim() || from?.template.title || UNTITLED,
        content,
        values: {},
        from,
        fields: [],
        fresh,
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
      // Records the original already refers to stay, as in any save of it;
      // the copy links every one of them the actor sees.
      await checkNewRefs(
        this.links,
        form?.fields ?? [],
        { values, content: dto.content },
        source,
        actor,
        m,
      );
      const fresh = new Set(
        (
          await seenRefs(
            this.links,
            form?.fields ?? [],
            values,
            dto.content,
            actor,
            m,
          )
        ).map((r) => `${r.type}:${r.id}`),
      );
      return this.insert(m, actor, {
        title: dto.title?.trim() || source.title,
        content: dto.content,
        values,
        from,
        fields: form?.fields ?? [],
        fresh,
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
      fields: PaperField[];
      /** Records just checked (see checkNewRefs). */
      fresh: ReadonlySet<string>;
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
    await syncLinks(
      m,
      saved.id,
      p.fields,
      p.values,
      p.content,
      p.fresh,
      actor.id,
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
        throw new ConflictException(PaperErrors.NotDraft);
      }
      if (dto.revision !== p.revision) {
        throw new ConflictException('Paper was changed by someone else');
      }
      const filling = dto.content !== undefined || dto.values !== undefined;
      const form = filling ? await this.formOf(m, p) : null;
      const values = filling ? this.checked(form, actor, dto, p) : undefined;
      const next = {
        values: values ?? p.values,
        content: dto.content ?? p.content,
      };
      const fresh = filling
        ? await checkNewRefs(this.links, form?.fields ?? [], next, p, actor, m)
        : null;

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
      if (fresh) {
        await syncLinks(
          m,
          p.id,
          form?.fields ?? [],
          next.values,
          next.content,
          fresh,
          actor.id,
        );
      }
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

  /**
   * Makes a draft final. Required fields must be filled. A document of a
   * `creates` template creates its record through the record's module (its
   * rights, audit and errors; an error about a field of the record comes
   * with the key of the template's field bound to it); a template with a
   * prefix gives the next number. All in one transaction.
   */
  async publish(id: string, actor: Actor): Promise<PaperDto> {
    return this.ds.transaction(async (m) => {
      const p = await this.accessible(m, id, actor, true);
      assertCan(actor, Action.PapersPublish, { ownerId: p.authorId });
      if (p.status !== PaperStatus.Draft) {
        throw new ConflictException(PaperErrors.NotDraft);
      }
      const form = await this.formOf(m, p);
      if (form) {
        requireFilled(form.fields, p);
        if (form.template.kind === TemplateKind.Creates) {
          await this.templates.assertCurrent(form.template, form.version);
          const type = form.template.target!;
          const adapter = this.adapters.get(type);
          if (!adapter)
            throw new ConflictException(PaperFieldErrors.NeedsUpdate);
          const targetId = await withFieldKeys(form.fields, () =>
            adapter.publish(recordValues(form.fields, p), actor, m),
          );
          p.targetType = type;
          p.targetId = targetId;
          await m.getRepository(RecordLink).insert({
            fromType: 'paper',
            fromId: p.id,
            toType: type,
            toId: targetId,
            role: TARGET_ROLE,
            createdById: actor.id,
          });
        }
        if (form.template.numberPrefix) {
          p.number = await nextNumber(m, form.template.numberPrefix);
        }
      }
      p.status = PaperStatus.Published;
      p.publishedAt = new Date();
      p.revision += 1;
      await m.getRepository(Paper).save(p);
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'paper.published',
          entity: 'paper',
          entityId: p.id,
          meta: {
            title: p.title,
            authorId: p.authorId,
            number: p.number,
            ...(p.targetType
              ? { targetType: p.targetType, targetId: p.targetId }
              : {}),
          },
        },
        m,
      );
      return this.view(m, p, actor);
    });
  }

  /**
   * Cancels a published document with a reason; it is never deleted. The
   * record it created is taken off by its module, by that module's rule
   * (a task — only while free without assignees).
   */
  async cancel(
    id: string,
    dto: CancelPaperDto,
    actor: Actor,
  ): Promise<PaperDto> {
    const [view, after] = await this.ds.transaction(async (m) => {
      const p = await this.accessible(m, id, actor, true);
      assertCan(actor, Action.PapersCancel, { ownerId: p.authorId });
      if (!LIVE.has(p.status)) {
        throw new ConflictException(PaperErrors.NotPublished);
      }
      const reason = dto.reason.trim();
      let after: (() => Promise<void>) | void = undefined;
      if (p.targetType && p.targetId) {
        after = await this.adapters
          .get(p.targetType)
          ?.cancel(p.targetId, reason, actor, m);
      }
      p.status = PaperStatus.Cancelled;
      p.cancelReason = reason;
      p.revision += 1;
      await m.getRepository(Paper).save(p);
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'paper.cancelled',
          entity: 'paper',
          entityId: p.id,
          meta: {
            title: p.title,
            authorId: p.authorId,
            number: p.number,
            reason,
            ...(p.targetType
              ? { targetType: p.targetType, targetId: p.targetId }
              : {}),
          },
        },
        m,
      );
      return [await this.view(m, p, actor), after] as const;
    });
    if (after) await after();
    return view;
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
        throw new ConflictException(PaperErrors.NotDraft);
      }
      await removeLinksOf(m, 'paper', p.id);
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
