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
import { ensureDictionaryItem } from '../dictionaries/dictionary-usage';
import {
  AccessScope,
  Doc,
  DOCUMENT_CATEGORY,
  DocVersion,
} from '../documents/doc.entity';
import {
  DocumentsService,
  type StoredFile,
} from '../documents/documents.service';
import {
  SCAN_EXTENSIONS,
  type UploadedFileLike,
} from '../files/file-validation';
import { Action, Actor, assertCan, can } from '../auth/policy';
import { escapeLike } from '../common/like';
import { LinkRegistry } from '../links/link-registry';
import { removeLinksOf } from '../links/links.sql';
import { RecordLink } from '../links/record-link.entity';
import { OrgService } from '../org/org.service';
import { RecordFieldsService } from '../records/record-fields.service';
import type { RecordType } from '../records/field-types';
import { Role, User } from '../users/user.entity';
import type { OkDto, Plain } from '../common/responses.dto';
import {
  dayText,
  EMPTY_CONTENT,
  momentText,
  isFillable,
  signName,
  SIGNER_AUTHOR,
  SIGNER_ORG,
  yearText,
  isEmptyRow,
  normalizeValue,
  offFields,
  ROWS,
  rowsIn,
  valueText,
  withZoneText,
  zonesOf,
  zoneText,
  type FieldRow,
  type FieldValues,
  type PaperContent,
} from './content';
import { PaperAdapterRegistry, type RecordValues } from './adapters';
import type {
  CancelPaperDto,
  CopyPaperDto,
  CreatePaperDto,
  ListPapersQuery,
  PaperForRecordDto,
  PrintPaperQuery,
  SignPaperDto,
  UpdatePaperDto,
} from './dto';
import { PaperSignature } from './paper-signature.entity';
import { PaperSnapshot, type SnapshotSigner } from './paper-snapshot.entity';
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
  changedFields,
  checkContent,
  checkValues,
  fieldView,
  fieldInvalid,
  PaperFieldErrors,
  recordRows,
  resolveFields,
  type PaperField,
} from './paper-fields';
import { papersOf, recordsOfPaper } from './paper-targets';
import { docxFileName, paperDocx } from './docx';
import { paperPrintHtml, sheetHash, sheetHtml, type Seal } from './print';
import {
  footerText,
  signLines,
  type FieldFill,
} from '../../../shared/editor-schema/render';
import {
  SIGNED_IN,
  signedNote,
  signedSheet,
  type SheetSignature,
} from '../../../shared/editor-schema/signature';
import type {
  PaperDto,
  PaperFieldDto,
  PaperItemDto,
  PaperListDto,
  PaperRefDto,
  PaperSignedDto,
  PaperSignLineDto,
  PaperVerifyDto,
} from './responses.dto';
import {
  PaperTemplate,
  PaperTemplateVersion,
  TemplateKind,
} from './template.entities';
import { PaperTableRegistry, tableKey, type AutoTables } from './tables';
import { reportRecordKey } from './template-fields';
import { TemplateErrors, TemplatesService } from './templates.service';

const UNTITLED = 'Без назви';

/** Messages mapped to stable errorCode in common/http-exception.filter.ts. */
export const PaperErrors = {
  NotDraft: 'Paper is not a draft',
  NotPublished: 'Paper is not published',
  RequiredMissing: 'Required paper field is missing',
  TargetTaken: 'Record already has a paper',
  Frozen: 'Paper is frozen',
  NotReady: 'Paper record is not ready',
  SnapshotNotFound: 'Paper snapshot not found',
  NotFrozen: 'Paper is not frozen',
  ScanNotFound: 'Paper scan not found',
  SignedByYou: 'Paper is signed by you',
} as const;

/** Published, not cancelled: it shows its record as it is now. */
const LIVE = new Set([
  PaperStatus.Published,
  PaperStatus.Frozen,
  PaperStatus.Signed,
]);

/** Takes a signed scan: frozen, or signed already (a better scan). */
const SIGNABLE = new Set([PaperStatus.Frozen, PaperStatus.Signed]);

/** May be frozen now: published; a report — frozen or signed too (a new snapshot). */
function freezable(p: Paper, form: { template: PaperTemplate } | null) {
  return (
    p.status === PaperStatus.Published ||
    (form?.template.kind === TemplateKind.Report && SIGNABLE.has(p.status))
  );
}

/** The archive category of signed scans (made when the first one comes). */
const SCAN_CATEGORY = { key: 'signed_papers', title: 'Підписані документи' };

/** How long a frozen document stays on the Home's «на підпис» lists. */
const DUE_SIGN_DAYS = 30;

/** Over every page of a print that is not a snapshot's (a cancelled one — of a snapshot too). */
const WATERMARK: Record<PaperStatus, string | null> = {
  [PaperStatus.Draft]: 'Чернетка',
  [PaperStatus.Published]: 'Не зафіксовано',
  [PaperStatus.Frozen]: null,
  [PaperStatus.Signed]: null,
  [PaperStatus.Cancelled]: 'Скасовано',
};

/**
 * Who may freeze: a member — only a free document of their own (one that
 * created a record gives no owner); staff — any (policy: PapersFreeze).
 */
function freezeOwner(p: Paper) {
  return p.targetType ? {} : { ownerId: p.authorId };
}

/** The check page of a snapshot (its QR); null — no PUBLIC_ORIGIN. */
function verifyUrl(sha256: string) {
  const origin = process.env.PUBLIC_ORIGIN?.replace(/\/+$/, '');
  return origin ? `${origin}/papers/verify/${sha256}` : null;
}

function sealOf(snap: PaperSnapshot): Seal {
  return {
    sha256: snap.sha256,
    frozenOn: dayText(snap.createdAt),
    url: verifyUrl(snap.sha256),
  };
}

/**
 * The reader (`:me`) is awaited on a line of the document's latest snapshot
 * and has not signed it yet (paper_snapshots.signers; rows from 0).
 */
const awaitsMeSql = `EXISTS (
  SELECT 1 FROM paper_snapshots s
   CROSS JOIN LATERAL jsonb_array_elements(s.signers) WITH ORDINALITY AS l(line, i)
   WHERE s.paper_id = p.id
     AND s.n = (SELECT MAX(x.n) FROM paper_snapshots x WHERE x.paper_id = p.id)
     AND l.line ->> 'userId' = CAST(:me AS text)
     AND NOT EXISTS (SELECT 1 FROM paper_signatures g
                      WHERE g.snapshot_id = s.id AND g.row = l.i - 1))`;

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

/**
 * Every required field has a value (a zone — some text; rows — a row not
 * empty); a field of a conditional block that is off is not required. A
 * row not empty has each required column filled (`row` — its index among
 * all the rows: empty ones go when published).
 */
function requireFilled(
  fields: PaperField[],
  p: { values: FieldValues; content: PaperContent },
) {
  const off = offFields(p.content, p.values);
  const missing = (field: string, row?: number) =>
    new BadRequestException({
      message: PaperErrors.RequiredMissing,
      field,
      ...(row === undefined ? {} : { row }),
    });
  for (const f of fields) {
    if (off.has(f.key)) continue;
    if (f.type === ROWS) {
      const rows = rowsIn(p.values[f.key]);
      if (f.required && rows.every(isEmptyRow)) throw missing(f.key);
      const row = rows.findIndex(
        (r) =>
          !isEmptyRow(r) &&
          (f.columns ?? []).some((c) => c.required && r[c.key] === undefined),
      );
      if (row >= 0) throw missing(f.key, row);
      continue;
    }
    if (!f.required) continue;
    const empty = isFillable(f.type)
      ? p.values[f.key] === undefined
      : zoneOf(p.content, f.key) === '';
    if (empty) throw missing(f.key);
  }
}

/** Values without rows of nothing (a row added and left empty); rows of none — no value. */
function withoutEmptyRows(
  fields: PaperField[],
  values: FieldValues,
): FieldValues {
  const out = { ...values };
  for (const f of fields) {
    if (f.type !== ROWS || out[f.key] === undefined) continue;
    const rows = rowsIn(out[f.key]).filter((r) => !isEmptyRow(r));
    if (rows.length) out[f.key] = rows;
    else delete out[f.key];
  }
  return out;
}

/**
 * Text and values with the fields bound to the record taken from it (zones —
 * as plain paragraphs); `auto` — the fields nobody fills too; `zones` — off:
 * the text stays as it is (a draft saves its text: a zone of the record's
 * text in it would be a change of a locked zone).
 */
function withRecord(
  fields: PaperField[],
  record: RecordValues,
  own: Shown,
  auto: boolean,
  zones = true,
): Shown {
  let content = own.content;
  const values = { ...own.values };
  for (const f of fields) {
    if (f.binding === null || (f.auto && !auto)) continue;
    const raw = record[f.binding];
    if (!isFillable(f.type)) {
      if (!zones) continue;
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

/**
 * Values of bound fields by the keys of the record's fields (empty — null;
 * a field of a conditional block that is off — empty too).
 */
function recordValues(
  fields: PaperField[],
  p: { values: FieldValues; content: PaperContent },
): RecordValues {
  const off = offFields(p.content, p.values);
  const out: RecordValues = {};
  for (const f of fields) {
    if (f.binding === null || f.auto) continue;
    out[f.binding] = off.has(f.key)
      ? null
      : isFillable(f.type)
        ? (p.values[f.key] ?? null)
        : zoneOf(p.content, f.key) || null;
  }
  return out;
}

/**
 * The document without what conditional blocks that are off hold: their
 * values go, their zones are emptied (a draft kept them in case the
 * condition came back; a published document keeps only what it says).
 */
function withoutOff(
  p: { values: FieldValues; content: PaperContent },
  off = offFields(p.content, p.values),
) {
  const values = { ...p.values };
  let content = p.content;
  for (const key of off) {
    delete values[key];
    if (zonesOf(content).some((z) => z.attrs?.key === key)) {
      content = withZoneText(content, key, '');
    }
  }
  return { values, content };
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
    if (!(e instanceof HttpException) || ![400, 409].includes(e.getStatus())) {
      throw e;
    }
    const body = e.getResponse();
    if (typeof body !== 'object') throw e;
    const key = (body as { field?: unknown }).field;
    const f = fields.find((x) => x.binding !== null && x.binding === key);
    if (!f) throw e;
    throw new HttpException({ ...body, field: f.key }, e.getStatus());
  }
}

/**
 * Runs the record's module for row `row` of a rows field: an error of the
 * request (4xx) comes out about that row — `field` the rows field's key.
 */
async function inRow<T>(
  key: string,
  row: number,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (!(e instanceof HttpException) || e.getStatus() >= 500) throw e;
    const body = e.getResponse();
    throw new HttpException(
      {
        ...(typeof body === 'object' ? body : { message: body }),
        field: key,
        row,
      },
      e.getStatus(),
    );
  }
}

/** Values of a row's bound columns by the keys of the record's fields (empty — null). */
function rowValues(rows: PaperField, row: FieldRow): RecordValues {
  const out: RecordValues = {};
  for (const c of rows.columns ?? []) {
    if (c.binding !== null) out[c.binding] = row[c.key] ?? null;
  }
  return out;
}

/** A row of «рядок = запис» from a record: its bound columns (empty — left out). */
function rowOf(rows: PaperField, record: RecordValues): FieldRow {
  const row: FieldRow = {};
  for (const c of rows.columns ?? []) {
    if (c.binding === null) continue;
    const v = normalizeValue(c, record[c.binding]);
    // A column is never rows itself.
    if (v !== null && v !== undefined) row[c.key] = v as FieldRow[string];
  }
  return row;
}

/** The records of a document in the audit: one — its id, of rows — their ids. */
function targetMeta(p: Paper, ids: string[]) {
  return p.targetId ? { targetId: p.targetId } : { targetIds: ids };
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
    private documents: DocumentsService,
    private tables: PaperTableRegistry,
  ) {}

  /** Records the document (as it shows them) refers to that the actor sees. */
  private refsOf(
    m: EntityManager,
    shown: Shown,
    form: Form | null,
    actor: Actor,
  ) {
    return seenRefs(
      this.links,
      form?.fields ?? [],
      shown.values,
      shown.content,
      actor,
      m,
    );
  }

  /**
   * Which fields of a published document the actor may change: «можна
   * змінити», not auto, theirs to fill; bound — while they may change the
   * record (its adapter), not bound — their own document or staff.
   * null — nothing changes (a draft, a free document, past publication).
   */
  private async changer(
    m: EntityManager,
    p: Paper,
    form: Form | null,
    actor: Actor,
  ): Promise<((f: PaperField) => boolean) | null> {
    if (!form || p.status !== PaperStatus.Published) return null;
    const staff = can(actor, Action.PapersFillStaff);
    const own = can(actor, Action.PapersChange, { ownerId: p.authorId });
    const adapter = p.targetType ? this.adapters.get(p.targetType) : undefined;
    const record =
      !!adapter &&
      !!p.targetId &&
      (await adapter.canUpdate(p.targetId, actor, m));
    return (f) =>
      f.editable &&
      !f.auto &&
      fillableType(this.links, f.type) &&
      (f.fill === 'author' || staff) &&
      (f.binding !== null ? record : own);
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
    return resolveFields(
      m,
      template.kind,
      version.fields,
      schema,
      version.body,
    );
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
    if (!p || !(await this.sees(m, p, actor))) {
      throw new NotFoundException('Paper not found');
    }
    // The lock does not go with a join: the author is loaded apart.
    p.author =
      (await m.getRepository(User).findOneBy({ id: p.authorId })) ?? undefined;
    return p;
  }

  /** The actor sees the document (its own, shared, or through its record). */
  private async sees(m: EntityManager, p: Paper, actor: Actor) {
    return can(actor, Action.PapersRead, {
      ownerId: p.authorId,
      shared: isShared(p) || (await this.seenThroughRecord(m, p, actor)),
    });
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
   * What the document shows. A document that created a record: once
   * published (until frozen or cancelled), fields bound to the record show
   * it as it is now. A report: its bound fields show its record (see
   * recordOfReport) as soon as it is chosen (zones — once published), until
   * frozen; `fresh` — a frozen report too (a new snapshot). Without the
   * record — as they were written.
   * Freezing writes what it showed into the document itself.
   */
  private async shown(
    m: EntityManager,
    p: Paper,
    form: Form | null,
    fresh = false,
  ): Promise<Shown> {
    const own = { content: p.content, values: p.values };
    if (!form) return own;
    if (form.template.kind === TemplateKind.Report) {
      const live =
        p.status === PaperStatus.Draft ||
        p.status === PaperStatus.Published ||
        (fresh && SIGNABLE.has(p.status));
      const record = live ? await this.recordOfReport(m, form, p.values) : null;
      return record
        ? withRecord(
            form.fields,
            record,
            own,
            true,
            p.status !== PaperStatus.Draft,
          )
        : own;
    }
    if (!p.targetType || !p.targetId || p.status !== PaperStatus.Published) {
      return own;
    }
    const record = await this.adapters
      .get(p.targetType)
      ?.resolve(p.targetId, m);
    if (!record) return own;
    return withRecord(form.fields, record.values, own, true);
  }

  /**
   * «Авто-таблиця» of what the document shows: as frozen (Paper.tables);
   * until then (and `fresh`: a report frozen again) live — the rows of each
   * source for the value of its field, as `reader` may see them.
   */
  private async tablesOf(
    m: EntityManager,
    p: Paper,
    shown: Shown,
    reader: Actor,
    fresh = false,
  ): Promise<AutoTables> {
    if (p.tables && !fresh) return p.tables;
    const out: AutoTables = {};
    for (const n of shown.content.content ?? []) {
      if (n.type !== 'autoTable') continue;
      const source = n.attrs?.source as string;
      const field = n.attrs?.field as string;
      const key = tableKey(source, field);
      if (key in out) continue;
      const data = await this.tables.data(
        source,
        shown.values[field],
        reader,
        m,
      );
      if (data) out[key] = data;
    }
    return out;
  }

  /**
   * The record a report is about — the value of its record field (see
   * reportRecordKey), as its module reads it now; null — not chosen yet,
   * or there is none any more.
   */
  private async recordOfReport(
    m: EntityManager,
    form: Form,
    values: FieldValues,
  ): Promise<RecordValues | null> {
    const type = form.template.target!;
    const key = reportRecordKey(form.fields, type);
    const id = key === null ? undefined : values[key];
    if (typeof id !== 'string') return null;
    const record = await this.adapters.reader(type)?.resolve(id, m);
    return record?.values ?? null;
  }

  private async view(
    m: EntityManager,
    p: Paper,
    actor: Actor,
  ): Promise<Plain<PaperDto>> {
    const form = await this.formOf(m, p);
    const editable = canEdit(p, actor);
    const staff = can(actor, Action.PapersFillStaff);
    const shown = await this.shown(m, p, form);
    const { content, values } = shown;
    const may = await this.changer(m, p, form, actor);
    const owner = { ownerId: p.authorId };
    const snaps = await m.find(PaperSnapshot, {
      select: {
        id: true,
        n: true,
        sha256: true,
        archiveDocId: true,
        signers: true,
        createdAt: true,
      },
      where: { paperId: p.id },
      order: { n: 'ASC' },
    });
    const snap = snaps.at(-1);
    const lines = snap ? await this.signLinesOf(m, snap) : [];
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
        fields: form.fields.map((f): Plain<PaperFieldDto> =>
          fieldView(
            f,
            editable
              ? !f.auto &&
                  fillableType(this.links, f.type) &&
                  (f.fill === 'author' || staff)
              : !!may?.(f),
          ),
        ),
      },
      refs: (await this.refsOf(m, shown, form, actor)).map(
        (r): Plain<PaperRefDto> => ({ ...r, type: r.type as RecordType }),
      ),
      tables: await this.tablesOf(m, p, shown, actor),
      canEdit: editable,
      canChange: !!may && !!form?.fields.some(may),
      canPublish:
        p.status === PaperStatus.Draft &&
        can(actor, Action.PapersPublish, owner),
      canCancel: LIVE.has(p.status) && can(actor, Action.PapersCancel, owner),
      canFreeze:
        freezable(p, form) &&
        can(actor, Action.PapersFreeze, freezeOwner(p)) &&
        (await this.ready(m, p)),
      canSign:
        SIGNABLE.has(p.status) && can(actor, Action.PapersSign, freezeOwner(p)),
      canSignDrawn:
        SIGNABLE.has(p.status) &&
        lines.some((l) => l.person?.id === actor.id && !l.signedAt) &&
        can(actor, Action.PapersSignDrawn, { signer: true }),
      snapshot: snap
        ? {
            n: snap.n,
            sha256: snap.sha256,
            createdAt: snap.createdAt,
            signed: await this.signedOf(m, snap),
            signatures: lines,
          }
        : null,
      snapshots: snaps.map((x) => ({ n: x.n, createdAt: x.createdAt })),
    };
  }

  /**
   * The records of a document are ready (its adapter: a task done), so it
   * may be frozen; a free document always is. A record gone does not hold
   * it back.
   */
  private async ready(m: EntityManager, p: Paper) {
    if (!p.targetType) return true;
    const adapter = this.adapters.get(p.targetType);
    if (!adapter) return false;
    for (const id of await recordsOfPaper(m, p)) {
      const r = await adapter.resolve(id, m);
      if (r && !r.ready) return false;
    }
    return true;
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
        'p.targetType',
        'p.targetId',
        'p.publishedAt',
        'p.createdAt',
        'p.updatedAt',
        'author.id',
        'author.name',
        'author.avatarUrl',
      ]);
    whereSeen(qb, actor, this.adapters);
    if (q.mine === 'true') qb.andWhere('p.authorId = :me', { me: actor.id });
    if (q.status) qb.andWhere('p.status = :status', { status: q.status });
    if (q.about === 'me') {
      qb.andWhere(
        `p.status <> :draft AND p.authorId <> :me AND p.id IN (
           SELECT l.from_id FROM record_links l
            WHERE l.from_type = 'paper' AND l.to_type = 'user' AND l.to_id = :me)`,
        { me: actor.id, draft: PaperStatus.Draft },
      );
    }
    if (q.due === 'freeze') {
      qb.andWhere('p.status = :published', {
        published: PaperStatus.Published,
      }).andWhere(
        `NOT EXISTS (
           SELECT 1 FROM paper_template_versions v
             JOIN paper_templates t ON t.id = v.template_id
            WHERE v.id = p.template_version_id AND t.auto_freeze)`,
      );
      if (!can(actor, Action.PapersFreeze, {})) {
        qb.andWhere('p.authorId = :me AND p.targetType IS NULL', {
          me: actor.id,
        });
      }
    }
    if (q.due === 'sign' || q.due === 'scan') {
      qb.andWhere('p.status = :frozen AND p.updatedAt >= :since', {
        frozen: PaperStatus.Frozen,
        since: new Date(Date.now() - DUE_SIGN_DAYS * 24 * 3600 * 1000),
      });
    }
    if (q.due === 'scan' && !can(actor, Action.PapersSign, {})) {
      qb.andWhere('p.authorId = :me AND p.targetType IS NULL', {
        me: actor.id,
      });
    }
    if (q.due === 'sign') qb.andWhere(awaitsMeSql, { me: actor.id });
    if (q.search) {
      qb.andWhere('(p.title ILIKE :s OR p.number ILIKE :s)', {
        s: `%${escapeLike(q.search)}%`,
      });
    }
    qb.orderBy('p.updatedAt', 'DESC').addOrderBy('p.id', 'ASC');
    if (q.due === 'freeze') {
      // Readiness is the records' modules': pages come after it. Documents
      // waiting for freezing are few.
      const due: Paper[] = [];
      for (const p of await qb.getMany()) {
        if (await this.ready(this.ds.manager, p)) due.push(p);
      }
      const items = due.slice((page - 1) * limit, page * limit);
      return { items: items.map(itemView), total: due.length, page, limit };
    }
    qb.skip((page - 1) * limit).take(limit);
    const [rows, total] = await qb.getManyAndCount();
    return { items: rows.map(itemView), total, page, limit };
  }

  async get(id: string, actor: Actor): Promise<PaperDto> {
    const m = this.ds.manager;
    return this.view(m, await this.accessible(m, id, actor), actor);
  }

  /**
   * The values of fields and the requisites for the sheet: the structure
   * blocks take «Реквізити», the author and the day of publication; records
   * are named as `viewer` sees them.
   */
  private async fillOf(
    m: EntityManager,
    p: Paper,
    shown: Shown,
    form: Form | null,
    viewer: Actor,
    tables: AutoTables,
  ): Promise<FieldFill> {
    const { values } = shown;
    const fields = new Map((form?.fields ?? []).map((f) => [f.key, f]));
    const refs = new Map(
      (await this.refsOf(m, shown, form, viewer)).map((r) => [
        `${r.type}:${r.id}`,
        r.title,
      ]),
    );
    const title = (type: string, id: string) =>
      refs.get(`${type}:${id}`) ?? null;
    const org = await this.org.get();
    const named = (name: string | null | undefined) =>
      name ? signName(name) : null;
    const fill: FieldFill = {
      number: p.number,
      text: (key) => {
        const f = fields.get(key);
        const v = values[key];
        return f && v !== undefined
          ? valueText(f.type, v, f.options, title)
          : null;
      },
      hidden: (key) => !fields.get(key)?.print,
      holds: (field, value) => values[field] === value,
      // «Повторювані рядки»: a row's cells as fields, its number for «№ рядка».
      rows: (key) => {
        const columns = new Map(
          (fields.get(key)?.columns ?? []).map((c) => [c.key, c]),
        );
        return rowsIn(values[key]).map((r, i) => ({
          ...fill,
          row: i + 1,
          hidden: () => false,
          text: (k: string) => {
            const c = columns.get(k);
            const v = r[k];
            return c && v !== undefined
              ? valueText(c.type, v, c.options, title)
              : null;
          },
        }));
      },
      title,
      table: (source, field) => tables[tableKey(source, field)] ?? null,
      info: {
        institution: org.institution,
        groupName: org.groupName,
        signerPosition: org.signerPosition,
        person: (signer) => {
          if (signer === SIGNER_AUTHOR) return named(p.author?.name);
          if (signer === SIGNER_ORG) return named(org.signer?.name);
          // A `ref:user` field: the member it holds, if the reader sees them.
          const v = values[signer];
          return fields.get(signer)?.type === 'ref:user' &&
            typeof v === 'string'
            ? named(title('user', v))
            : null;
        },
        date: p.publishedAt ? dayText(p.publishedAt) : null,
        year: yearText(p.publishedAt ?? new Date()),
      },
    };
    return fill;
  }

  /** A snapshot of the document: its number; none — the latest (null — not frozen). */
  private async snapshotOf(
    m: EntityManager,
    paperId: string,
    n?: number,
  ): Promise<PaperSnapshot | null> {
    if (n === undefined) {
      return m.findOne(PaperSnapshot, {
        where: { paperId },
        order: { n: 'DESC' },
      });
    }
    const snap = await m.findOneBy(PaperSnapshot, { paperId, n });
    if (!snap) throw new NotFoundException(PaperErrors.SnapshotNotFound);
    return snap;
  }

  /**
   * The sheet to print or copy. A frozen document — its snapshot (the latest
   * or the given one) with the seal: QR to the check page and SHA-256;
   * cancelled after freezing — the same marked «Скасовано». A document never
   * frozen — its current content with the values of fields, marked
   * «Чернетка», «Не зафіксовано» or «Скасовано»: print and PDF come from
   * snapshots only.
   */
  private async sheetOf(id: string, q: PrintPaperQuery, actor: Actor) {
    const m = this.ds.manager;
    const p = await this.accessible(m, id, actor);
    const snap = await this.snapshotOf(
      m,
      p.id,
      q.snapshot === undefined ? undefined : Number(q.snapshot),
    );
    if (snap) {
      return {
        paper: p,
        snapshot: snap.n,
        sheet: snap.html,
        signatures: await this.drawnOf(m, snap),
        footer: footerText(p.content),
        seal: sealOf(snap),
        mark:
          p.status === PaperStatus.Cancelled
            ? WATERMARK[PaperStatus.Cancelled]
            : null,
      };
    }
    const form = await this.formOf(m, p);
    const shown = await this.shown(m, p, form);
    const fill = await this.fillOf(
      m,
      p,
      shown,
      form,
      actor,
      await this.tablesOf(m, p, shown, actor),
    );
    return {
      paper: p,
      snapshot: null,
      sheet: sheetHtml(shown.content, fill),
      signatures: [],
      footer: footerText(shown.content),
      seal: null,
      mark: WATERMARK[p.status],
    };
  }

  /** Print page (see sheetOf), with a link to its DOCX copy. */
  async printHtml(
    id: string,
    q: PrintPaperQuery,
    actor: Actor,
  ): Promise<{ html: string; csp: string }> {
    const s = await this.sheetOf(id, q, actor);
    return paperPrintHtml({
      title: s.paper.title,
      sheet: signedSheet(
        s.sheet,
        s.signatures.map((x): SheetSignature => ({
          ...x,
          note: signedNote(x.signedAt),
        })),
      ),
      footer: s.footer,
      seal: s.seal,
      watermark: s.mark,
      // The copy of the very snapshot shown, even if one more is taken meanwhile.
      docx: `/api/papers/${s.paper.id}/docx${s.snapshot === null ? '' : `?snapshot=${s.snapshot}`}`,
    });
  }

  /** A copy in Word of the same sheet the print shows (see sheetOf). */
  async docx(
    id: string,
    q: PrintPaperQuery,
    actor: Actor,
  ): Promise<{ file: Buffer; name: string }> {
    const s = await this.sheetOf(id, q, actor);
    const file = await paperDocx({
      title: s.paper.title,
      sheet: signedSheet(
        s.sheet,
        s.signatures.map((x): SheetSignature => ({
          ...x,
          note: `${SIGNED_IN}: ${x.name}, ${momentText(x.signedAt)}`,
        })),
      ),
      footer: s.footer,
      seal: s.seal,
      mark: s.mark,
    });
    return { file, name: docxFileName(s.paper.title, s.paper.number) };
  }

  /**
   * Freezes a published document whose records are ready: the sheet as the
   * server renders it now, its SHA-256 and the values it shows become a
   * snapshot; the document keeps those values (bound fields stop following
   * the record) and is «Зафіксовано». Once only (PAPER_FROZEN) — but a
   * report: frozen or signed, it takes a new snapshot with its record as it
   * is now and is «Зафіксовано» again.
   */
  async freeze(id: string, actor: Actor): Promise<PaperDto> {
    return this.ds.transaction(async (m) => {
      const p = await this.accessible(m, id, actor, true);
      assertCan(actor, Action.PapersFreeze, freezeOwner(p));
      const form = await this.formOf(m, p);
      if (!freezable(p, form)) {
        throw new ConflictException(
          SIGNABLE.has(p.status)
            ? PaperErrors.Frozen
            : PaperErrors.NotPublished,
        );
      }
      if (!(await this.ready(m, p))) {
        throw new ConflictException(PaperErrors.NotReady);
      }
      await this.snapshot(m, p, form, actor, false);
      return this.view(m, p, actor);
    });
  }

  /**
   * A module's record became ready (a task accepted): its documents whose
   * template freezes them themselves are frozen now, in the module's
   * transaction, by who made it ready.
   */
  async recordReady(
    type: RecordType,
    id: string,
    actor: Actor,
    m: EntityManager,
  ): Promise<void> {
    const links = await m.findBy(RecordLink, {
      fromType: 'paper',
      toType: type,
      toId: id,
      role: TARGET_ROLE,
    });
    for (const paperId of new Set(links.map((l) => l.fromId))) {
      const p = await m.findOne(Paper, {
        where: { id: paperId },
        lock: { mode: 'pessimistic_write' },
      });
      if (p) await this.autoFreeze(m, p, await this.formOf(m, p), actor);
    }
  }

  /** Freezes a published document whose template says so, once its records are ready. */
  private async autoFreeze(
    m: EntityManager,
    p: Paper,
    form: Form | null,
    actor: Actor,
  ) {
    if (
      form?.template.autoFreeze &&
      p.status === PaperStatus.Published &&
      (await this.ready(m, p))
    ) {
      await this.snapshot(m, p, form, actor, true);
    }
  }

  /**
   * The snapshot: records are named in full (as staff see them) — the
   * sheet is the same for every reader. Links follow what it shows (the
   * record's fields included: assignees of a task, for one).
   */
  private async snapshot(
    m: EntityManager,
    p: Paper,
    form: Form | null,
    actor: Actor,
    auto: boolean,
  ) {
    p.author ??=
      (await m.getRepository(User).findOneBy({ id: p.authorId })) ?? undefined;
    const shown = await this.shown(m, p, form, true);
    const viewer: Actor = { id: actor.id, role: Role.Admin };
    const tables = await this.tablesOf(m, p, shown, viewer, true);
    const fill = await this.fillOf(m, p, shown, form, viewer, tables);
    const [{ n }] = await m.query<{ n: number }[]>(
      `SELECT COALESCE(MAX("n"), 0)::int + 1 AS "n" FROM "paper_snapshots" WHERE "paper_id" = $1`,
      [p.id],
    );
    const html = sheetHtml(shown.content, fill, { paperId: p.id, n });
    const sha256 = sheetHash(html);
    await m.getRepository(PaperSnapshot).insert({
      paperId: p.id,
      n,
      html,
      sha256,
      resolvedValues: shown.values,
      signers: await this.signersOf(p, shown, fill),
      createdById: actor.id,
    });
    const fresh = new Set(
      (await this.refsOf(m, shown, form, viewer)).map(
        (r) => `${r.type}:${r.id}`,
      ),
    );
    p.content = shown.content;
    p.values = shown.values;
    p.tables = tables;
    p.status = PaperStatus.Frozen;
    p.revision += 1;
    await m.getRepository(Paper).save(p);
    await syncLinks(
      m,
      p.id,
      form?.fields ?? [],
      p.values,
      p.content,
      fresh,
      actor.id,
    );
    await this.audit.log(
      {
        actorId: actor.id,
        action: 'paper.frozen',
        entity: 'paper',
        entityId: p.id,
        meta: {
          title: p.title,
          authorId: p.authorId,
          number: p.number,
          n,
          sha256,
          ...(auto ? { auto: true } : {}),
        },
      },
      m,
    );
  }

  /**
   * The check of a printed document by the hash of its sheet: for everyone
   * signed in — the snapshot is genuine and what its document is now; the
   * document's id only for who sees it.
   */
  async verify(sha256: string, actor: Actor): Promise<Plain<PaperVerifyDto>> {
    const m = this.ds.manager;
    const snap = /^[0-9a-f]{64}$/.test(sha256)
      ? await m.findOne(PaperSnapshot, {
          where: { sha256 },
          relations: { createdBy: true },
        })
      : null;
    if (!snap) throw new NotFoundException(PaperErrors.SnapshotNotFound);
    const p = await m.findOneByOrFail(Paper, { id: snap.paperId });
    const last = await m.maximum(PaperSnapshot, 'n', { paperId: p.id });
    return {
      sha256: snap.sha256,
      n: snap.n,
      latest: last === snap.n,
      frozenAt: snap.createdAt,
      frozenBy: snap.createdBy
        ? { id: snap.createdBy.id, name: snap.createdBy.name }
        : null,
      number: p.number,
      title: p.title,
      status: p.status,
      cancelReason: p.cancelReason,
      paperId: (await this.sees(m, p, actor)) ? p.id : null,
      signatures: (await this.signLinesOf(m, snap)).flatMap((l) =>
        l.person
          ? [{ label: l.label, name: l.person.name, signedAt: l.signedAt }]
          : [],
      ),
    };
  }

  /**
   * Who each line to sign on of the sheet awaits, as `fill` names them: the
   * author, the signer from «Реквізити» or the member a `ref:user` field
   * holds; a line naming nobody — none (a scan only).
   */
  private async signersOf(
    p: Paper,
    shown: Shown,
    fill: FieldFill,
  ): Promise<SnapshotSigner[]> {
    const org = await this.org.get();
    return signLines(shown.content).map(({ label, signer }) => {
      if (signer === null || fill.info.person(signer) === null) {
        return { label, userId: null };
      }
      const v =
        signer === SIGNER_AUTHOR
          ? p.authorId
          : signer === SIGNER_ORG
            ? org.signer?.id
            : shown.values[signer];
      return { label, userId: typeof v === 'string' ? v : null };
    });
  }

  /** The lines to sign on of a snapshot: who each awaits, signed when and how; none — frozen before drawn signatures. */
  private async signLinesOf(
    m: EntityManager,
    snap: PaperSnapshot,
  ): Promise<Plain<PaperSignLineDto>[]> {
    const signers = snap.signers ?? [];
    const ids = [
      ...new Set(signers.flatMap((s) => (s.userId ? [s.userId] : []))),
    ];
    const users = new Map(
      (ids.length
        ? await m.find(User, {
            select: { id: true, name: true },
            where: ids.map((id) => ({ id })),
          })
        : []
      ).map((u) => [u.id, u]),
    );
    const signed = new Map(
      (
        await m.find(PaperSignature, {
          select: { row: true, signedAt: true, strokes: true },
          where: { snapshotId: snap.id },
        })
      ).map((g) => [g.row, g]),
    );
    return signers.map((s, row) => {
      const u = s.userId ? users.get(s.userId) : undefined;
      const g = signed.get(row);
      return {
        row,
        label: s.label,
        person: u ? { id: u.id, name: u.name } : null,
        signedAt: g?.signedAt ?? null,
        strokes: g?.strokes ?? null,
      };
    });
  }

  /** The drawn signatures of a snapshot, for the print and the DOCX. */
  private async drawnOf(m: EntityManager, snap: PaperSnapshot) {
    const list = await m.find(PaperSignature, {
      where: { snapshotId: snap.id },
      relations: { user: true },
      order: { row: 'ASC' },
    });
    return list.map((g) => ({
      row: g.row,
      strokes: g.strokes,
      name: g.user?.name ?? '',
      signedAt: g.signedAt,
    }));
  }

  /**
   * A drawn signature on the latest snapshot: on every line awaiting the
   * actor they have not signed yet, the same drawing — only the person a
   * line names (an admin too). Frozen, or signed with a scan already;
   * every line naming someone signed — «Підписано».
   */
  async signDrawn(
    id: string,
    dto: SignPaperDto,
    actor: Actor,
  ): Promise<PaperDto> {
    return this.ds.transaction(async (m) => {
      const p = await this.accessible(m, id, actor, true);
      if (!SIGNABLE.has(p.status)) {
        throw new ConflictException(PaperErrors.NotFrozen);
      }
      const snap = (await this.snapshotOf(m, p.id))!;
      const signers = snap.signers ?? [];
      const mine = signers.flatMap((s, row) =>
        s.userId === actor.id ? [row] : [],
      );
      assertCan(actor, Action.PapersSignDrawn, { signer: mine.length > 0 });
      const done = new Set(
        (
          await m.find(PaperSignature, {
            select: { row: true },
            where: { snapshotId: snap.id },
          })
        ).map((g) => g.row),
      );
      const rows = mine.filter((row) => !done.has(row));
      if (!rows.length) throw new ConflictException(PaperErrors.SignedByYou);
      await m.getRepository(PaperSignature).insert(
        rows.map((row) => ({
          snapshotId: snap.id,
          row,
          userId: actor.id,
          strokes: dto.strokes,
        })),
      );
      rows.forEach((row) => done.add(row));
      const complete = signers.every(
        (s, row) => s.userId === null || done.has(row),
      );
      if (complete) p.status = PaperStatus.Signed;
      p.revision += 1;
      await m.getRepository(Paper).save(p);
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'paper.signature_added',
          entity: 'paper',
          entityId: p.id,
          meta: {
            title: p.title,
            authorId: p.authorId,
            number: p.number,
            n: snap.n,
            lines: rows.map((row) => signers[row]!.label),
            complete,
          },
        },
        m,
      );
      return this.view(m, p, actor);
    });
  }

  /** The latest signed scan of a snapshot; null — none. */
  private async signedOf(
    m: EntityManager,
    snap: PaperSnapshot,
  ): Promise<Plain<PaperSignedDto> | null> {
    if (!snap.archiveDocId) return null;
    const ver = await m.findOne(DocVersion, {
      where: { docId: snap.archiveDocId },
      order: { version: 'DESC' },
    });
    return ver
      ? {
          version: ver.version,
          fileName: ver.fileName,
          mimeType: ver.mimeType,
          size: ver.size,
          uploadedAt: ver.createdAt,
        }
      : null;
  }

  /**
   * The signed paper scanned or photographed: a version of the archive
   * document of the latest snapshot (made with the first scan: «Підписані
   * документи», seen by staff only — others open it through the document).
   * The document becomes «Підписано»; a later scan is the next version.
   */
  async sign(
    id: string,
    file: UploadedFileLike | undefined,
    actor: Actor,
  ): Promise<PaperDto> {
    let stored: StoredFile | null = null;
    try {
      return await this.ds.transaction(async (m) => {
        const p = await this.accessible(m, id, actor, true);
        assertCan(actor, Action.PapersSign, freezeOwner(p));
        if (!SIGNABLE.has(p.status)) {
          throw new ConflictException(PaperErrors.NotFrozen);
        }
        const snap = (await this.snapshotOf(m, p.id))!;
        stored = await this.documents.store(file, SCAN_EXTENSIONS);
        const doc = snap.archiveDocId
          ? await m.findOneOrFail(Doc, {
              where: { id: snap.archiveDocId },
              lock: { mode: 'pessimistic_write' },
            })
          : null;
        const ver = doc
          ? await this.documents.insertVersion(m, doc, stored, '', actor)
          : await this.scanDoc(m, p, snap, stored, actor);
        p.status = PaperStatus.Signed;
        p.revision += 1;
        await m.getRepository(Paper).save(p);
        await this.audit.log(
          {
            actorId: actor.id,
            action: 'paper.signed',
            entity: 'paper',
            entityId: p.id,
            meta: {
              title: p.title,
              authorId: p.authorId,
              number: p.number,
              n: snap.n,
              documentId: ver.docId,
              version: ver.version,
              fileName: ver.fileName,
            },
          },
          m,
        );
        return this.view(m, p, actor);
      });
    } catch (e) {
      if (stored) await this.documents.discard(stored);
      throw e;
    }
  }

  /** The archive document of a snapshot's scans, with the first one. */
  private async scanDoc(
    m: EntityManager,
    p: Paper,
    snap: PaperSnapshot,
    stored: StoredFile,
    actor: Actor,
  ) {
    const category = await ensureDictionaryItem(
      m,
      DOCUMENT_CATEGORY,
      SCAN_CATEGORY.key,
      SCAN_CATEGORY.title,
    );
    if (category.created) {
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'dictionary.item_created',
          entity: 'dictionary_item',
          entityId: category.created.id,
          meta: {
            dictionary: DOCUMENT_CATEGORY,
            key: category.key,
            title: category.created.title,
            color: category.created.color,
          },
        },
        m,
      );
    }
    const name = [p.number, p.title].filter(Boolean).join(' ');
    const { doc, ver } = await this.documents.insertDoc(
      m,
      {
        title: (snap.n > 1 ? `${name} (знімок ${snap.n})` : name).slice(0, 200),
        category: category.key,
        description: 'Підписаний скан документа з Редактора.',
        accessScope: AccessScope.Supervisors,
      },
      stored,
      actor,
    );
    snap.archiveDocId = doc.id;
    await m.getRepository(PaperSnapshot).save(snap);
    return ver;
  }

  /** The latest signed scan of the document, for who sees the document. */
  async scan(id: string, actor: Actor) {
    const m = this.ds.manager;
    const p = await this.accessible(m, id, actor);
    const snap = await this.snapshotOf(m, p.id);
    if (!snap?.archiveDocId) {
      throw new NotFoundException(PaperErrors.ScanNotFound);
    }
    return this.documents.file(m, snap.archiveDocId);
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
      const form = from && {
        ...from,
        fields: await this.fieldsOf(m, from.template, from.version),
      };
      if (dto.about && !form) {
        throw new BadRequestException('A free document is about nothing');
      }
      // The record it is about: in the first field the actor fills that
      // refers to its type; else in such a column — the first row.
      const fills = (f: PaperField) =>
        !f.auto && (f.fill === 'author' || can(actor, Action.PapersFillStaff));
      const ref = `ref:${dto.about?.type}`;
      const field = dto.about
        ? form!.fields.find((f) => f.type === ref && fills(f))
        : undefined;
      const rows = dto.about
        ? form!.fields.find(
            (f) => fills(f) && f.columns?.some((c) => c.type === ref),
          )
        : undefined;
      const column = rows?.columns?.find((c) => c.type === ref);
      const about = field
        ? { [field.key]: dto.about!.id }
        : rows && column
          ? { [rows.key]: [{ [column.key]: dto.about!.id }] }
          : {};
      // A free document's own content and the value of `about`: checked as
      // any save of it.
      const values =
        this.checked(
          form,
          actor,
          {
            ...(from ? {} : { content }),
            values: about,
          },
          { content: from ? content : EMPTY_CONTENT, values: {} },
        ) ?? {};
      // What a template's body refers to is the template's own.
      const fresh = await checkNewRefs(
        this.links,
        form?.fields ?? [],
        { values, content },
        { values: {}, content: from ? content : EMPTY_CONTENT },
        actor,
        m,
      );
      return this.insert(m, actor, {
        title: dto.title?.trim() || from?.template.title || UNTITLED,
        content,
        values,
        from,
        fields: form?.fields ?? [],
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

  /**
   * A document for a record made without one (before documents): from a
   * template that creates records of its type, with the bound fields taken
   * from the record as it is now (a template of rows — one row of it),
   * published at once — with a number and the link to the record. Only who
   * the record's adapter lets (`adopt`), and only while the record has no
   * document (409 PAPER_TARGET_TAKEN).
   */
  async forRecord(dto: PaperForRecordDto, actor: Actor): Promise<PaperDto> {
    return this.ds.transaction(async (m) => {
      const from = await this.templates.forPaper(m, dto.templateId, actor);
      const { template, version } = from;
      const type = template.target;
      const adapter =
        template.kind === TemplateKind.Creates && type
          ? this.adapters.get(type)
          : undefined;
      if (!type || !adapter) {
        throw new BadRequestException(TemplateErrors.KindInvalid);
      }
      // Two at once would both see the record without a document.
      await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `paper-target:${type}:${dto.targetId}`,
      ]);
      const fields = await this.fieldsOf(m, template, version);
      const record = await adapter.resolve(dto.targetId, m);
      if (!record) throw new NotFoundException('Record not found');
      const rows = recordRows(fields);
      const filled = rows
        ? {
            content: version.body,
            values: { [rows.key]: [rowOf(rows, record.values)] },
          }
        : withRecord(
            fields,
            record.values,
            { content: version.body, values: {} },
            false,
          );
      const fresh = new Set(
        (
          await seenRefs(
            this.links,
            fields,
            filled.values,
            filled.content,
            actor,
            m,
          )
        ).map((r) => `${r.type}:${r.id}`),
      );
      const repo = m.getRepository(Paper);
      const p = await repo.save(
        repo.create({
          title: template.title,
          content: filled.content,
          values: filled.values,
          templateVersionId: version.id,
          visibility: template.visibility,
          authorId: actor.id,
          status: PaperStatus.Published,
          publishedAt: new Date(),
          number: template.numberPrefix
            ? await nextNumber(m, template.numberPrefix)
            : null,
          targetType: type,
          // Records of rows are known by their links only.
          targetId: rows ? null : dto.targetId,
        }),
      );
      // The module may refer to the document: it must be saved first.
      await adapter.adopt(dto.targetId, p.id, actor, m);
      if (await papersOf(m, type, dto.targetId)) {
        throw new ConflictException(PaperErrors.TargetTaken);
      }
      await m.getRepository(RecordLink).insert({
        fromType: 'paper',
        fromId: p.id,
        toType: type,
        toId: dto.targetId,
        role: TARGET_ROLE,
        createdById: actor.id,
      });
      await syncLinks(
        m,
        p.id,
        fields,
        filled.values,
        filled.content,
        fresh,
        actor.id,
      );
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
            targetType: type,
            ...targetMeta(p, [dto.targetId]),
            templateId: template.id,
            version: version.number,
            fromRecord: true,
          },
        },
        m,
      );
      await this.autoFreeze(m, p, { template, version, fields }, actor);
      return this.view(m, await this.accessible(m, p.id, actor), actor);
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
   * the log, and a draft is not a record yet. Values and zones of a
   * published document — see change().
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
      if (
        text &&
        p.status === PaperStatus.Published &&
        p.templateVersionId &&
        dto.title === undefined &&
        dto.visibility === undefined
      ) {
        return this.change(m, p, dto, actor);
      }
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
   * Fields «можна змінити» of a published document (see changer): bound
   * ones change the record through its adapter (its rights, audit and
   * errors — with the key of the field), the rest are kept by the document.
   * One change — one record change and one audit entry, whoever makes it.
   */
  private async change(
    m: EntityManager,
    p: Paper,
    dto: UpdatePaperDto,
    actor: Actor,
  ): Promise<PaperItemDto> {
    const form = (await this.formOf(m, p))!;
    const may = (await this.changer(m, p, form, actor))!;
    if (dto.revision !== p.revision) {
      throw new ConflictException('Paper was changed by someone else');
    }
    const shown = await this.shown(m, p, form);
    if (dto.content !== undefined) {
      // Who fills what — by `may` (changedFields).
      checkContent(
        dto.content,
        form.version.body,
        form.fields,
        shown.content,
        true,
      );
    }
    const changes = changedFields(dto, form.fields, shown, may);
    if (!changes.values.size && !changes.zones.size) return itemView(p);

    const next = {
      values: { ...shown.values },
      content: dto.content ?? shown.content,
    };
    for (const [key, v] of changes.values) {
      if (v === null) delete next.values[key];
      else next.values[key] = v;
    }
    requireFilled(form.fields, next);

    const bound = form.fields.filter(
      (f) =>
        f.binding !== null &&
        (changes.values.has(f.key) || changes.zones.has(f.key)),
    );
    if (bound.length) {
      const adapter = this.adapters.get(p.targetType!)!;
      await withFieldKeys(form.fields, () =>
        adapter.update(p.targetId!, recordValues(bound, next), actor, m),
      );
    }
    // The document keeps its own fields; bound ones show the record.
    const own = { ...p.values };
    for (const [key, v] of changes.values) {
      if (form.fields.find((f) => f.key === key)?.binding !== null) continue;
      if (v === null) delete own[key];
      else own[key] = v;
    }
    // Off by what the document shows (a bound condition is the record's).
    const stored = withoutOff(
      { values: withoutEmptyRows(form.fields, own), content: next.content },
      offFields(next.content, next.values),
    );
    const fresh = await checkNewRefs(
      this.links,
      form.fields,
      stored,
      p,
      actor,
      m,
    );
    p.values = stored.values;
    p.content = stored.content;
    p.revision += 1;
    await m.getRepository(Paper).save(p);
    await syncLinks(
      m,
      p.id,
      form.fields,
      stored.values,
      stored.content,
      fresh,
      actor.id,
    );
    await this.audit.log(
      {
        actorId: actor.id,
        action: 'paper.updated',
        entity: 'paper',
        entityId: p.id,
        meta: {
          authorId: p.authorId,
          number: p.number,
          fields: [...changes.values.keys(), ...changes.zones].sort(),
          ...(bound.length
            ? { targetType: p.targetType, targetId: p.targetId }
            : {}),
        },
      },
      m,
    );
    return itemView(p);
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
      let targetIds: string[] = [];
      if (form) {
        requireFilled(form.fields, p);
        Object.assign(p, withoutOff(p));
        // Rows as the author sees them: an error names a row by its place there.
        const drafted = p.values;
        p.values = withoutEmptyRows(form.fields, p.values);
        if (form.template.kind === TemplateKind.Report) {
          // A version naming no record — TEMPLATE_NEEDS_UPDATE.
          await this.templates.assertCurrent(form.template, form.version);
          // Its record still stands (it may have been deleted since).
          if (!(await this.recordOfReport(m, form, p.values))) {
            throw fieldInvalid(
              reportRecordKey(form.fields, form.template.target!)!,
            );
          }
        }
        if (form.template.kind === TemplateKind.Creates) {
          await this.templates.assertCurrent(form.template, form.version);
          const type = form.template.target!;
          const adapter = this.adapters.get(type);
          if (!adapter)
            throw new ConflictException(PaperFieldErrors.NeedsUpdate);
          const rows = recordRows(form.fields);
          if (rows) {
            // «Рядок = запис»: a record of each row, in this one transaction.
            const all = rowsIn(drafted[rows.key]);
            for (let i = 0; i < all.length; i++) {
              if (isEmptyRow(all[i]!)) continue;
              targetIds.push(
                await inRow(rows.key, i, () =>
                  adapter.publish(rowValues(rows, all[i]!), actor, m, p.id),
                ),
              );
            }
          } else {
            targetIds = [
              await withFieldKeys(form.fields, () =>
                adapter.publish(recordValues(form.fields, p), actor, m, p.id),
              ),
            ];
          }
          p.targetType = type;
          // Records of rows are known by their links only.
          p.targetId = rows ? null : targetIds[0]!;
          await m.getRepository(RecordLink).insert(
            targetIds.map((toId) => ({
              fromType: 'paper',
              fromId: p.id,
              toType: type,
              toId,
              role: TARGET_ROLE,
              createdById: actor.id,
            })),
          );
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
              ? { targetType: p.targetType, ...targetMeta(p, targetIds) }
              : {}),
          },
        },
        m,
      );
      // A record ready at once (a discipline record): frozen with it.
      await this.autoFreeze(m, p, form, actor);
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
      const after: (() => Promise<void>)[] = [];
      const targetIds = await recordsOfPaper(m, p);
      const adapter = p.targetType ? this.adapters.get(p.targetType) : null;
      for (const id of adapter ? targetIds : []) {
        const then = await adapter!.cancel(id, reason, actor, m, p.id);
        if (then) after.push(then);
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
              ? { targetType: p.targetType, ...targetMeta(p, targetIds) }
              : {}),
          },
        },
        m,
      );
      return [await this.view(m, p, actor), after] as const;
    });
    for (const then of after) await then();
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
