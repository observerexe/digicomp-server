import { enumOptions, RecordSchemaDef } from '../records/field-types';
import { DisciplineRecord, DisciplineType } from './discipline.entity';
import { IssueDisciplineDto } from './dto';

export const DISCIPLINE_RECORD_SCHEMA: RecordSchemaDef = {
  type: 'discipline_record',
  label: 'Стягнення',
  entity: DisciplineRecord,
  dto: { create: IssueDisciplineDto },
  fields: [
    {
      key: 'userId',
      label: 'Учасник',
      type: 'ref:user',
      required: true,
      create: true,
    },
    {
      key: 'type',
      label: 'Вид',
      type: 'enum',
      required: true,
      create: true,
      options: enumOptions<DisciplineType>({
        warning: 'Попередження',
        fine: 'Штраф',
        reprimand: 'Догана',
      }),
    },
    {
      key: 'reason',
      label: 'Підстава',
      type: 'text',
      required: true,
      create: true,
      minLength: 1,
      maxLength: 1000,
    },
    // Required for a fine, not allowed otherwise.
    {
      key: 'amount',
      label: 'Розмір штрафу',
      type: 'int',
      nullable: true,
      create: true,
      min: 1,
      max: 1000,
    },
    { key: 'issuedById', label: 'Видав', type: 'ref:user' },
    { key: 'createdAt', label: 'Видано', type: 'datetime' },
    { key: 'revokedAt', label: 'Знято', type: 'datetime', nullable: true },
    { key: 'revokedById', label: 'Зняв', type: 'ref:user', nullable: true },
    {
      key: 'revokeReason',
      label: 'Причина зняття',
      type: 'text',
      nullable: true,
    },
  ],
};
