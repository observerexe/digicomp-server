import { Action, can } from '../auth/policy';
import { dayText, valueText } from '../paperwork/content';
import { TABLE_MAX_ROWS, type TableSource } from '../paperwork/tables';
import { PlaceAuthorization } from './place-authorization.entity';
import { durationMinutes, formatDuration, remark } from './session-log';
import { WorkSession } from './work-session.entity';

const moment = (d: Date) => valueText('datetime', d.toISOString());

/**
 * «Допуски» of equipment, as the list of authorizations shows them: staff —
 * everyone's, a member — their own. Oldest first.
 */
export const PLACE_AUTHORIZATIONS: TableSource = {
  label: 'Допуски',
  input: 'ref:place',
  columns: ['Учасник', 'Видано', 'Діє до', 'Примітка'],
  async rows(placeId, reader, m) {
    const qb = m
      .getRepository(PlaceAuthorization)
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.user', 'u')
      .where('a.placeId = :placeId', { placeId })
      .orderBy('a.grantedAt', 'DESC')
      .addOrderBy('a.id', 'DESC')
      .take(TABLE_MAX_ROWS);
    if (!can(reader, Action.PlacesAuthorize)) {
      qb.andWhere('a.userId = :uid', { uid: reader.id });
    }
    const [list, total] = await qb.getManyAndCount();
    const now = Date.now();
    return {
      rows: list
        .reverse()
        .map((a) => [
          a.user.name,
          dayText(a.grantedAt),
          a.expiresAt
            ? `${dayText(a.expiresAt)}${a.expiresAt.getTime() <= now ? ' (минув)' : ''}`
            : 'безстроково',
          a.note,
        ]),
      more: total - list.length,
    };
  },
};

/**
 * «Журнал сеансів» of equipment, as the journal shows it: staff — everyone's,
 * a member — their own. Oldest first.
 */
export const PLACE_SESSIONS: TableSource = {
  label: 'Журнал сеансів',
  input: 'ref:place',
  columns: ['Учасник', 'Початок', 'Кінець', 'Тривалість', 'Примітка'],
  async rows(placeId, reader, m) {
    const qb = m
      .getRepository(WorkSession)
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.user', 'u')
      .where('s.placeId = :placeId', { placeId })
      .orderBy('s.startedAt', 'DESC')
      .addOrderBy('s.id', 'DESC')
      .take(TABLE_MAX_ROWS);
    if (!can(reader, Action.SessionsReadAll)) {
      qb.andWhere('s.userId = :uid', { uid: reader.id });
    }
    const [list, total] = await qb.getManyAndCount();
    const enders = new Map<string, string>();
    const ids = [...new Set(list.map((s) => s.endedById))].filter(
      (id): id is string => id !== null,
    );
    if (ids.length) {
      const users = await m.query<{ id: string; name: string }[]>(
        'SELECT "id", "name" FROM "users" WHERE "id" = ANY($1)',
        [ids],
      );
      for (const u of users) enders.set(u.id, u.name);
    }
    return {
      rows: list.reverse().map((s) => [
        s.user.name,
        moment(s.startedAt),
        s.endedAt ? moment(s.endedAt) : '',
        formatDuration(durationMinutes(s)),
        remark({
          placeTitle: '',
          placeCode: '',
          userName: s.user.name,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          endedByName: s.endedById ? (enders.get(s.endedById) ?? null) : null,
          endedByOther: !!s.endedById && s.endedById !== s.userId,
          endReason: s.endReason,
          autoClosed: s.autoClosed,
        }),
      ]),
      more: total - list.length,
    };
  },
};
