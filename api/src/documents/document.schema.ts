import { enumOptions, RecordSchemaDef } from '../records/field-types';
import { AccessScope, Doc, DOCUMENT_CATEGORY } from './doc.entity';

/** Read only for documents: archive files are managed in the Archive. */
export const DOCUMENT_SCHEMA: RecordSchemaDef = {
  type: 'document',
  label: 'Документ архіву',
  entity: Doc,
  fields: [
    { key: 'title', label: 'Назва', type: 'text' },
    {
      key: 'category',
      label: 'Категорія',
      type: 'enum',
      dictionary: DOCUMENT_CATEGORY,
    },
    { key: 'description', label: 'Опис', type: 'text' },
    {
      key: 'accessScope',
      label: 'Доступ',
      type: 'enum',
      options: enumOptions<AccessScope>({
        members: 'Усі учасники',
        supervisors: 'Лише модератори',
      }),
    },
    { key: 'authorId', label: 'Додав', type: 'ref:user' },
    { key: 'createdAt', label: 'Додано', type: 'datetime' },
    { key: 'updatedAt', label: 'Змінено', type: 'datetime' },
    {
      key: 'archivedAt',
      label: 'В архіві з',
      type: 'datetime',
      nullable: true,
    },
  ],
};
