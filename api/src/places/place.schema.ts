import { enumOptions, RecordSchemaDef } from '../records/field-types';
import { CreatePlaceDto, UpdatePlaceDto } from './dto';
import { Place, PLACE_CATEGORY, PlaceStatus } from './place.entity';

export const PLACE_SCHEMA: RecordSchemaDef = {
  type: 'place',
  label: 'Обладнання',
  entity: Place,
  dto: { create: CreatePlaceDto, update: UpdatePlaceDto },
  fields: [
    {
      key: 'code',
      label: 'Код',
      type: 'text',
      required: true,
      create: true,
      pattern: '^[A-Za-z0-9_-]{3,60}$',
    },
    {
      key: 'title',
      label: 'Назва',
      type: 'text',
      required: true,
      create: true,
      update: true,
      minLength: 1,
      maxLength: 200,
    },
    {
      key: 'category',
      label: 'Категорія',
      type: 'enum',
      dictionary: PLACE_CATEGORY,
      required: true,
      create: true,
      update: true,
    },
    {
      key: 'location',
      label: 'Розташування',
      type: 'text',
      create: true,
      update: true,
      maxLength: 200,
    },
    {
      key: 'description',
      label: 'Опис',
      type: 'text',
      create: true,
      update: true,
      maxLength: 5000,
    },
    {
      key: 'status',
      label: 'Стан',
      type: 'enum',
      update: true,
      options: enumOptions<PlaceStatus>({
        active: 'Працює',
        maintenance: 'На обслуговуванні',
        archived: 'В архіві',
      }),
    },
    {
      key: 'needsAuthorization',
      label: 'Потрібен допуск',
      type: 'bool',
      create: true,
      update: true,
    },
    {
      key: 'exclusive',
      label: 'Лише один сеанс одночасно',
      type: 'bool',
      create: true,
      update: true,
    },
    { key: 'createdAt', label: 'Додано', type: 'datetime' },
  ],
};
