import type { EntityManager } from 'typeorm';
import { Action, can, type Actor } from '../auth/policy';
import { escapeLike } from '../common/like';
import type { LinkableType, LinkedRecord } from '../links/link-registry';
import { dayText } from '../paperwork/content';
import { User } from '../users/user.entity';
import { DisciplineRecord, DisciplineType } from './discipline.entity';

const KIND: Record<DisciplineType, string> = {
  [DisciplineType.Warning]: 'Попередження',
  [DisciplineType.Fine]: 'Штраф',
  [DisciplineType.Reprimand]: 'Догана',
};

/** «Штраф −5 · Дмитро Бондар · 12.11.2026»; a revoked one — as archived. */
function linked(r: DisciplineRecord, name: string | null): LinkedRecord {
  const kind =
    r.type === DisciplineType.Fine
      ? `${KIND[r.type]} −${r.amount}`
      : KIND[r.type];
  return {
    title: [kind, name, dayText(r.createdAt)].filter(Boolean).join(' · '),
    archived: r.revokedAt !== null,
  };
}

/** Records the actor sees, with the member's name: staff — all, a member — their own. */
function seen(m: EntityManager, actor: Actor) {
  const qb = m
    .getRepository(DisciplineRecord)
    .createQueryBuilder('r')
    .leftJoin(User, 'u', 'u.id = r.user_id')
    .addSelect('u.name', 'user_name');
  if (!can(actor, Action.DisciplineReadAll)) {
    qb.andWhere('r.user_id = :me', { me: actor.id });
  }
  return qb;
}

async function rows(qb: ReturnType<typeof seen>) {
  const { entities, raw } = await qb.getRawAndEntities<{
    r_id: string;
    user_name: string | null;
  }>();
  const names = new Map(raw.map((x) => [x.r_id, x.user_name]));
  return entities.map((r) => ({ r, name: names.get(r.id) ?? null }));
}

/**
 * Discipline records: referred to from documents («Пояснювальна записка»).
 * Seen as on /discipline — staff all, a member only their own; links to
 * them come only from documents.
 */
export const DISCIPLINE_LINKS: LinkableType = {
  checkEdit: () => Promise.resolve('FORBIDDEN'),
  async find(ids, actor, m) {
    const found = await rows(
      seen(m, actor).andWhere('r.id IN (:...ids)', { ids }),
    );
    return new Map(found.map(({ r, name }) => [r.id, linked(r, name)]));
  },
  async search(q, limit, actor, m) {
    const qb = seen(m, actor);
    if (q) {
      qb.andWhere('(r.reason ILIKE :q OR u.name ILIKE :q)', {
        q: `%${escapeLike(q)}%`,
      });
    }
    const found = await rows(
      qb.orderBy('r.created_at', 'DESC').addOrderBy('r.id', 'ASC').take(limit),
    );
    return found.map(({ r, name }) => ({ id: r.id, ...linked(r, name) }));
  },
};
