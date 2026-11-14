import { ILike, In, Not, type FindOptionsWhere } from 'typeorm';
import { containsLike } from '../common/like';
import { Action, can, check } from '../auth/policy';
import type { LinkableType } from '../links/link-registry';
import { Place, PlaceStatus } from './place.entity';

/** Equipment: archived only for staff; staff edit. */
export const PLACE_LINKS: LinkableType = {
  checkEdit: (actor) => Promise.resolve(check(actor, Action.PlacesManage)),
  async find(ids, actor, m) {
    const staff = can(actor, Action.PlacesManage);
    const rows = await m.findBy(Place, { id: In(ids) });
    return new Map(
      rows
        .filter((p) => staff || p.status !== PlaceStatus.Archived)
        .map((p) => [
          p.id,
          {
            title: p.title,
            archived: p.status === PlaceStatus.Archived,
            code: p.code,
          },
        ]),
    );
  },
  async search(q, limit, actor, m) {
    const like = ILike(containsLike(q));
    const scope: FindOptionsWhere<Place> = can(actor, Action.PlacesManage)
      ? {}
      : { status: Not(PlaceStatus.Archived) };
    const rows = await m.find(Place, {
      where: [
        { ...scope, title: like },
        { ...scope, code: like },
      ],
      order: { title: 'ASC', id: 'ASC' },
      take: limit,
    });
    return rows.map((p) => ({
      id: p.id,
      title: p.title,
      archived: p.status === PlaceStatus.Archived,
      code: p.code,
    }));
  },
};
