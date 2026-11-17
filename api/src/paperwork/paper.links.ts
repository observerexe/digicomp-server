import type { SelectQueryBuilder } from 'typeorm';
import { Action, can, type Actor } from '../auth/policy';
import { escapeLike } from '../common/like';
import type { LinkableType, LinkedRecord } from '../links/link-registry';
import type { PaperAdapterRegistry } from './adapters';
import { Paper, PaperStatus, PaperVisibility } from './paper.entity';

/**
 * Documents (alias `p`) seen through their record: an SQL condition from
 * the adapters (see PaperAdapter.canView); null — none.
 */
export function seenThroughTarget(
  adapters: PaperAdapterRegistry,
  actor: Actor,
): { sql: string; params: Record<string, unknown> } | null {
  const parts: string[] = [];
  const params: Record<string, unknown> = {};
  for (const [type, adapter] of adapters.entries()) {
    const seen = adapter.canView(actor);
    if (seen === false) continue;
    const name = `target_${type}`;
    params[name] = type;
    if (seen === true) {
      parts.push(`p.target_type = :${name}`);
    } else {
      parts.push(`(p.target_type = :${name} AND (${seen.sql}))`);
      Object.assign(params, seen.params);
    }
  }
  return parts.length ? { sql: parts.join(' OR '), params } : null;
}

/** Lines of the latest snapshot of a document (alias `p`) that name `:me`. */
const myLatestLines = `paper_snapshots s
   CROSS JOIN LATERAL jsonb_array_elements(s.signers) WITH ORDINALITY AS l(line, i)
   WHERE s.paper_id = p.id
     AND s.n = (SELECT MAX(x.n) FROM paper_snapshots x WHERE x.paper_id = p.id)
     AND l.line ->> 'userId' = CAST(:me AS text)`;

/**
 * The reader (`:me`) is named on a line of the document's latest snapshot
 * (paper_snapshots.signers), signed or not: they see the document.
 */
export const namedSignerSql = `EXISTS (SELECT 1 FROM ${myLatestLines})`;

/**
 * The reader (`:me`) is awaited on a line of the document's latest snapshot
 * and has not signed it yet (rows from 0).
 */
export const awaitsMeSql = `EXISTS (SELECT 1 FROM ${myLatestLines}
     AND NOT EXISTS (SELECT 1 FROM paper_signatures g
                      WHERE g.snapshot_id = s.id AND g.row = l.i - 1))`;

/**
 * Only documents the actor sees — the rule of PapersRead in policy.ts:
 * staff — all; others — their own, or published and visible to all, seen
 * through their record, or naming them on a line to sign.
 */
export function whereSeen(
  qb: SelectQueryBuilder<Paper>,
  actor: Actor,
  adapters: PaperAdapterRegistry,
) {
  if (can(actor, Action.PapersReadAll)) return qb;
  const target = seenThroughTarget(adapters, actor);
  return qb.andWhere(
    `(p.authorId = :me OR (p.status <> :draft AND (p.visibility = :members OR ${namedSignerSql}${
      target ? ` OR ${target.sql}` : ''
    })))`,
    {
      me: actor.id,
      draft: PaperStatus.Draft,
      members: PaperVisibility.Members,
      ...target?.params,
    },
  );
}

const linked = (p: Paper): LinkedRecord => ({
  title: p.title,
  archived: p.status === PaperStatus.Cancelled,
});

/**
 * Editor documents. Their own links follow their fields, «@» and the record
 * they created (the document's save and publication write them), so links
 * from a document are not made by hand; others link to it as to any record
 * they see.
 */
export const paperLinks = (adapters: PaperAdapterRegistry): LinkableType => ({
  checkEdit: () => Promise.resolve('FORBIDDEN'),
  async find(ids, actor, m) {
    const rows = await whereSeen(
      m
        .getRepository(Paper)
        .createQueryBuilder('p')
        .select(['p.id', 'p.title', 'p.status'])
        .where('p.id IN (:...ids)', { ids }),
      actor,
      adapters,
    ).getMany();
    return new Map(rows.map((p) => [p.id, linked(p)]));
  },
  async search(q, limit, actor, m) {
    const rows = await whereSeen(
      m
        .getRepository(Paper)
        .createQueryBuilder('p')
        .select(['p.id', 'p.title', 'p.status'])
        .where('p.title ILIKE :q', { q: `%${escapeLike(q)}%` }),
      actor,
      adapters,
    )
      .orderBy('p.title', 'ASC')
      .addOrderBy('p.id', 'ASC')
      .take(limit)
      .getMany();
    return rows.map((p) => ({ id: p.id, ...linked(p) }));
  },
});
