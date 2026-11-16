import { In } from 'typeorm';
import { Action, check } from '../auth/policy';
import { containsLike } from '../common/like';
import type { LinkableType, LinkedRecord } from '../links/link-registry';
import { dayText } from '../paperwork/content';
import { FaultReport, FaultStatus } from './fault.entities';

/**
 * «Несправність: Лазерний гравер, 16.11.2026»; closed — archived. It opens
 * on its equipment's page: the code is the equipment's.
 */
function linked(f: FaultReport): LinkedRecord {
  return {
    title: `Несправність: ${f.place.title}, ${dayText(f.createdAt)}`,
    archived: f.status === FaultStatus.Closed,
    code: f.place.code,
  };
}

/** Fault reports: everyone sees them (as on the equipment page); staff close them, so staff link them. */
export const FAULT_LINKS: LinkableType = {
  checkEdit: (actor) => Promise.resolve(check(actor, Action.FaultsClose)),
  async find(ids, _actor, m) {
    const rows = await m.find(FaultReport, {
      where: { id: In(ids) },
      relations: { place: true },
    });
    return new Map(rows.map((f) => [f.id, linked(f)]));
  },
  async search(q, limit, _actor, m) {
    const like = containsLike(q);
    const rows = await m
      .getRepository(FaultReport)
      .createQueryBuilder('f')
      .innerJoinAndSelect('f.place', 'p')
      .where(
        '(f.description ILIKE :like OR p.title ILIKE :like OR p.code ILIKE :like)',
        { like },
      )
      .orderBy('p.title', 'ASC')
      .addOrderBy('f.createdAt', 'DESC')
      .addOrderBy('f.id', 'ASC')
      .take(limit)
      .getMany();
    return rows.map((f) => ({ id: f.id, ...linked(f) }));
  },
};
