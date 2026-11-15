import type { SelectQueryBuilder } from 'typeorm';
import { Action, can, type Actor } from '../auth/policy';
import { escapeLike } from '../common/like';
import type { LinkableType, LinkedRecord } from '../links/link-registry';
import { Paper, PaperStatus, PaperVisibility } from './paper.entity';

/**
 * Only documents the actor sees — the rule of PapersRead in policy.ts:
 * staff — all; others — their own, or published for all.
 */
export function whereSeen(qb: SelectQueryBuilder<Paper>, actor: Actor) {
  if (can(actor, Action.PapersReadAll)) return qb;
  return qb.andWhere(
    '(p.authorId = :me OR (p.status <> :draft AND p.visibility = :members))',
    {
      me: actor.id,
      draft: PaperStatus.Draft,
      members: PaperVisibility.Members,
    },
  );
}

const linked = (p: Paper): LinkedRecord => ({
  title: p.title,
  archived: p.status === PaperStatus.Cancelled,
});

/**
 * Editor documents. Their own links follow their fields and «@» (the
 * document's save writes them), so links from a document are not made by
 * hand; others link to it as to any record they see.
 */
export const PAPER_LINKS: LinkableType = {
  checkEdit: () => Promise.resolve('FORBIDDEN'),
  async find(ids, actor, m) {
    const rows = await whereSeen(
      m
        .getRepository(Paper)
        .createQueryBuilder('p')
        .select(['p.id', 'p.title', 'p.status'])
        .where('p.id IN (:...ids)', { ids }),
      actor,
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
    )
      .orderBy('p.title', 'ASC')
      .addOrderBy('p.id', 'ASC')
      .take(limit)
      .getMany();
    return rows.map((p) => ({ id: p.id, ...linked(p) }));
  },
};
