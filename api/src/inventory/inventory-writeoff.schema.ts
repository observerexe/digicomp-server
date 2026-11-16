import { RecordSchemaDef } from '../records/field-types';
import { WriteOffDto } from './dto';
import { InventoryMovement } from './inventory.entities';

/**
 * «Списання зі складу»: a row of «Акт списання». Kept as a movement of the
 * item with a negative delta that refers to the act; made only by it.
 */
export const INVENTORY_WRITEOFF_SCHEMA: RecordSchemaDef = {
  type: 'inventory_writeoff',
  label: 'Списання зі складу',
  entity: InventoryMovement,
  dto: { create: WriteOffDto },
  fields: [
    {
      key: 'itemId',
      label: 'Позиція',
      type: 'ref:inventory_item',
      required: true,
      create: true,
    },
    // The movement's delta, as a positive amount.
    {
      key: 'quantity',
      label: 'Кількість',
      type: 'decimal',
      source: 'computed',
      required: true,
      create: true,
      min: 0.001,
      max: 1000000,
      scale: 3,
    },
    {
      key: 'note',
      label: 'Причина',
      type: 'text',
      required: true,
      create: true,
      minLength: 1,
      maxLength: 500,
    },
    {
      key: 'quantityAfter',
      label: 'Залишок після',
      type: 'decimal',
      scale: 3,
    },
    { key: 'actorId', label: 'Списав', type: 'ref:user' },
    { key: 'createdAt', label: 'Списано', type: 'datetime' },
  ],
};
