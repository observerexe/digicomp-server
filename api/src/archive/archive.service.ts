import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, SelectQueryBuilder } from 'typeorm';
import { Action, can, type Actor } from '../auth/policy';
import type { Plain } from '../common/responses.dto';
import { escapeLike } from '../common/like';
import { itemTitleLike } from '../dictionaries/dictionary-usage';
import {
  AccessScope,
  Doc,
  DOCUMENT_CATEGORY,
  DocVersion,
} from '../documents/doc.entity';
import { linkedWithSql } from '../links/links.sql';
import { PaperAdapterRegistry } from '../paperwork/adapters';
import { whereSeen } from '../paperwork/paper.links';
import { Paper } from '../paperwork/paper.entity';
import { ArchiveKind, ListArchiveQuery } from './dto';
import type { ArchiveItemDto, ArchiveListDto } from './responses.dto';

const yearOf = (column: string) =>
  `EXTRACT(YEAR FROM ${column} AT TIME ZONE 'Europe/Kyiv')::int`;

/** Not the archive document holding the signed scans of a snapshot. */
const NOT_A_SCAN = `NOT EXISTS (
  SELECT 1 FROM paper_snapshots s WHERE s.archive_doc_id = d.id)`;

/** Editor documents that were frozen at least once. */
const HAS_SNAPSHOT = `EXISTS (
  SELECT 1 FROM paper_snapshots s WHERE s.paper_id = p.id)`;

/**
 * The Archive as one search: the uploaded files and the frozen editor
 * documents (their signed scans are not rows of their own — they open
 * through the document). Each source is read with its own visibility; the
 * two are merged by the last change.
 */
@Injectable()
export class ArchiveService {
  constructor(
    @InjectDataSource() private ds: DataSource,
    private adapters: PaperAdapterRegistry,
  ) {}

  async list(q: ListArchiveQuery, actor: Actor): Promise<ArchiveListDto> {
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(q.limit ?? 50)));
    const archived =
      q.archived === 'true' && can(actor, Action.DocumentsManage);
    const files = this.files(actor, archived);
    const papers = archived ? null : this.papers(actor);

    const [years, categories] = await Promise.all([
      this.years(files, papers),
      files
        .clone()
        .select('DISTINCT d.category', 'c')
        .getRawMany<{ c: string }>()
        .then((r) => r.map((x) => x.c)),
    ]);

    const withFiles = q.kind !== ArchiveKind.Paper && !q.status;
    const withPapers = q.kind !== ArchiveKind.File && !q.category;
    // Each source gives the rows up to this page; the merge cuts the page.
    const upTo = page * limit;
    const [f, p] = await Promise.all([
      withFiles ? this.fileRows(files, q, upTo) : empty,
      papers && withPapers ? this.paperRows(papers, q, upTo) : empty,
    ]);
    const items = [...f.items, ...p.items]
      .sort(
        (a, b) =>
          b.updatedAt.getTime() - a.updatedAt.getTime() ||
          a.id.localeCompare(b.id),
      )
      .slice((page - 1) * limit, upTo);
    return {
      items,
      total: f.total + p.total,
      page,
      limit,
      years,
      categories,
    };
  }

  /** Files the actor sees: staff — all of a mode (in the Archive or taken out). */
  private files(actor: Actor, archived: boolean) {
    const qb = this.ds
      .getRepository(Doc)
      .createQueryBuilder('d')
      .where(archived ? 'd.archivedAt IS NOT NULL' : 'd.archivedAt IS NULL')
      .andWhere('d.deletedAt IS NULL')
      .andWhere(NOT_A_SCAN);
    if (!can(actor, Action.DocumentsManage)) {
      qb.andWhere('d.accessScope = :scope', { scope: AccessScope.Members });
    }
    return qb;
  }

  /** Frozen documents the actor sees (the rule of PapersRead). */
  private papers(actor: Actor) {
    const qb = this.ds
      .getRepository(Paper)
      .createQueryBuilder('p')
      .where(HAS_SNAPSHOT);
    return whereSeen(qb, actor, this.adapters);
  }

  private async years(
    files: SelectQueryBuilder<Doc>,
    papers: SelectQueryBuilder<Paper> | null,
  ) {
    const of = (qb: SelectQueryBuilder<Doc> | SelectQueryBuilder<Paper>) =>
      qb.getRawMany<{ y: number }>().then((r) => r.map((x) => Number(x.y)));
    const all = await Promise.all([
      of(files.clone().select(`DISTINCT ${yearOf('d.created_at')}`, 'y')),
      papers
        ? of(
            papers
              .clone()
              .andWhere('p.publishedAt IS NOT NULL')
              .select(`DISTINCT ${yearOf('p.published_at')}`, 'y'),
          )
        : [],
    ]);
    return [...new Set(all.flat())].sort((a, b) => b - a);
  }

  private async fileRows(
    base: SelectQueryBuilder<Doc>,
    q: ListArchiveQuery,
    upTo: number,
  ): Promise<Rows> {
    const qb = base.clone();
    if (q.category) qb.andWhere('d.category = :cat', { cat: q.category });
    if (q.year) {
      qb.andWhere(`${yearOf('d.created_at')} = :year`, { year: +q.year });
    }
    if (q.linkedType && q.linkedId) {
      qb.andWhere(linkedWithSql('document', 'd.id'), {
        linkedType: q.linkedType,
        linkedId: q.linkedId,
      });
    }
    if (q.search) {
      qb.andWhere(
        `(d.title ILIKE :s OR d.description ILIKE :s OR ${itemTitleLike('d.category', 'dict', 's')})`,
        { s: `%${escapeLike(q.search)}%`, dict: DOCUMENT_CATEGORY },
      );
    }
    const [rows, total] = await qb
      .orderBy('d.updatedAt', 'DESC')
      .addOrderBy('d.id', 'ASC')
      .take(upTo)
      .getManyAndCount();
    const latest = new Map<string, DocVersion>();
    if (rows.length) {
      const vers = await this.ds.getRepository(DocVersion).find({
        where: { docId: In(rows.map((d) => d.id)) },
        order: { version: 'DESC' },
      });
      for (const v of vers) if (!latest.has(v.docId)) latest.set(v.docId, v);
    }
    const items = rows.map((d): Plain<ArchiveItemDto> => {
      const v = latest.get(d.id);
      return {
        kind: ArchiveKind.File,
        id: d.id,
        title: d.title,
        updatedAt: d.updatedAt,
        file: {
          category: d.category,
          accessScope: d.accessScope,
          archived: !!d.archivedAt,
          version: v?.version ?? null,
          fileName: v?.fileName ?? null,
          size: v?.size ?? null,
        },
        paper: null,
      };
    });
    return { items, total };
  }

  private async paperRows(
    base: SelectQueryBuilder<Paper>,
    q: ListArchiveQuery,
    upTo: number,
  ): Promise<Rows> {
    const qb = base
      .clone()
      .leftJoin('p.author', 'author')
      .leftJoin('p.templateVersion', 'v')
      .leftJoin('v.template', 't')
      // Lists never carry the content: it may be large.
      .select([
        'p.id',
        'p.title',
        'p.number',
        'p.status',
        'p.authorId',
        'p.updatedAt',
        'author.id',
        'author.name',
        'author.avatarUrl',
        'author.color',
        'v.id',
        't.id',
        't.title',
      ]);
    if (q.status) qb.andWhere('p.status = :status', { status: q.status });
    if (q.year) {
      qb.andWhere(`${yearOf('p.published_at')} = :year`, { year: +q.year });
    }
    if (q.linkedType && q.linkedId) {
      qb.andWhere(linkedWithSql('paper', 'p.id'), {
        linkedType: q.linkedType,
        linkedId: q.linkedId,
      });
    }
    if (q.search) {
      qb.andWhere('(p.title ILIKE :ps OR p.number ILIKE :ps)', {
        ps: `%${escapeLike(q.search)}%`,
      });
    }
    const [rows, total] = await qb
      .orderBy('p.updatedAt', 'DESC')
      .addOrderBy('p.id', 'ASC')
      .take(upTo)
      .getManyAndCount();
    const items = rows.map((p): Plain<ArchiveItemDto> => ({
      kind: ArchiveKind.Paper,
      id: p.id,
      title: p.title,
      updatedAt: p.updatedAt,
      file: null,
      paper: {
        number: p.number,
        status: p.status,
        template: p.templateVersion?.template?.title ?? null,
        author: {
          id: p.authorId,
          name: p.author?.name ?? null,
          avatarUrl: p.author?.avatarUrl ?? null,
          color: p.author?.color ?? 'gray',
        },
      },
    }));
    return { items, total };
  }
}

type Rows = { items: Plain<ArchiveItemDto>[]; total: number };

const empty: Rows = { items: [], total: 0 };
