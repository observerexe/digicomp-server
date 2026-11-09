import { permissionsFor } from '../auth/policy';
import { User } from './user.entity';

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
