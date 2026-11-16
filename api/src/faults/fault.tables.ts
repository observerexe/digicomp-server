import { dayText } from '../paperwork/content';
import { TABLE_MAX_ROWS, type TableSource } from '../paperwork/tables';
import { FaultReport, FaultStatus } from './fault.entities';

const STATUS: Record<FaultStatus, string> = {
  [FaultStatus.Open]: 'Відкрито',
  [FaultStatus.InProgress]: 'В роботі',
  [FaultStatus.Closed]: 'Закрито',
};

/** «Несправності» of equipment: everyone sees them (as on its page). Oldest first. */
export const PLACE_FAULTS: TableSource = {
  label: 'Несправності',
  input: 'ref:place',
  columns: ['Дата', 'Опис', 'Стан', 'Що зроблено', 'Закрито'],
  async rows(placeId, _reader, m) {
    const [list, total] = await m.findAndCount(FaultReport, {
      where: { placeId },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: TABLE_MAX_ROWS,
    });
    return {
      rows: list
        .reverse()
        .map((f) => [
          dayText(f.createdAt),
          f.description,
          STATUS[f.status],
          f.resolution,
          f.closedAt ? dayText(f.closedAt) : '',
        ]),
      more: total - list.length,
    };
  },
};
