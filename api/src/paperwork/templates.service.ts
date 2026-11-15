import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { Action, Actor, can } from '../auth/policy';
import type { OkDto, Plain } from '../common/responses.dto';
import { Dictionary } from '../dictionaries/dictionary.entities';
import { RecordFieldsService } from '../records/record-fields.service';
import { schemaDef, type PublishedSchema } from '../records/records.registry';
import { EMPTY_CONTENT } from './content';
import { PaperFieldErrors } from './paper-fields';
import {
  bindingProblem,
  bodyProblem,
  duplicateKey,
  fieldDictionaries,
  fieldsProblem,
  type FieldProblem,
  type TemplateField,
} from './template-fields';
import {
  PaperTemplate,
  PaperTemplateVersion,
  TemplateCreators,
  TemplateKind,
} from './template.entities';
import type {
  CreateTemplateDto,
  TemplateFieldDto,
  UpdateTemplateDto,
  UpdateTemplateVersionDto,
} from './templates.dto';
import type {
  TemplateDto,
  TemplateItemDto,
  TemplateVersionDto,
  TemplateVersionItemDto,
} from './templates.responses.dto';

/** Messages mapped to stable errorCode in common/http-exception.filter.ts. */
export const TemplateErrors = {
  Published: 'Template version is published',
  FieldInvalid: 'Invalid template field',
  KindInvalid: 'Invalid template kind',
  Conflict: 'Template was changed by someone else',
} as const;

function fieldInvalid(problem: FieldProblem) {
  return new BadRequestException({
    message: TemplateErrors.FieldInvalid,
    ...problem,
  });
}

function normalize(f: TemplateFieldDto): TemplateField {
  return {
    key: f.key,
    label: f.label.trim(),
    type: f.type,
    required: f.required,
    fill: f.fill,
    editable: f.editable,
    print: f.print,
    binding: f.binding ?? null,
    min: f.min ?? null,
    max: f.max ?? null,
    maxLength: f.maxLength ?? null,
    maxItems: f.maxItems ?? null,
    dictionary: f.dictionary ?? null,
  };
}

function versionItem(v: PaperTemplateVersion): Plain<TemplateVersionItemDto> {
  return {
    number: v.number,
    revision: v.revision,
    publishedAt: v.publishedAt,
    publishedBy: v.publishedById
      ? {
          id: v.publishedById,
          name: v.publishedBy?.name ?? null,
          avatarUrl: v.publishedBy?.avatarUrl ?? null,
        }
      : null,
    updatedAt: v.updatedAt,
  };
}

function versionView(v: PaperTemplateVersion): TemplateVersionDto {
  return {
    ...versionItem(v),
    templateId: v.templateId,
    body: v.body,
    fields: v.fields,
    schemaVersion: v.schemaVersion,
  };
}

/**
 * The kind fits the target: `free` has none; `report` — any record type;
 * `creates` — a type whose records can be created. Auto-freeze needs a
 * record that gets done: `creates` only.
 */
function assertKind(
  kind: TemplateKind,
  target: string | null,
  autoFreeze: boolean,
) {
  const ok =
    kind === TemplateKind.Free
      ? target === null
      : target !== null &&
        (kind === TemplateKind.Report ||
          schemaDef(target).fields.some((f) => f.create));
  if (!ok || (autoFreeze && kind !== TemplateKind.Creates)) {
    throw new BadRequestException(TemplateErrors.KindInvalid);
  }
}

/** Schemas of targets, read once per request. */
class Schemas {
  private cache = new Map<string, Promise<PublishedSchema>>();
  constructor(private fields: RecordFieldsService) {}

  of(target: string | null): Promise<PublishedSchema | null> {
    if (target === null) return Promise.resolve(null);
    let s = this.cache.get(target);
    if (!s) {
      s = this.fields.schema(target);
      this.cache.set(target, s);
    }
    return s;
  }
}

/**
 * Templates of editor documents and their versions. Staff create and
 * publish them; members see templates they may make documents from.
 */
@Injectable()
export class TemplatesService {
  constructor(
    @InjectDataSource() private ds: DataSource,
    private audit: AuditService,
    private recordFields: RecordFieldsService,
  ) {}

  async list(actor: Actor): Promise<TemplateItemDto[]> {
    const staff = can(actor, Action.PaperTemplatesManage);
    const qb = this.ds
      .getRepository(PaperTemplate)
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.currentVersion', 'cv')
      .orderBy('t.title', 'ASC')
      .addOrderBy('t.id', 'ASC');
    if (!staff) {
      // Same rule as accessible(): published, not archived, open to all.
      qb.andWhere('t.archivedAt IS NULL')
        .andWhere('t.currentVersionId IS NOT NULL')
        .andWhere('t.creators = :all', { all: TemplateCreators.All });
    }
    const rows = await qb.getMany();
    const drafts = staff
      ? await this.draftNumbers(rows.map((t) => t.id))
      : new Map<string, number>();
    const schemas = new Schemas(this.recordFields);
    return Promise.all(
      rows.map((t) => this.itemView(t, drafts.get(t.id) ?? null, schemas)),
    );
  }

  async get(id: string, actor: Actor): Promise<TemplateDto> {
    const t = await this.accessible(this.ds.manager, id, actor);
    return this.view(this.ds.manager, t, actor);
  }

  async create(dto: CreateTemplateDto, actor: Actor): Promise<TemplateDto> {
    const target = dto.target ?? null;
    const autoFreeze = dto.autoFreeze ?? false;
    assertKind(dto.kind, target, autoFreeze);
    return this.ds.transaction(async (m) => {
      const t = await m.save(
        m.create(PaperTemplate, {
          title: dto.title.trim(),
          kind: dto.kind,
          target,
          numberPrefix: dto.numberPrefix ?? null,
          autoFreeze,
          creators: dto.creators ?? TemplateCreators.Staff,
          visibility: dto.visibility,
          currentVersionId: null,
          archivedAt: null,
          createdById: actor.id,
        }),
      );
      await m.save(
        m.create(PaperTemplateVersion, {
          templateId: t.id,
          number: 1,
          body: EMPTY_CONTENT,
          fields: [],
          schemaVersion: null,
          publishedAt: null,
          publishedById: null,
        }),
      );
      await this.log(m, actor, 'paper_template.created', t, {
        kind: t.kind,
        target: t.target,
      });
      return this.view(m, await this.load(m, t.id), actor);
    });
  }

  /** Changes only the given fields; kind and target never change. */
  async update(
    id: string,
    dto: UpdateTemplateDto,
    actor: Actor,
  ): Promise<TemplateDto> {
    return this.ds.transaction(async (m) => {
      const t = await this.load(m, id, true);
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      const set = <
        K extends
          'title' | 'numberPrefix' | 'autoFreeze' | 'creators' | 'visibility',
      >(
        prop: K,
        value: PaperTemplate[K] | undefined,
      ) => {
        if (value === undefined || value === t[prop]) return;
        changes[prop] = { from: t[prop], to: value };
        t[prop] = value;
      };
      set('title', dto.title?.trim());
      set('numberPrefix', dto.numberPrefix);
      set('autoFreeze', dto.autoFreeze);
      set('creators', dto.creators);
      set('visibility', dto.visibility);
      if (dto.archived !== undefined && dto.archived !== !!t.archivedAt) {
        changes.archived = { from: !!t.archivedAt, to: dto.archived };
        t.archivedAt = dto.archived ? new Date() : null;
      }
      assertKind(t.kind, t.target, t.autoFreeze);
      if (Object.keys(changes).length) {
        await m.save(t);
        await this.log(m, actor, 'paper_template.updated', t, { changes });
      }
      return this.view(m, t, actor);
    });
  }

  /** Only a template never published: no document can refer to it. */
  async remove(id: string, actor: Actor): Promise<OkDto> {
    return this.ds.transaction(async (m) => {
      const t = await this.load(m, id, true);
      if (t.currentVersionId)
        throw new ConflictException(TemplateErrors.Published);
      await m.delete(PaperTemplate, { id: t.id });
      await this.log(m, actor, 'paper_template.deleted', t, {});
      return { ok: true };
    });
  }

  async version(
    id: string,
    n: number,
    actor: Actor,
  ): Promise<TemplateVersionDto> {
    const m = this.ds.manager;
    const t = await this.accessible(m, id, actor);
    const v = await this.findVersion(m, t, n);
    if (
      !can(actor, Action.PaperTemplatesManage) &&
      v.id !== t.currentVersionId
    ) {
      throw new NotFoundException('Template version not found');
    }
    return versionView(v);
  }

  /** The draft version; made from the current one if there is none. */
  async draft(id: string): Promise<TemplateVersionDto> {
    return this.ds.transaction(async (m) => {
      const t = await this.load(m, id, true);
      const versions = await m.findBy(PaperTemplateVersion, {
        templateId: t.id,
      });
      const existing = versions.find((v) => !v.publishedAt);
      if (existing) return versionView(existing);
      const current = versions.find((v) => v.id === t.currentVersionId);
      const v = await m.save(
        m.create(PaperTemplateVersion, {
          templateId: t.id,
          number: versions.reduce((n, x) => Math.max(n, x.number), 0) + 1,
          body: current?.body ?? EMPTY_CONTENT,
          fields: current?.fields ?? [],
          schemaVersion: null,
          publishedAt: null,
          publishedById: null,
        }),
      );
      // Drafts are not audited (like drafts of documents): publishing is.
      return versionView(v);
    });
  }

  /**
   * Saves a draft version. Only the shape is checked here (the constructor
   * autosaves half-made fields); the sense of fields — when it is published.
   */
  async saveDraft(
    id: string,
    n: number,
    dto: UpdateTemplateVersionDto,
  ): Promise<TemplateVersionItemDto> {
    return this.ds.transaction(async (m) => {
      const t = await this.load(m, id, true);
      const v = await this.findVersion(m, t, n);
      if (v.publishedAt) throw new ConflictException(TemplateErrors.Published);
      if (dto.revision !== v.revision)
        throw new ConflictException(TemplateErrors.Conflict);
      if (dto.body === undefined && dto.fields === undefined)
        return versionItem(v);
      if (dto.fields !== undefined) {
        const fields = dto.fields.map(normalize);
        const dup = duplicateKey(fields);
        if (dup) throw fieldInvalid({ field: dup });
        v.fields = fields;
      }
      if (dto.body !== undefined) v.body = dto.body;
      v.revision += 1;
      return versionItem(await m.save(v));
    });
  }

  /** Throws away the draft version. */
  async discardDraft(id: string, n: number, actor: Actor): Promise<OkDto> {
    return this.ds.transaction(async (m) => {
      const t = await this.load(m, id, true);
      const v = await this.findVersion(m, t, n);
      if (v.publishedAt) throw new ConflictException(TemplateErrors.Published);
      await m.delete(PaperTemplateVersion, { id: v.id });
      await this.log(m, actor, 'paper_template.draft_discarded', t, {
        version: v.number,
      });
      return { ok: true };
    });
  }

  /**
   * Publishes the draft: its fields and bindings are checked against the
   * target's schema of now, and the version never changes again.
   */
  async publish(id: string, n: number, actor: Actor): Promise<TemplateDto> {
    return this.ds.transaction(async (m) => {
      const t = await this.load(m, id, true);
      const v = await this.findVersion(m, t, n);
      if (v.publishedAt) throw new ConflictException(TemplateErrors.Published);
      const schema = await new Schemas(this.recordFields).of(t.target);
      const names = fieldDictionaries(v.fields);
      const existing = names.length
        ? await m.findBy(Dictionary, { key: In(names) })
        : [];
      const problem =
        fieldsProblem(
          v.fields,
          t.kind,
          schema,
          new Set(existing.map((d) => d.key)),
        ) ?? bodyProblem(v.body, v.fields);
      if (problem) throw fieldInvalid(problem);
      v.publishedAt = new Date();
      v.publishedById = actor.id;
      v.schemaVersion = schema?.version ?? null;
      await m.save(v);
      t.currentVersionId = v.id;
      t.currentVersion = v;
      await m.save(t);
      await this.log(m, actor, 'paper_template.published', t, {
        version: v.number,
      });
      return this.view(m, t, actor);
    });
  }

  /**
   * The template and version a new document is made from: a template the
   * actor may make documents from, not archived, published. A new document
   * takes the current version (not one whose bindings broke); a copy —
   * the version of the document it copies.
   */
  async forPaper(
    m: EntityManager,
    id: string,
    actor: Actor,
    versionId: string | null = null,
  ): Promise<{ template: PaperTemplate; version: PaperTemplateVersion }> {
    const t = await this.accessible(m, id, actor);
    if (t.archivedAt || !t.currentVersion) {
      throw new NotFoundException('Template not found');
    }
    if (versionId === null) {
      if (await this.needsUpdate(t, new Schemas(this.recordFields))) {
        throw new ConflictException(PaperFieldErrors.NeedsUpdate);
      }
      return { template: t, version: t.currentVersion };
    }
    const version = await m.findOneBy(PaperTemplateVersion, {
      id: versionId,
    });
    if (!version) throw new NotFoundException('Template version not found');
    return { template: t, version };
  }

  /** Dictionaries fields of published versions take values from. */
  async usedDictionaries(m: EntityManager): Promise<string[]> {
    const rows = await m.query<{ dictionary: string }[]>(
      `SELECT DISTINCT f->>'dictionary' AS dictionary
         FROM "paper_template_versions" v, jsonb_array_elements(v.fields) f
        WHERE v.published_at IS NOT NULL AND f->>'dictionary' IS NOT NULL`,
    );
    return rows.map((r) => r.dictionary);
  }

  // --- helpers ---

  /** The template if the actor sees it; otherwise as if there is none. */
  private async accessible(m: EntityManager, id: string, actor: Actor) {
    const t = await this.load(m, id);
    if (
      !can(actor, Action.PaperTemplatesManage) &&
      (t.archivedAt ||
        !t.currentVersionId ||
        t.creators !== TemplateCreators.All)
    ) {
      throw new NotFoundException('Template not found');
    }
    return t;
  }

  private async load(m: EntityManager, id: string, lock = false) {
    const t = await m.findOne(PaperTemplate, {
      where: { id },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!t) throw new NotFoundException('Template not found');
    // The lock does not go with a join: the current version is loaded apart.
    t.currentVersion = t.currentVersionId
      ? await m.findOneBy(PaperTemplateVersion, { id: t.currentVersionId })
      : null;
    return t;
  }

  private async findVersion(m: EntityManager, t: PaperTemplate, n: number) {
    // Versions are not locked: every change goes under the template's lock.
    const v = await m.findOne(PaperTemplateVersion, {
      where: { templateId: t.id, number: n },
      relations: { publishedBy: true },
    });
    if (!v) throw new NotFoundException('Template version not found');
    return v;
  }

  private async draftNumbers(ids: string[]) {
    if (!ids.length) return new Map<string, number>();
    const drafts = await this.ds.getRepository(PaperTemplateVersion).findBy({
      templateId: In(ids),
      publishedAt: IsNull(),
    });
    return new Map(drafts.map((v) => [v.templateId, v.number]));
  }

  /**
   * A published version whose target's schema changed is checked again:
   * a broken binding — the template needs a new version.
   */
  private async needsUpdate(t: PaperTemplate, schemas: Schemas) {
    const v = t.currentVersion;
    if (!v || t.kind === TemplateKind.Free) return false;
    const schema = await schemas.of(t.target);
    if (!schema || schema.version === v.schemaVersion) return false;
    return bindingProblem(v.fields, t.kind, schema) !== null;
  }

  private async itemView(
    t: PaperTemplate,
    draftVersion: number | null,
    schemas: Schemas,
  ): Promise<Plain<TemplateItemDto>> {
    return {
      id: t.id,
      title: t.title,
      kind: t.kind,
      target: t.target,
      numberPrefix: t.numberPrefix,
      autoFreeze: t.autoFreeze,
      creators: t.creators,
      visibility: t.visibility,
      archived: t.archivedAt !== null,
      currentVersion: t.currentVersion?.number ?? null,
      draftVersion,
      needsUpdate: await this.needsUpdate(t, schemas),
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }

  private async view(
    m: EntityManager,
    t: PaperTemplate,
    actor: Actor,
  ): Promise<TemplateDto> {
    const staff = can(actor, Action.PaperTemplatesManage);
    // Members see only the current version (accessible() made sure there is one).
    const versions = await m.find(PaperTemplateVersion, {
      where: staff ? { templateId: t.id } : { id: t.currentVersionId! },
      relations: { publishedBy: true },
      order: { number: 'DESC' },
    });
    const draft = staff
      ? (versions.find((v) => !v.publishedAt)?.number ?? null)
      : null;
    return {
      ...(await this.itemView(t, draft, new Schemas(this.recordFields))),
      versions: versions.map(versionItem),
    };
  }

  private log(
    m: EntityManager,
    actor: Actor,
    action: string,
    t: PaperTemplate,
    meta: Record<string, unknown>,
  ) {
    return this.audit.log(
      {
        actorId: actor.id,
        action,
        entity: 'paper_template',
        entityId: t.id,
        meta: { title: t.title, ...meta },
      },
      m,
    );
  }
}
