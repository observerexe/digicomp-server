import type { TableSource } from '../paperwork/tables';
import type { PointsService } from './points.service';

const MONTHS = [
  'Січень',
  'Лютий',
  'Березень',
  'Квітень',
  'Травень',
  'Червень',
  'Липень',
  'Серпень',
  'Вересень',
  'Жовтень',
  'Листопад',
  'Грудень',
];

/** «Рейтинг за місяць»: the ranking (as on «Рейтинг», everyone sees it) for the month of a day. */
export function pointsMonthTable(points: PointsService): TableSource {
  return {
    label: 'Рейтинг за місяць',
    input: 'date',
    columns: ['Місце', 'Учасник', 'Бали'],
    async rows(day, _reader, m) {
      const [y, mo] = day.split('-').map(Number);
      const list = await points.ranking(day, m);
      return {
        caption: `${MONTHS[mo - 1]} ${y}`,
        rows: list.map((r) => [String(r.rank), r.name, String(r.total)]),
      };
    },
  };
}
