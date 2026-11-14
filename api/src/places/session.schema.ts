import { RecordSchemaDef } from '../records/field-types';
import { WorkSession } from './work-session.entity';

/** Read only: sessions are started and ended on the equipment page. */
export const SESSION_SCHEMA: RecordSchemaDef = {
  type: 'session',
  label: 'Сеанс роботи',
  entity: WorkSession,
  fields: [
    { key: 'userId', label: 'Учасник', type: 'ref:user' },
    { key: 'placeId', label: 'Обладнання', type: 'ref:place' },
    { key: 'startedAt', label: 'Початок', type: 'datetime' },
    { key: 'endedAt', label: 'Кінець', type: 'datetime', nullable: true },
    { key: 'endedById', label: 'Завершив', type: 'ref:user', nullable: true },
    { key: 'safetyConfirmed', label: 'Безпеку підтверджено', type: 'bool' },
    { key: 'note', label: 'Примітка', type: 'text' },
    { key: 'equipmentState', label: 'Стан обладнання', type: 'text' },
    { key: 'endReason', label: 'Причина завершення', type: 'text' },
    { key: 'autoClosed', label: 'Закрито автоматично', type: 'bool' },
  ],
};
