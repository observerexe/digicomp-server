import { permissionsFor } from '../auth/policy';
import type { Plain } from '../common/responses.dto';
import type { MeDto, UserExtendedDto, UserPublicDto } from './responses.dto';
import { User } from './user.entity';

export function toProfile(u: User): Plain<MeDto> {
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
    twoFactorEnabled: !!u.totpEnabledAt,
    permissions: permissionsFor(u.role),
  };
}

export function toExtendedView(u: User): Plain<UserExtendedDto> {
  return {
    ...toBasicView(u),
    email: u.email,
    active: u.active,
    twoFactorEnabled: !!u.totpEnabledAt,
    createdAt: u.createdAt,
  };
}

/** Public card (docs/tech/ARCHITECTURE.md, «Команда» and «Чужий профіль»). */
export function toBasicView(u: User): Plain<UserPublicDto> {
  return {
    id: u.id,
    name: u.name,
    role: u.role,
    position: u.position,
    specialty: u.specialty,
    bio: u.bio,
    avatarUrl: u.avatarUrl,
  };
}
