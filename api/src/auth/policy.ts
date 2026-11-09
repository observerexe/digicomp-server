import { ForbiddenException } from '@nestjs/common';
import { Role } from '../users/user.entity';

/**
 * Single source of truth for permissions: the matrix from docs/PLAN.md
 * ("Ролі та права"). Every check in controllers (via @Can) and services
 * (via can/assertCan) goes through this file.
 *
 * Two layers:
 *  - ROLES: which roles may attempt the action at all (used by PolicyGuard);
 *  - REFINE: extra rules that depend on context (target user, ownership...).
 */

export type Actor = { id: string; role: string };

/** Context for refined checks. Only the fields relevant to the action. */
export type PolicyContext = {
  /** Target user of an action over another user. */
  target?: { id: string; role: string };
  /** Who created the record (discipline entry, booking...). */
  ownerId?: string | null;
  /** Actor is an assignee of the task / participant of the project. */
  participant?: boolean;
  /** Actor has a valid authorization for the place (or none is needed). */
  authorized?: boolean;
};

export enum Action {
  // Extended panel and audit
  AdminPanel = 'admin.panel',
  AuditRead = 'audit.read',
  ApiDocs = 'api.docs',

  // Users and roles
  UsersRead = 'users.read',
  UsersManage = 'users.manage',
  UsersReadExtended = 'users.read_extended',
  UsersGrantAdmin = 'users.grant_admin',
  UsersResetPassword = 'users.reset_password',
  UsersEditName = 'users.edit_name',
  UsersEditEmail = 'users.edit_email',
  UsersModerateContent = 'users.moderate_content',
  UsersManageModerator = 'users.manage_moderator',
  UsersCreate = 'users.create',
  UsersBlock = 'users.block',
  UsersPromote = 'users.promote',
  UsersEditRoleInfo = 'users.edit_role_info',

  // Own profile
  ProfileEditOwnBio = 'profile.edit_own_bio',
  ProfileEditOwnAvatar = 'profile.edit_own_avatar',
  ProfileEditOwnRoleInfo = 'profile.edit_own_role_info',
  ProfileEditOwnName = 'profile.edit_own_name',
  ProfileChangePassword = 'profile.change_password',

  // Points and discipline
  PointsRead = 'points.read',
  PointsAward = 'points.award',
  PointsRevoke = 'points.revoke',
  PointsReadAll = 'points.read_all',
  DisciplineReadOwn = 'discipline.read_own',
  DisciplineReadAll = 'discipline.read_all',
  DisciplineIssue = 'discipline.issue',
  DisciplineRevoke = 'discipline.revoke',

  // Tasks and projects
  TasksRead = 'tasks.read',
  TasksCreate = 'tasks.create',
  TasksManage = 'tasks.manage',
  TasksTake = 'tasks.take',
  TasksWork = 'tasks.work',
  TasksAccept = 'tasks.accept',
  TasksComment = 'tasks.comment',
  TasksAttach = 'tasks.attach',
  ProjectsRead = 'projects.read',
  ProjectsCreate = 'projects.create',
  ProjectsManage = 'projects.manage',
  ProjectsUpdate = 'projects.update',

  // Documents, equipment, inventory catalog
  DocumentsRead = 'documents.read',
  DocumentsManage = 'documents.manage',
  PlacesRead = 'places.read',
  PlacesManage = 'places.manage',
  PlacesAuthorize = 'places.authorize',
  InventoryRead = 'inventory.read',
  InventoryManage = 'inventory.manage',
  InventoryTake = 'inventory.take',
  InventoryRestock = 'inventory.restock',

  // Work sessions, bookings, faults
  SessionsStart = 'sessions.start',
  SessionsReadAll = 'sessions.read_all',
  SessionsEndOther = 'sessions.end_other',
  BookingsCreate = 'bookings.create',
  BookingsCancelAny = 'bookings.cancel_any',
  FaultsCreate = 'faults.create',
  FaultsClose = 'faults.close',

  // Smart lab
  SmartRead = 'smart.read',
  SmartControl = 'smart.control',
  SmartAllowlist = 'smart.allowlist',
}

const A = Role.Admin;
const M = Role.Moderator;
const U = Role.Member;
const ALL = [A, M, U];
const STAFF = [A, M];
const ADMIN = [A];

/** Layer 1: which roles may attempt the action. */
export const ROLES: Record<Action, readonly Role[]> = {
  [Action.AdminPanel]: ADMIN,
  [Action.AuditRead]: ADMIN,
  [Action.ApiDocs]: ADMIN,

  [Action.UsersRead]: ALL,
  [Action.UsersManage]: STAFF,
  [Action.UsersReadExtended]: STAFF,
  [Action.UsersGrantAdmin]: ADMIN,
  [Action.UsersResetPassword]: ADMIN,
  [Action.UsersEditName]: ADMIN,
  [Action.UsersEditEmail]: ADMIN,
  [Action.UsersModerateContent]: ADMIN,
  [Action.UsersManageModerator]: ADMIN,
  [Action.UsersCreate]: STAFF,
  [Action.UsersBlock]: STAFF,
  [Action.UsersPromote]: STAFF,
  [Action.UsersEditRoleInfo]: STAFF,

  [Action.ProfileEditOwnBio]: ALL,
  [Action.ProfileEditOwnAvatar]: ALL,
  [Action.ProfileEditOwnRoleInfo]: STAFF,
  [Action.ProfileEditOwnName]: ADMIN,
  [Action.ProfileChangePassword]: ALL,

  [Action.PointsRead]: ALL,
  [Action.PointsAward]: STAFF,
  [Action.PointsRevoke]: STAFF,
  [Action.PointsReadAll]: STAFF,
  [Action.DisciplineReadOwn]: ALL,
  [Action.DisciplineReadAll]: STAFF,
  [Action.DisciplineIssue]: STAFF,
  [Action.DisciplineRevoke]: STAFF,

  [Action.TasksRead]: ALL,
  [Action.TasksCreate]: STAFF,
  [Action.TasksManage]: STAFF,
  [Action.TasksTake]: ALL,
  [Action.TasksWork]: ALL,
  [Action.TasksAccept]: STAFF,
  [Action.TasksComment]: ALL,
  [Action.TasksAttach]: ALL,
  [Action.ProjectsRead]: ALL,
  [Action.ProjectsCreate]: STAFF,
  [Action.ProjectsManage]: STAFF,
  [Action.ProjectsUpdate]: ALL,

  [Action.DocumentsRead]: ALL,
  [Action.DocumentsManage]: STAFF,
  [Action.PlacesRead]: ALL,
  [Action.PlacesManage]: STAFF,
  [Action.PlacesAuthorize]: STAFF,
  [Action.InventoryRead]: ALL,
  [Action.InventoryManage]: STAFF,
  [Action.InventoryTake]: ALL,
  [Action.InventoryRestock]: ALL,

  [Action.SessionsStart]: ALL,
  [Action.SessionsReadAll]: STAFF,
  [Action.SessionsEndOther]: STAFF,
  [Action.BookingsCreate]: ALL,
  [Action.BookingsCancelAny]: STAFF,
  [Action.FaultsCreate]: ALL,
  [Action.FaultsClose]: STAFF,

  [Action.SmartRead]: ALL,
  [Action.SmartControl]: STAFF,
  [Action.SmartAllowlist]: ADMIN,
};

/** Error codes returned when a refined rule denies the action. */
export const Deny = {
  Forbidden: 'FORBIDDEN',
  TargetRole: 'TARGET_ROLE_FORBIDDEN',
  Self: 'SELF_ACTION_FORBIDDEN',
  NotOwner: 'NOT_OWNER',
  NotParticipant: 'NOT_PARTICIPANT',
  NotAuthorizedForPlace: 'NOT_AUTHORIZED_FOR_PLACE',
} as const;
export type DenyCode = (typeof Deny)[keyof typeof Deny];

type Refine = (actor: Actor, ctx: PolicyContext) => true | DenyCode;

/** Moderator acts only on members, never on self, moderators or admins. */
const moderatorOverMember: Refine = (actor, { target }) => {
  if (actor.role === A) return true;
  if (!target) return Deny.Forbidden;
  if (target.id === actor.id) return Deny.Self;
  return target.role === U ? true : Deny.TargetRole;
};

/** Points and discipline: a moderator may target anyone except themselves. */
const notSelfForModerator: Refine = (actor, { target }) => {
  if (actor.role === A) return true;
  if (!target) return Deny.Forbidden;
  return target.id === actor.id ? Deny.Self : true;
};

/** Revoking a record: admin any, moderator only the one they issued. */
const ownRecordForModerator: Refine = (actor, { ownerId }) =>
  actor.role === A || (ownerId != null && ownerId === actor.id)
    ? true
    : Deny.NotOwner;

/** Layer 2: context rules. Missing entry = no extra rule. */
const REFINE: Partial<Record<Action, Refine>> = {
  [Action.UsersBlock]: moderatorOverMember,
  [Action.UsersPromote]: moderatorOverMember,
  [Action.UsersEditRoleInfo]: moderatorOverMember,

  [Action.PointsAward]: notSelfForModerator,
  [Action.DisciplineIssue]: notSelfForModerator,
  [Action.DisciplineRevoke]: ownRecordForModerator,
  [Action.PointsRevoke]: ownRecordForModerator,

  [Action.TasksAccept]: (actor, { participant }) =>
    actor.role === A || !participant ? true : Deny.Self,
  // Start, leave, submit for review: only the task's assignees.
  [Action.TasksWork]: (_actor, { participant }) =>
    participant ? true : Deny.NotParticipant,
  // Files: assignees and staff.
  [Action.TasksAttach]: (actor, { participant }) =>
    actor.role !== U || participant ? true : Deny.NotParticipant,
  [Action.ProjectsUpdate]: (actor, { participant }) =>
    actor.role !== U || participant ? true : Deny.NotParticipant,

  [Action.SessionsStart]: (actor, { authorized }) =>
    actor.role !== U || authorized ? true : Deny.NotAuthorizedForPlace,
};

export function roleAllowed(role: string, action: Action): boolean {
  return (ROLES[action] as readonly string[]).includes(role);
}

/** Full check: role layer and, if ctx is given, context rules. */
export function check(
  actor: Actor,
  action: Action,
  ctx?: PolicyContext,
): true | DenyCode {
  if (!roleAllowed(actor.role, action)) return Deny.Forbidden;
  const refine = REFINE[action];
  if (!refine) return true;
  return refine(actor, ctx ?? {});
}

export function can(actor: Actor, action: Action, ctx?: PolicyContext) {
  return check(actor, action, ctx) === true;
}

export function assertCan(actor: Actor, action: Action, ctx?: PolicyContext) {
  const res = check(actor, action, ctx);
  if (res !== true) {
    throw new ForbiddenException({
      message: `Forbidden: ${action}`,
      errorCode: res,
    });
  }
}

/**
 * Actions the role may attempt (role layer only). Sent to the front to show
 * or hide controls; context rules are still enforced by the API.
 */
export function permissionsFor(role: string): string[] {
  return Object.values(Action).filter((a) => roleAllowed(role, a));
}
