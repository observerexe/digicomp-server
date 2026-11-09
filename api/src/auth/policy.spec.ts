import { ForbiddenException } from '@nestjs/common';
import { Role } from '../users/user.entity';
import {
  Action,
  Actor,
  assertCan,
  check,
  Deny,
  DenyCode,
  PolicyContext,
  permissionsFor,
  ROLES,
} from './policy';

// Матриця з docs/PLAN.md, розділ «Ролі та права».
// Кожен рядок таблиці — окремий describe; у кожному три ролі: можна / не можна.

const admin: Actor = { id: 'a1', role: Role.Admin };
const mod: Actor = { id: 'm1', role: Role.Moderator };
const member: Actor = { id: 'u1', role: Role.Member };

const tMember = { target: { id: 'u2', role: Role.Member } };
const tModerator = { target: { id: 'm2', role: Role.Moderator } };
const tAdmin = { target: { id: 'a2', role: Role.Admin } };
const self = (a: Actor) => ({ target: { id: a.id, role: a.role } });

type Case = [
  label: string,
  actor: Actor,
  action: Action,
  ctx: PolicyContext | undefined,
  expected: true | DenyCode,
];

const ROWS: Record<string, Case[]> = {
  'Розширена панель': [
    ['admin', admin, Action.AdminPanel, undefined, true],
    ['moderator', mod, Action.AdminPanel, undefined, Deny.Forbidden],
    ['member', member, Action.AdminPanel, undefined, Deny.Forbidden],
  ],
  'Журнал усіх дій (аудит)': [
    ['admin', admin, Action.AuditRead, undefined, true],
    ['moderator', mod, Action.AuditRead, undefined, Deny.Forbidden],
    ['member', member, Action.AuditRead, undefined, Deny.Forbidden],
  ],
  'Видати або передати адмінку': [
    ['admin', admin, Action.UsersGrantAdmin, tMember, true],
    ['moderator', mod, Action.UsersGrantAdmin, tMember, Deny.Forbidden],
    ['member', member, Action.UsersGrantAdmin, tMember, Deny.Forbidden],
  ],
  'Скинути пароль іншому': [
    ['admin', admin, Action.UsersResetPassword, tMember, true],
    ['moderator', mod, Action.UsersResetPassword, tMember, Deny.Forbidden],
    ['member', member, Action.UsersResetPassword, tMember, Deny.Forbidden],
  ],
  "Змінити ім'я іншого": [
    ['admin', admin, Action.UsersEditName, tMember, true],
    ['moderator', mod, Action.UsersEditName, tMember, Deny.Forbidden],
    ['member', member, Action.UsersEditName, tMember, Deny.Forbidden],
  ],
  'Видалити недоречний аватар чи біо іншого': [
    ['admin', admin, Action.UsersModerateContent, tMember, true],
    ['moderator', mod, Action.UsersModerateContent, tMember, Deny.Forbidden],
    ['member', member, Action.UsersModerateContent, tMember, Deny.Forbidden],
  ],
  'Понизити чи заблокувати модератора': [
    ['admin: понизити', admin, Action.UsersManageModerator, tModerator, true],
    ['admin: заблокувати', admin, Action.UsersBlock, tModerator, true],
    [
      'moderator: понизити',
      mod,
      Action.UsersManageModerator,
      tModerator,
      Deny.Forbidden,
    ],
    [
      'moderator: заблокувати',
      mod,
      Action.UsersBlock,
      tModerator,
      Deny.TargetRole,
    ],
    ['member', member, Action.UsersManageModerator, tModerator, Deny.Forbidden],
  ],
  'Створити учасника з паролем': [
    ['admin', admin, Action.UsersCreate, undefined, true],
    ['moderator', mod, Action.UsersCreate, undefined, true],
    ['member', member, Action.UsersCreate, undefined, Deny.Forbidden],
  ],
  'Заблокувати (вигнати) учасника': [
    ['admin', admin, Action.UsersBlock, tMember, true],
    ['moderator: member', mod, Action.UsersBlock, tMember, true],
    ['moderator: admin', mod, Action.UsersBlock, tAdmin, Deny.TargetRole],
    ['moderator: себе', mod, Action.UsersBlock, self(mod), Deny.Self],
    ['member', member, Action.UsersBlock, tMember, Deny.Forbidden],
  ],
  'Підвищити member до moderator': [
    ['admin', admin, Action.UsersPromote, tMember, true],
    ['moderator', mod, Action.UsersPromote, tMember, true],
    ['member', member, Action.UsersPromote, tMember, Deny.Forbidden],
  ],
  'Змінити спеціальність і посаду іншого': [
    ['admin: member', admin, Action.UsersEditRoleInfo, tMember, true],
    ['admin: moderator', admin, Action.UsersEditRoleInfo, tModerator, true],
    ['moderator: member', mod, Action.UsersEditRoleInfo, tMember, true],
    [
      'moderator: moderator',
      mod,
      Action.UsersEditRoleInfo,
      tModerator,
      Deny.TargetRole,
    ],
    [
      'moderator: admin',
      mod,
      Action.UsersEditRoleInfo,
      tAdmin,
      Deny.TargetRole,
    ],
    ['member', member, Action.UsersEditRoleInfo, tMember, Deny.Forbidden],
  ],
  'Змінити своє біо й аватар': [
    ['admin: біо', admin, Action.ProfileEditOwnBio, undefined, true],
    ['moderator: біо', mod, Action.ProfileEditOwnBio, undefined, true],
    ['member: біо', member, Action.ProfileEditOwnBio, undefined, true],
    ['admin: аватар', admin, Action.ProfileEditOwnAvatar, undefined, true],
    ['moderator: аватар', mod, Action.ProfileEditOwnAvatar, undefined, true],
    ['member: аватар', member, Action.ProfileEditOwnAvatar, undefined, true],
    // member змінює в себе лише біо й аватар
    [
      'member: своє ім’я',
      member,
      Action.ProfileEditOwnName,
      undefined,
      Deny.Forbidden,
    ],
    [
      'member: свою посаду',
      member,
      Action.ProfileEditOwnRoleInfo,
      undefined,
      Deny.Forbidden,
    ],
    [
      'moderator: свою посаду',
      mod,
      Action.ProfileEditOwnRoleInfo,
      undefined,
      true,
    ],
    [
      'moderator: своє ім’я',
      mod,
      Action.ProfileEditOwnName,
      undefined,
      Deny.Forbidden,
    ],
    ['admin: своє ім’я', admin, Action.ProfileEditOwnName, undefined, true],
  ],
  'Бали, штрафи, догани, попередження': [
    ['admin: собі', admin, Action.PointsAward, self(admin), true],
    ['moderator: member', mod, Action.PointsAward, tMember, true],
    ['moderator: moderator', mod, Action.PointsAward, tModerator, true],
    ['moderator: собі', mod, Action.PointsAward, self(mod), Deny.Self],
    ['moderator: догана', mod, Action.DisciplineIssue, tModerator, true],
    [
      'moderator: догана собі',
      mod,
      Action.DisciplineIssue,
      self(mod),
      Deny.Self,
    ],
    ['member', member, Action.PointsAward, tMember, Deny.Forbidden],
    ['member: догана', member, Action.DisciplineIssue, tMember, Deny.Forbidden],
    [
      'admin: таблиця дисципліни',
      admin,
      Action.DisciplineReadAll,
      undefined,
      true,
    ],
    [
      'moderator: таблиця дисципліни',
      mod,
      Action.DisciplineReadAll,
      undefined,
      true,
    ],
    [
      'member: таблиця дисципліни',
      member,
      Action.DisciplineReadAll,
      undefined,
      Deny.Forbidden,
    ],
    ['member: свої записи', member, Action.DisciplineReadOwn, undefined, true],
    ['moderator: чужі бали', mod, Action.PointsReadAll, undefined, true],
    [
      'member: чужі бали',
      member,
      Action.PointsReadAll,
      undefined,
      Deny.Forbidden,
    ],
  ],
  'Зняти такий запис': [
    ['admin: чужий', admin, Action.DisciplineRevoke, { ownerId: 'm2' }, true],
    [
      'moderator: свій',
      mod,
      Action.DisciplineRevoke,
      { ownerId: mod.id },
      true,
    ],
    [
      'moderator: чужий',
      mod,
      Action.DisciplineRevoke,
      { ownerId: 'm2' },
      Deny.NotOwner,
    ],
    [
      'member',
      member,
      Action.DisciplineRevoke,
      { ownerId: member.id },
      Deny.Forbidden,
    ],
  ],
  'Зняти такий запис: нарахування балів': [
    ['admin: чужий', admin, Action.PointsRevoke, { ownerId: 'm2' }, true],
    [
      'admin: старий без автора',
      admin,
      Action.PointsRevoke,
      { ownerId: null },
      true,
    ],
    ['moderator: свій', mod, Action.PointsRevoke, { ownerId: mod.id }, true],
    [
      'moderator: чужий',
      mod,
      Action.PointsRevoke,
      { ownerId: 'm2' },
      Deny.NotOwner,
    ],
    [
      'moderator: старий без автора',
      mod,
      Action.PointsRevoke,
      { ownerId: null },
      Deny.NotOwner,
    ],
    [
      'member',
      member,
      Action.PointsRevoke,
      { ownerId: member.id },
      Deny.Forbidden,
    ],
  ],
  'Створити ТЗ, проєкт': [
    ['admin: ТЗ', admin, Action.TasksCreate, undefined, true],
    ['moderator: ТЗ', mod, Action.TasksCreate, undefined, true],
    ['member: ТЗ', member, Action.TasksCreate, undefined, Deny.Forbidden],
    ['admin: проєкт', admin, Action.ProjectsCreate, undefined, true],
    ['moderator: проєкт', mod, Action.ProjectsCreate, undefined, true],
    [
      'member: проєкт',
      member,
      Action.ProjectsCreate,
      undefined,
      Deny.Forbidden,
    ],
  ],
  "Взяти ТЗ і здати на рев'ю": [
    ['admin', admin, Action.TasksTake, undefined, true],
    ['moderator', mod, Action.TasksTake, undefined, true],
    ['member', member, Action.TasksTake, undefined, true],
    [
      'member: здати своє',
      member,
      Action.TasksWork,
      { participant: true },
      true,
    ],
    [
      'member: здати чуже',
      member,
      Action.TasksWork,
      { participant: false },
      Deny.NotParticipant,
    ],
    [
      'admin: здати чуже',
      admin,
      Action.TasksWork,
      { participant: false },
      Deny.NotParticipant,
    ],
    ['member: коментар', member, Action.TasksComment, undefined, true],
    [
      'member: файл у своє ТЗ',
      member,
      Action.TasksAttach,
      { participant: true },
      true,
    ],
    [
      'member: файл у чуже ТЗ',
      member,
      Action.TasksAttach,
      { participant: false },
      Deny.NotParticipant,
    ],
    [
      'moderator: файл у будь-яке',
      mod,
      Action.TasksAttach,
      { participant: false },
      true,
    ],
  ],
  'Керувати ТЗ (редагувати, видалити)': [
    ['admin', admin, Action.TasksManage, undefined, true],
    ['moderator', mod, Action.TasksManage, undefined, true],
    ['member', member, Action.TasksManage, undefined, Deny.Forbidden],
  ],
  'Прийняти ТЗ (нарахування балів)': [
    ['admin: своє', admin, Action.TasksAccept, { participant: true }, true],
    ['moderator: чуже', mod, Action.TasksAccept, { participant: false }, true],
    [
      'moderator: своє',
      mod,
      Action.TasksAccept,
      { participant: true },
      Deny.Self,
    ],
    [
      'member',
      member,
      Action.TasksAccept,
      { participant: false },
      Deny.Forbidden,
    ],
  ],
  'Оновити етап і прогрес проєкту': [
    ['admin', admin, Action.ProjectsUpdate, { participant: false }, true],
    ['moderator', mod, Action.ProjectsUpdate, { participant: false }, true],
    [
      'member: учасник',
      member,
      Action.ProjectsUpdate,
      { participant: true },
      true,
    ],
    [
      'member: не учасник',
      member,
      Action.ProjectsUpdate,
      { participant: false },
      Deny.NotParticipant,
    ],
  ],
  'Документи, обладнання, довідник складу': [
    ['admin: документи', admin, Action.DocumentsManage, undefined, true],
    ['moderator: документи', mod, Action.DocumentsManage, undefined, true],
    [
      'member: документи',
      member,
      Action.DocumentsManage,
      undefined,
      Deny.Forbidden,
    ],
    [
      'member: перегляд документів',
      member,
      Action.DocumentsRead,
      undefined,
      true,
    ],
    ['admin: обладнання', admin, Action.PlacesManage, undefined, true],
    ['moderator: обладнання', mod, Action.PlacesManage, undefined, true],
    [
      'member: обладнання',
      member,
      Action.PlacesManage,
      undefined,
      Deny.Forbidden,
    ],
    ['member: перегляд обладнання', member, Action.PlacesRead, undefined, true],
    ['admin: склад', admin, Action.InventoryManage, undefined, true],
    ['moderator: склад', mod, Action.InventoryManage, undefined, true],
    [
      'member: склад',
      member,
      Action.InventoryManage,
      undefined,
      Deny.Forbidden,
    ],
    ['member: перегляд складу', member, Action.InventoryRead, undefined, true],
  ],
  'Видати допуск до обладнання': [
    ['admin', admin, Action.PlacesAuthorize, undefined, true],
    ['moderator', mod, Action.PlacesAuthorize, undefined, true],
    ['member', member, Action.PlacesAuthorize, undefined, Deny.Forbidden],
  ],
  'Склад: взяти або поповнити': [
    ['admin: взяти', admin, Action.InventoryTake, undefined, true],
    ['moderator: взяти', mod, Action.InventoryTake, undefined, true],
    ['member: взяти', member, Action.InventoryTake, undefined, true],
    ['admin: поповнити', admin, Action.InventoryRestock, undefined, true],
    ['moderator: поповнити', mod, Action.InventoryRestock, undefined, true],
    ['member: поповнити', member, Action.InventoryRestock, undefined, true],
  ],
  'Сеанс роботи з обладнанням': [
    ['admin', admin, Action.SessionsStart, { authorized: false }, true],
    ['moderator', mod, Action.SessionsStart, { authorized: false }, true],
    [
      'member: з допуском',
      member,
      Action.SessionsStart,
      { authorized: true },
      true,
    ],
    [
      'member: без допуску',
      member,
      Action.SessionsStart,
      { authorized: false },
      Deny.NotAuthorizedForPlace,
    ],
  ],
  'Завершити чужий сеанс': [
    ['admin', admin, Action.SessionsEndOther, undefined, true],
    ['moderator', mod, Action.SessionsEndOther, undefined, true],
    ['member', member, Action.SessionsEndOther, undefined, Deny.Forbidden],
  ],
  Бронювання: [
    [
      'admin: скасувати будь-яке',
      admin,
      Action.BookingsCancelAny,
      undefined,
      true,
    ],
    [
      'moderator: скасувати будь-яке',
      mod,
      Action.BookingsCancelAny,
      undefined,
      true,
    ],
    [
      'member: скасувати чуже',
      member,
      Action.BookingsCancelAny,
      undefined,
      Deny.Forbidden,
    ],
    ['member: своє', member, Action.BookingsCreate, undefined, true],
  ],
  'Звіт про несправність': [
    ['admin: закрити', admin, Action.FaultsClose, undefined, true],
    ['moderator: закрити', mod, Action.FaultsClose, undefined, true],
    ['member: закрити', member, Action.FaultsClose, undefined, Deny.Forbidden],
    ['member: створити', member, Action.FaultsCreate, undefined, true],
  ],
  'Розумні пристрої: керувати / список дозволених': [
    ['admin: керувати', admin, Action.SmartControl, undefined, true],
    ['moderator: керувати', mod, Action.SmartControl, undefined, true],
    [
      'member: керувати',
      member,
      Action.SmartControl,
      undefined,
      Deny.Forbidden,
    ],
    ['member: перегляд', member, Action.SmartRead, undefined, true],
    ['admin: список', admin, Action.SmartAllowlist, undefined, true],
    [
      'moderator: список',
      mod,
      Action.SmartAllowlist,
      undefined,
      Deny.Forbidden,
    ],
    [
      'member: список',
      member,
      Action.SmartAllowlist,
      undefined,
      Deny.Forbidden,
    ],
  ],
};

describe('Матриця прав (docs/PLAN.md)', () => {
  for (const [row, cases] of Object.entries(ROWS)) {
    describe(row, () => {
      it.each(cases)('%s', (_label, actor, action, ctx, expected) => {
        expect(check(actor, action, ctx)).toBe(expected);
      });
    });
  }

  it('у кожної дії є правило для ролей', () => {
    for (const action of Object.values(Action)) {
      expect(ROLES[action]).toBeDefined();
    }
  });

  it('невідома роль (колишній guest) не має жодних прав', () => {
    const guest = { id: 'g1', role: 'guest' };
    expect(permissionsFor('guest')).toEqual([]);
    for (const action of Object.values(Action)) {
      expect(check(guest, action)).toBe(Deny.Forbidden);
    }
  });

  it('assertCan кидає 403 зі стабільним errorCode', () => {
    expect.assertions(2);
    try {
      assertCan(mod, Action.UsersBlock, tAdmin);
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
      expect((e as ForbiddenException).getResponse()).toMatchObject({
        errorCode: Deny.TargetRole,
      });
    }
  });

  it('permissionsFor віддає фронту дії за роллю', () => {
    expect(permissionsFor(Role.Member)).toContain(Action.ProfileEditOwnBio);
    expect(permissionsFor(Role.Member)).not.toContain(Action.UsersCreate);
    expect(permissionsFor(Role.Moderator)).toContain(Action.UsersCreate);
    expect(permissionsFor(Role.Moderator)).not.toContain(Action.AuditRead);
    expect(permissionsFor(Role.Admin)).toEqual(Object.values(Action));
  });
});
