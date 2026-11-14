import { CreateUserDto } from '../auth/dto';
import { enumOptions, RecordSchemaDef } from '../records/field-types';
import { UpdateUserDto } from './dto';
import { Role, User } from './user.entity';

export const USER_SCHEMA: RecordSchemaDef = {
  type: 'user',
  label: 'Учасник',
  entity: User,
  dto: { create: CreateUserDto, update: UpdateUserDto, hidden: ['password'] },
  fields: [
    {
      key: 'name',
      label: "Ім'я",
      type: 'text',
      required: true,
      create: true,
      update: true,
      minLength: 1,
      maxLength: 100,
    },
    {
      key: 'email',
      label: 'Ел. пошта',
      type: 'text',
      required: true,
      create: true,
      update: true,
    },
    {
      key: 'role',
      label: 'Роль',
      type: 'enum',
      update: true,
      options: enumOptions<Role>({
        admin: 'Адміністратор',
        moderator: 'Модератор',
        member: 'Учасник',
      }),
    },
    {
      key: 'position',
      label: 'Посада',
      type: 'text',
      create: true,
      update: true,
      maxLength: 100,
    },
    {
      key: 'specialty',
      label: 'Спеціальність',
      type: 'text',
      create: true,
      update: true,
      maxLength: 200,
    },
    {
      key: 'bio',
      label: 'Про себе',
      type: 'text',
      update: true,
      maxLength: 2000,
    },
    { key: 'active', label: 'Активний', type: 'bool', update: true },
    { key: 'createdAt', label: 'У групі з', type: 'datetime' },
  ],
};
