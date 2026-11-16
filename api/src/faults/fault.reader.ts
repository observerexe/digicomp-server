import type { RecordReader } from '../paperwork/adapters';
import { FaultReport } from './fault.entities';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** A fault report for reports about it («Акт несправності»), by the keys of FAULT_SCHEMA. */
export const FAULT_READER: RecordReader = {
  async resolve(id, m) {
    const f = await m.findOneBy(FaultReport, { id });
    if (!f) return null;
    return {
      values: {
        placeId: f.placeId,
        reporterId: f.reporterId,
        description: f.description,
        status: f.status,
        resolution: f.resolution,
        closedById: f.closedById,
        closedAt: iso(f.closedAt),
        createdAt: iso(f.createdAt),
      },
    };
  },
};
