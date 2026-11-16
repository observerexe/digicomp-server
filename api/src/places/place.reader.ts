import type { RecordReader } from '../paperwork/adapters';
import { Place } from './place.entity';

/** Equipment for reports about it («Паспорт обладнання»), by the keys of PLACE_SCHEMA. */
export const PLACE_READER: RecordReader = {
  async resolve(id, m) {
    const p = await m.findOneBy(Place, { id });
    if (!p) return null;
    return {
      values: {
        code: p.code,
        title: p.title,
        category: p.category,
        location: p.location,
        description: p.description,
        status: p.status,
        needsAuthorization: p.needsAuthorization,
        exclusive: p.exclusive,
        createdAt: p.createdAt.toISOString(),
      },
    };
  },
};
