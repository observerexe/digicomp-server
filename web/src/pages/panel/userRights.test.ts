import { describe, expect, it } from 'vitest';
import type { Me } from '../../api/types';
import { member, moderator } from '../../test/render';
import { roleOptions, userRights } from './userRights';

const STAFF = ['users.manage', 'users.read_extended', 'users.create', 'users.block', 'users.promote', 'users.edit_role_info'];
const ADMIN = ['users.grant_admin', 'users.reset_password', 'users.reset_two_factor', 'users.edit_name', 'users.edit_email', 'users.moderate_content', 'users.manage_moderator'];
const mod: Me = { ...moderator, permissions: [...moderator.permissions, ...STAFF] };
const admin: Me = { ...mod, id: 'a1', role: 'admin', permissions: [...mod.permissions, ...ADMIN] };
const otherMod = { id: 'm2', role: 'moderator' as const };
const otherAdmin = { id: 'a2', role: 'admin' as const };

describe('userRights — матриця прав панелі', () => {
  it('модератор над member: посада, блокування, підвищення; без імені, біо, пароля, 2FA', () => {
    const r = userRights(mod, member);
    expect(r).toMatchObject({ roleInfo: true, block: true, name: false, email: false, bio: false, avatar: false, resetPassword: false, resetTwoFactor: false });
    expect(r.roles).toEqual(['member', 'moderator']);
  });

  it('модератор над модератором і адміном: нічого', () => {
    for (const t of [otherMod, otherAdmin]) {
      const r = userRights(mod, t);
      expect(r).toMatchObject({ roleInfo: false, block: false });
      expect(r.roles).toEqual([]);
    }
  });

  it('модератор над собою: нічого', () => {
    expect(userRights(mod, mod)).toMatchObject({ self: true, roleInfo: false, block: false, roles: [] });
  });

  it('адмін без обмежень над будь-ким, крім блокування й ролі себе', () => {
    for (const t of [member, otherMod, otherAdmin]) {
      const r = userRights(admin, t);
      expect(r).toMatchObject({ roleInfo: true, block: true, name: true, email: true, bio: true, resetPassword: true, resetTwoFactor: true });
      expect(r.roles).toEqual(['member', 'moderator', 'admin']);
    }
    expect(userRights(admin, admin)).toMatchObject({ block: false, roles: [], resetPassword: false });
  });

  it('учасник без прав нічого не отримує', () => {
    expect(roleOptions(member, { id: 'x', role: 'member' })).toEqual([]);
    expect(userRights(member, { id: 'x', role: 'member' })).toMatchObject({ block: false, roleInfo: false });
  });
});
