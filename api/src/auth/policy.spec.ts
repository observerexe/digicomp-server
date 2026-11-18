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

// Матриця з docs/tech/ARCHITECTURE.md, розділ «Ролі та права».
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
  '2FA: своя і скидання чужої': [
    ['member: своя', member, Action.ProfileTwoFactor, undefined, true],
    ['moderator: своя', mod, Action.ProfileTwoFactor, undefined, true],
    ['admin: скинути чужу', admin, Action.UsersResetTwoFactor, undefined, true],
    [
      'moderator: скинути чужу',
      mod,
      Action.UsersResetTwoFactor,
      undefined,
      Deny.Forbidden,
    ],
    [
      'member: скинути чужу',
      member,
      Action.UsersResetTwoFactor,
      undefined,
      Deny.Forbidden,
    ],
  ],
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
  'Змінити колір акаунта іншого': [
    ['admin', admin, Action.UsersEditColor, tMember, true],
    ['admin: модератору', admin, Action.UsersEditColor, tModerator, true],
    ['moderator', mod, Action.UsersEditColor, tMember, Deny.Forbidden],
    ['member', member, Action.UsersEditColor, tMember, Deny.Forbidden],
  ],
  'Змінити свій колір акаунта': [
    ['admin', admin, Action.ProfileEditOwnColor, undefined, true],
    ['moderator', mod, Action.ProfileEditOwnColor, undefined, true],
    ['member', member, Action.ProfileEditOwnColor, undefined, true],
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
  'ТЗ в архів і з архіву': [
    ['admin', admin, Action.TasksArchive, undefined, true],
    ['moderator', mod, Action.TasksArchive, undefined, true],
    ['member', member, Action.TasksArchive, undefined, Deny.Forbidden],
  ],
  'Кошик: бачити й відновлювати': [
    ['admin', admin, Action.TrashManage, undefined, true],
    ['moderator', mod, Action.TrashManage, undefined, true],
    ['member', member, Action.TrashManage, undefined, Deny.Forbidden],
  ],
  'Кошик: видалити назавжди': [
    ['admin', admin, Action.TrashPurge, undefined, true],
    ['moderator', mod, Action.TrashPurge, undefined, Deny.Forbidden],
    ['member', member, Action.TrashPurge, undefined, Deny.Forbidden],
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
  'Довідники: керувати (перегляд — усі)': [
    ['admin: керувати', admin, Action.DictionariesManage, undefined, true],
    ['moderator: керувати', mod, Action.DictionariesManage, undefined, true],
    [
      'member: керувати',
      member,
      Action.DictionariesManage,
      undefined,
      Deny.Forbidden,
    ],
    ['admin: перегляд', admin, Action.DictionariesRead, undefined, true],
    ['moderator: перегляд', mod, Action.DictionariesRead, undefined, true],
    ['member: перегляд', member, Action.DictionariesRead, undefined, true],
  ],
  'Схеми записів (поля типів записів): перегляд': [
    ['admin', admin, Action.RecordsRead, undefined, true],
    ['moderator', mod, Action.RecordsRead, undefined, true],
    ['member', member, Action.RecordsRead, undefined, true],
  ],
  'Налаштування полів (додаткові поля записів): керувати': [
    ['admin', admin, Action.RecordsFieldsManage, undefined, true],
    ['moderator', mod, Action.RecordsFieldsManage, undefined, true],
    ['member', member, Action.RecordsFieldsManage, undefined, Deny.Forbidden],
  ],
  // Далі вирішує правило редагування вихідного запису (його рядок тут)
  // і видимість обох записів — test/links.e2e-spec.ts.
  "Зв'язки між записами: перегляд, зв'язати, прибрати": [
    ['admin: перегляд', admin, Action.LinksRead, undefined, true],
    ['moderator: перегляд', mod, Action.LinksRead, undefined, true],
    ['member: перегляд', member, Action.LinksRead, undefined, true],
    ['admin: зв’язати', admin, Action.LinksManage, undefined, true],
    ['moderator: зв’язати', mod, Action.LinksManage, undefined, true],
    ['member: зв’язати', member, Action.LinksManage, undefined, true],
  ],
  'Реквізити: керувати (перегляд — усі)': [
    ['admin: керувати', admin, Action.OrgManage, undefined, true],
    ['moderator: керувати', mod, Action.OrgManage, undefined, true],
    ['member: керувати', member, Action.OrgManage, undefined, Deny.Forbidden],
    ['admin: перегляд', admin, Action.OrgRead, undefined, true],
    ['moderator: перегляд', mod, Action.OrgRead, undefined, true],
    ['member: перегляд', member, Action.OrgRead, undefined, true],
  ],
  'Документ редактора: створити; змінити й видалити свою чернетку': [
    ['admin: створити', admin, Action.PapersCreate, undefined, true],
    ['moderator: створити', mod, Action.PapersCreate, undefined, true],
    ['member: створити', member, Action.PapersCreate, undefined, true],
    ['admin: свою', admin, Action.PapersEdit, { ownerId: admin.id }, true],
    ['admin: чужу', admin, Action.PapersEdit, { ownerId: 'u2' }, true],
    ['moderator: свою', mod, Action.PapersEdit, { ownerId: mod.id }, true],
    [
      'moderator: чужу',
      mod,
      Action.PapersEdit,
      { ownerId: 'u2' },
      Deny.NotOwner,
    ],
    ['member: свою', member, Action.PapersEdit, { ownerId: member.id }, true],
    [
      'member: чужу',
      member,
      Action.PapersEdit,
      { ownerId: 'u2' },
      Deny.NotOwner,
    ],
  ],
  'Документ редактора: бачити': [
    ['admin: чужу чернетку', admin, Action.PapersRead, { ownerId: 'u2' }, true],
    [
      'moderator: чужу чернетку',
      mod,
      Action.PapersRead,
      { ownerId: 'u2' },
      true,
    ],
    ['admin: усі', admin, Action.PapersReadAll, undefined, true],
    ['moderator: усі', mod, Action.PapersReadAll, undefined, true],
    ['member: усі', member, Action.PapersReadAll, undefined, Deny.Forbidden],
    ['member: свій', member, Action.PapersRead, { ownerId: member.id }, true],
    [
      'member: чужий, видимий для всіх',
      member,
      Action.PapersRead,
      { ownerId: 'u2', shared: true },
      true,
    ],
    [
      'member: чужий',
      member,
      Action.PapersRead,
      { ownerId: 'u2', shared: false },
      Deny.NotOwner,
    ],
  ],
  'Документ редактора: зробити видимим для всіх': [
    ['admin', admin, Action.PapersVisibility, undefined, true],
    ['moderator', mod, Action.PapersVisibility, undefined, true],
    ['member', member, Action.PapersVisibility, undefined, Deny.Forbidden],
  ],
  // Решту полів заповнює автор своєї чернетки (papers.edit) — test/papers.e2e-spec.ts.
  'Документ редактора: заповнити поле «заповнює модератор»': [
    ['admin', admin, Action.PapersFillStaff, undefined, true],
    ['moderator', mod, Action.PapersFillStaff, undefined, true],
    ['member', member, Action.PapersFillStaff, undefined, Deny.Forbidden],
  ],
  // Документ, що створює запис, потребує ще права на сам запис (адаптер) —
  // test/paper-publish.e2e-spec.ts.
  'Документ редактора: опублікувати': [
    ['admin: чужий', admin, Action.PapersPublish, { ownerId: 'u2' }, true],
    ['moderator: чужий', mod, Action.PapersPublish, { ownerId: 'u2' }, true],
    [
      'member: свій',
      member,
      Action.PapersPublish,
      { ownerId: member.id },
      true,
    ],
    [
      'member: чужий',
      member,
      Action.PapersPublish,
      { ownerId: 'u2' },
      Deny.NotOwner,
    ],
  ],
  // Скасувати документ, що створив запис, — за правилом зняття запису
  // (адаптер): ТЗ — лише модератор і адмін — test/paper-publish.e2e-spec.ts.
  'Документ редактора: скасувати опублікований': [
    ['admin: чужий', admin, Action.PapersCancel, { ownerId: 'u2' }, true],
    ['moderator: чужий', mod, Action.PapersCancel, { ownerId: 'u2' }, true],
    ['member: свій', member, Action.PapersCancel, { ownerId: member.id }, true],
    [
      'member: чужий',
      member,
      Action.PapersCancel,
      { ownerId: 'u2' },
      Deny.NotOwner,
    ],
  ],
  // Поле, прив'язане до запису, — як зміна самого запису (адаптер):
  // ТЗ — лише модератор і адмін — test/paper-change.e2e-spec.ts.
  'Документ редактора: змінити поле «можна змінити» опублікованого': [
    ['admin: чужий', admin, Action.PapersChange, { ownerId: 'u2' }, true],
    ['moderator: чужий', mod, Action.PapersChange, { ownerId: 'u2' }, true],
    ['member: свій', member, Action.PapersChange, { ownerId: member.id }, true],
    [
      'member: чужий',
      member,
      Action.PapersChange,
      { ownerId: 'u2' },
      Deny.NotOwner,
    ],
  ],
  // Учасник — лише свій вільний: для документа, що створює запис, сервіс
  // не передає автора — test/paper-freeze.e2e-spec.ts.
  'Документ редактора: зафіксувати': [
    ['admin: чужий', admin, Action.PapersFreeze, { ownerId: 'u2' }, true],
    ['moderator: чужий', mod, Action.PapersFreeze, { ownerId: 'u2' }, true],
    ['moderator: що створює запис', mod, Action.PapersFreeze, {}, true],
    [
      'member: свій вільний',
      member,
      Action.PapersFreeze,
      { ownerId: member.id },
      true,
    ],
    [
      'member: чужий',
      member,
      Action.PapersFreeze,
      { ownerId: 'u2' },
      Deny.NotOwner,
    ],
    [
      'member: що створює запис',
      member,
      Action.PapersFreeze,
      {},
      Deny.NotOwner,
    ],
  ],
  // Як фіксація: учасник — лише свій вільний; стан документа перевіряє
  // сервіс — test/paper-sign.e2e-spec.ts.
  'Документ редактора: завантажити підписаний скан': [
    ['admin: чужий', admin, Action.PapersSign, { ownerId: 'u2' }, true],
    ['moderator: чужий', mod, Action.PapersSign, { ownerId: 'u2' }, true],
    ['moderator: що створює запис', mod, Action.PapersSign, {}, true],
    [
      'member: свій вільний',
      member,
      Action.PapersSign,
      { ownerId: member.id },
      true,
    ],
    [
      'member: чужий',
      member,
      Action.PapersSign,
      { ownerId: 'u2' },
      Deny.NotOwner,
    ],
    ['member: що створює запис', member, Action.PapersSign, {}, Deny.NotOwner],
  ],
  // Лише та людина, яку чекає рядок останнього знімка; за іншого не підписує
  // ніхто, і адмін теж. Стан документа й рядки — test/paper-signatures.e2e-spec.ts.
  'Документ редактора: підписати графічно': [
    [
      'admin: свій рядок',
      admin,
      Action.PapersSignDrawn,
      { signer: true },
      true,
    ],
    [
      'moderator: свій рядок',
      mod,
      Action.PapersSignDrawn,
      { signer: true },
      true,
    ],
    [
      'member: свій рядок',
      member,
      Action.PapersSignDrawn,
      { signer: true },
      true,
    ],
    [
      'admin: не його',
      admin,
      Action.PapersSignDrawn,
      { signer: false },
      Deny.NotSigner,
    ],
    ['moderator: не його', mod, Action.PapersSignDrawn, {}, Deny.NotSigner],
    [
      'member: не його',
      member,
      Action.PapersSignDrawn,
      { signer: false },
      Deny.NotSigner,
    ],
  ],
  // Хто бачить документ чи шаблон із зображенням (`shared`) — з бази,
  // test/paper-images.e2e-spec.ts.
  'Зображення в документі: завантажити й бачити': [
    ['admin: завантажити', admin, Action.PaperImagesUpload, undefined, true],
    ['moderator: завантажити', mod, Action.PaperImagesUpload, undefined, true],
    ['member: завантажити', member, Action.PaperImagesUpload, undefined, true],
    [
      'member: своє',
      member,
      Action.PaperImagesRead,
      { ownerId: member.id },
      true,
    ],
    [
      'member: з документа, який бачить',
      member,
      Action.PaperImagesRead,
      { ownerId: 'u2', shared: true },
      true,
    ],
    [
      'member: чуже, ніде не бачить',
      member,
      Action.PaperImagesRead,
      { ownerId: 'u2', shared: false },
      Deny.NotOwner,
    ],
    [
      'moderator: чуже, ніде не бачить',
      mod,
      Action.PaperImagesRead,
      { ownerId: 'u2' },
      Deny.NotOwner,
    ],
    [
      'admin: з документа',
      admin,
      Action.PaperImagesRead,
      { ownerId: 'u2', shared: true },
      true,
    ],
  ],
  // Учасник бачить лише опубліковані шаблони, відкриті для всіх, —
  // test/paper-templates.e2e-spec.ts.
  'Шаблон документа: створити, змінити, опублікувати версію (перегляд — усі)': [
    ['admin: керувати', admin, Action.PaperTemplatesManage, undefined, true],
    ['moderator: керувати', mod, Action.PaperTemplatesManage, undefined, true],
    [
      'member: керувати',
      member,
      Action.PaperTemplatesManage,
      undefined,
      Deny.Forbidden,
    ],
    ['admin: перегляд', admin, Action.PaperTemplatesRead, undefined, true],
    ['moderator: перегляд', mod, Action.PaperTemplatesRead, undefined, true],
    ['member: перегляд', member, Action.PaperTemplatesRead, undefined, true],
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
    [
      'member: бронює з допуском',
      member,
      Action.BookingsCreate,
      { authorized: true },
      true,
    ],
    [
      'member: без допуску',
      member,
      Action.BookingsCreate,
      { authorized: false },
      Deny.NotAuthorizedForPlace,
    ],
    [
      'moderator: без допуску',
      mod,
      Action.BookingsCreate,
      { authorized: false },
      true,
    ],
    [
      'member: скасувати своє',
      member,
      Action.BookingsCancel,
      { ownerId: member.id },
      true,
    ],
    [
      'member: скасувати чуже (через cancel)',
      member,
      Action.BookingsCancel,
      { ownerId: 'u2' },
      Deny.NotOwner,
    ],
    [
      'moderator: скасувати чуже',
      mod,
      Action.BookingsCancel,
      { ownerId: 'u2' },
      true,
    ],
  ],
  'Звіт про несправність': [
    ['admin: закрити', admin, Action.FaultsClose, undefined, true],
    ['moderator: закрити', mod, Action.FaultsClose, undefined, true],
    ['member: закрити', member, Action.FaultsClose, undefined, Deny.Forbidden],
    ['member: створити', member, Action.FaultsCreate, undefined, true],
    ['member: переглянути', member, Action.FaultsRead, undefined, true],
    [
      'member: фото до свого звіту',
      member,
      Action.FaultsAttach,
      { ownerId: member.id },
      true,
    ],
    [
      'member: фото до чужого',
      member,
      Action.FaultsAttach,
      { ownerId: 'u2' },
      Deny.NotOwner,
    ],
    [
      'moderator: фото до чужого',
      mod,
      Action.FaultsAttach,
      { ownerId: 'u2' },
      true,
    ],
  ],
  'Вивантаження журналу': [
    ['admin', admin, Action.SessionsExport, undefined, true],
    ['moderator', mod, Action.SessionsExport, undefined, true],
    ['member', member, Action.SessionsExport, undefined, Deny.Forbidden],
  ],
  'Почати сеанс у чужий заброньований слот': [
    ['admin', admin, Action.SessionsIgnoreBooking, undefined, true],
    ['moderator', mod, Action.SessionsIgnoreBooking, undefined, Deny.Forbidden],
    ['member', member, Action.SessionsIgnoreBooking, undefined, Deny.Forbidden],
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
  'Бункер: грати, свої карти й паки': [
    ['admin', admin, Action.BunkerPlay, undefined, true],
    ['moderator', mod, Action.BunkerPlay, undefined, true],
    ['member', member, Action.BunkerPlay, undefined, true],
  ],
  'Бункер: змінити чи видалити чужі карту, пак; закрити чужу кімнату': [
    ['admin: модератора', admin, Action.BunkerModerate, tModerator, true],
    ['admin: адміна', admin, Action.BunkerModerate, tAdmin, true],
    ['moderator: учасника', mod, Action.BunkerModerate, tMember, true],
    ['moderator: автора вже немає', mod, Action.BunkerModerate, {}, true],
    [
      'moderator: модератора',
      mod,
      Action.BunkerModerate,
      tModerator,
      Deny.TargetRole,
    ],
    ['moderator: адміна', mod, Action.BunkerModerate, tAdmin, Deny.TargetRole],
    ['member', member, Action.BunkerModerate, tMember, Deny.Forbidden],
  ],
};

describe('Матриця прав (docs/tech/ARCHITECTURE.md)', () => {
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
