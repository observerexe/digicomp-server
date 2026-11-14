import { RecordSchemaDef } from '../records/field-types';
import { GrantAuthorizationDto } from './dto';
import { PlaceAuthorization } from './place-authorization.entity';

export const PLACE_AUTHORIZATION_SCHEMA: RecordSchemaDef = {
  type: 'place_authorization',
  label: 'Допуск до обладнання',
  entity: PlaceAuthorization,
  dto: { create: GrantAuthorizationDto },
  fields: [
    {
      key: 'userId',
      label: 'Учасник',
      type: 'ref:user',
      required: true,
      create: true,
    },
    {
      key: 'placeId',
      label: 'Обладнання',
      type: 'ref:place',
      required: true,
      create: true,
    },
    {
      key: 'expiresAt',
      label: 'Діє до',
      type: 'datetime',
      nullable: true,
      create: true,
    },
    {
      key: 'note',
      label: 'Примітка',
      type: 'text',
      create: true,
      maxLength: 500,
    },
    { key: 'grantedById', label: 'Видав', type: 'ref:user' },
    { key: 'grantedAt', label: 'Видано', type: 'datetime' },
  ],
};
