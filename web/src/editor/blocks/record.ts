import type { IconName } from '../../components/Icon';
import type { FieldBlock } from '.';

/**
 * A record of the app (a picker in the document): one block per record type
 * the picker finds. The type is the record's key only — the editor does not
 * know what the record is.
 */
function recordBlock(type: string, label: string, icon: IconName, prefix: string, many = false): FieldBlock {
  return {
    key: many ? `${type}s` : type,
    group: 'data',
    kind: 'field',
    label,
    icon,
    type: many ? `list<ref:${type}>` : `ref:${type}`,
    prefix,
    hint: 'Запис застосунку, який людина вибирає зі списку',
    variants: [
      { type: `ref:${type}`, label: 'Один' },
      { type: `list<ref:${type}>`, label: 'Кілька' },
    ],
  };
}

export const RECORD_BLOCKS: FieldBlock[] = [
  recordBlock('user', 'Учасник', 'user', 'member'),
  recordBlock('user', 'Кілька учасників', 'users', 'members', true),
  recordBlock('place', 'Обладнання', 'lab', 'place'),
  recordBlock('inventory_item', 'Позиція складу', 'box', 'item'),
  recordBlock('project', 'Проєкт', 'folder', 'project'),
  recordBlock('task', 'ТЗ', 'board', 'task'),
];
