import { enumOptions, RecordSchemaDef } from '../records/field-types';
import { Paper, PaperStatus, PaperVisibility } from './paper.entity';

/** Read only: documents are written in the editor, not through bindings. */
export const PAPER_SCHEMA: RecordSchemaDef = {
  type: 'paper',
  label: 'Документ редактора',
  entity: Paper,
  fields: [
    { key: 'title', label: 'Назва', type: 'text' },
    {
      key: 'status',
      label: 'Стан',
      type: 'enum',
      options: enumOptions<PaperStatus>({
        draft: 'Чернетка',
        published: 'Опубліковано',
        frozen: 'Зафіксовано',
        signed: 'Підписано',
        cancelled: 'Скасовано',
      }),
    },
    {
      key: 'visibility',
      label: 'Видимість',
      type: 'enum',
      options: enumOptions<PaperVisibility>({
        author: 'Автор і модератори',
        members: 'Усі учасники',
      }),
    },
    { key: 'authorId', label: 'Автор', type: 'ref:user' },
    { key: 'createdAt', label: 'Створено', type: 'datetime' },
    { key: 'updatedAt', label: 'Змінено', type: 'datetime' },
  ],
};
