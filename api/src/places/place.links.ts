import { In } from 'typeorm';
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
          { title: p.title, archived: p.status === PlaceStatus.Archived },
        ]),
    );
  },
};
