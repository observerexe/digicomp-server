import { enumOptions, RecordSchemaDef } from '../records/field-types';
import { AwardPointsDto } from './dto';
import { PointsEntry, PointsKind } from './points-entry.entity';

/** A ledger entry; created by hand only as a manual award. */
export const POINTS_ENTRY_SCHEMA: RecordSchemaDef = {
  type: 'points_entry',
  label: 'Нарахування балів',
  entity: PointsEntry,
  dto: { create: AwardPointsDto },
  fields: [
    {
      key: 'userId',
      label: 'Учасник',
      type: 'ref:user',
      required: true,
      create: true,
    },
    {
      key: 'amount',
      label: 'Бали',
      type: 'int',
      required: true,
      create: true,
      min: 1,
      max: 1000,
    },
    {
      key: 'reason',
      label: 'За що',
      type: 'text',
      required: true,
      create: true,
      minLength: 1,
      maxLength: 500,
    },
    {
      key: 'kind',
      label: 'Вид',
      type: 'enum',
      options: enumOptions<PointsKind>({
        task: 'За ТЗ',
        manual: 'Нарахування',
        fine: 'Штраф',
        reversal: 'Скасування нарахування',
      }),
    },
    { key: 'taskId', label: 'ТЗ', type: 'ref:task', nullable: true },
    {
      key: 'createdById',
      label: 'Нарахував',
      type: 'ref:user',
      nullable: true,
    },
    {
      key: 'reversesId',
      label: 'Скасовує',
      type: 'ref:points_entry',
      nullable: true,
    },
    { key: 'createdAt', label: 'Дата', type: 'datetime' },
  ],
};
