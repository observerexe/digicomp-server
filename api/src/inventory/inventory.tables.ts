import { dayText, valueText } from '../paperwork/content';
import { TABLE_MAX_ROWS, type TableSource } from '../paperwork/tables';
import { InventoryMovement } from './inventory.entities';

/** «−3 шт», «+0,5 кг». */
const amount = (delta: number, unit: string) =>
  `${delta < 0 ? '−' : '+'}${valueText('decimal', Math.abs(delta))} ${unit}`;

/**
 * «Матеріали проєкту»: stock taken for a project (and returned), as the
 * item's movements show it — everyone sees stock. Oldest first.
 */
export const PROJECT_MATERIALS: TableSource = {
  label: 'Матеріали проєкту',
  input: 'ref:project',
  columns: ['Дата', 'Позиція', 'Кількість', 'Хто', 'Для чого'],
  async rows(projectId, _reader, m) {
    const [list, total] = await m.findAndCount(InventoryMovement, {
      where: { projectId },
      relations: { item: true, actor: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: TABLE_MAX_ROWS,
    });
    return {
      rows: list
        .reverse()
        .map((mv) => [
          dayText(mv.createdAt),
          mv.item.title,
          amount(mv.delta, mv.item.unit),
          mv.actor.name,
          mv.note,
        ]),
      more: total - list.length,
    };
  },
};
