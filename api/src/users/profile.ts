import { Role, User } from './user.entity';

const MEMBER_PERMISSIONS = [
  'users.read',
  'tasks.read',
  'tasks.update_own_status',
  'points.read',
];

export function permissionsFor(role: Role): string[] {
  switch (role) {
    case Role.Admin:
      return [
        ...MEMBER_PERMISSIONS,
        'users.read_extended',
        'users.manage',
        'tasks.create',
        'tasks.confirm',
        'audit.read',
      ];
    case Role.Coordinator:
      return [...MEMBER_PERMISSIONS, 'users.read_extended'];
    case Role.Member:
      return MEMBER_PERMISSIONS;
    default:
      return [];
  }
}

export function toProfile(u: User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    position: u.position,
    specialty: u.specialty,
    bio: u.bio,
    avatarUrl: u.avatarUrl,
    active: u.active,
    permissions: permissionsFor(u.role),
  };
}

export function toExtendedView(u: User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    position: u.position,
    specialty: u.specialty,
    bio: u.bio,
    avatarUrl: u.avatarUrl,
    active: u.active,
    createdAt: u.createdAt,
  };
}

export function toBasicView(u: User) {
  return {
    id: u.id,
    name: u.name,
    role: u.role,
    position: u.position,
    specialty: u.specialty,
    avatarUrl: u.avatarUrl,
  };
}
