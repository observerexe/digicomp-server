import { enumOptions, RecordSchemaDef } from '../records/field-types';
import { FaultReport, FaultStatus } from './fault.entities';

/** Read only for documents: reports are filed and closed on the equipment page. */
export const FAULT_SCHEMA: RecordSchemaDef = {
  type: 'fault',
  label: 'Несправність',
  entity: FaultReport,
  fields: [
    { key: 'placeId', label: 'Обладнання', type: 'ref:place' },
    { key: 'reporterId', label: 'Повідомив', type: 'ref:user' },
    { key: 'description', label: 'Опис', type: 'text' },
    {
      key: 'status',
      label: 'Стан',
      type: 'enum',
      options: enumOptions<FaultStatus>({
        open: 'Відкрито',
        in_progress: 'В роботі',
        closed: 'Закрито',
      }),
    },
    { key: 'resolution', label: 'Що зроблено', type: 'text' },
    { key: 'closedById', label: 'Закрив', type: 'ref:user', nullable: true },
    { key: 'closedAt', label: 'Закрито', type: 'datetime', nullable: true },
    { key: 'createdAt', label: 'Повідомлено', type: 'datetime' },
  ],
};
