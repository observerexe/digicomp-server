import type { Me, Role } from '../../api/types';

type Target = { id: string; role: Role };

/**
 * What the panel offers over one member (docs/tech/ARCHITECTURE.md, «Ролі та права»).
 * Role-layer permissions come from /auth/me; the target rule mirrors the API:
 * a moderator acts only on members and never on self, the admin has no limits.
 * The API checks everything again — this only hides buttons that would fail.
 */
export function userRights(me: Me, t: Target) {
  const has = (p: string) => me.permissions.includes(p);
  const self = me.id === t.id;
  const admin = me.role === 'admin';
  const overMember = admin || (t.role === 'member' && !self);
  return {
    self,
    name: has('users.edit_name'),
    email: has('users.edit_email'),
    bio: has('users.moderate_content'),
    avatar: has('users.moderate_content'),
    roleInfo: has('users.edit_role_info') && overMember,
    // Self-block and own role change are hidden even for the admin: one wrong
    // tap would lock the account; another admin does it if really needed.
    block: has('users.block') && overMember && !self,
    roles: roleOptions(me, t),
    resetPassword: has('users.reset_password') && !self,
    resetTwoFactor: has('users.reset_two_factor') && !self,
  };
}

/** Roles the actor may set; empty — the role is shown read-only. */
export function roleOptions(me: Me, t: Target): Role[] {
  if (me.id === t.id) return [];
  if (me.role === 'admin') return ['member', 'moderator', 'admin'];
  if (t.role === 'member' && me.permissions.includes('users.promote')) return ['member', 'moderator'];
  return [];
}
