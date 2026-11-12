import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, unwrap } from '../../api/client';
import type { Role, UserListItem } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { Chips, norm, SearchField } from '../../components/Filters';
import { ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { ROLE_LABEL } from '../../lib/labels';
import s from './panel.module.css';

/** Staff list: everyone, blocked included (GET /users gives staff all of them). */
export const STAFF_USERS_KEY = ['users', 'panel'] as const;
export const fetchStaffUsers = () => unwrap(api.GET('/api/users', { params: { query: { limit: '100' } } }));

const STATE = { active: 'Активні', blocked: 'Заблоковані' } as const;
const ROLE_BY_LABEL = Object.fromEntries(Object.entries(ROLE_LABEL).map(([k, v]) => [v, k])) as Record<string, Role>;

export function filterUsers(items: UserListItem[], search: string, role: Role | null, state: keyof typeof STATE | null) {
  const q = norm(search);
  return items.filter(
    (u) =>
      (!role || u.role === role) &&
      (!state || (state === 'active') === (u.active !== false)) &&
      (!q || [u.name, u.email ?? '', u.position, u.specialty].some((f) => norm(f).includes(q))),
  );
}

/** /panel/users: members and roles, entry to create and manage. */
export function UsersPage() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: STAFF_USERS_KEY, queryFn: fetchStaffUsers });
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<Role | null>(null);
  const [state, setState] = useState<keyof typeof STATE | null>('active');
  const shown = filterUsers(q.data?.items ?? [], search, role, state);

  return (
    <>
      <Link to="/panel" className="btn btn-ghost">
        <Icon name="back" size={20} />
        Панель керування
      </Link>
      <PageHeader title="Учасники й ролі">
        {can('users.create') && (
          <Link to="/panel/users/new" className="btn btn-primary">
            Новий учасник
          </Link>
        )}
      </PageHeader>
      <div className={s.tools}>
        <SearchField value={search} onChange={setSearch} placeholder="Ім’я, email, посада" />
        <Chips label="Роль" values={Object.values(ROLE_LABEL)} value={role ? ROLE_LABEL[role] : null} onChange={(v) => setRole(v ? ROLE_BY_LABEL[v]! : null)} />
        <Chips
          label="Стан"
          values={Object.values(STATE)}
          value={state ? STATE[state] : null}
          onChange={(v) => setState(v === STATE.active ? 'active' : v === STATE.blocked ? 'blocked' : null)}
        />
      </div>
      {q.isPending ? (
        <Skeleton height={240} />
      ) : q.isError ? (
        <ErrorMessage text={errorOf(q.error)} />
      ) : shown.length === 0 ? (
        <p className="hint">Нікого не знайдено. Спробуйте інший запит або приберіть фільтр.</p>
      ) : (
        <ul className={s.rows} aria-label="Учасники">
          {shown.map((u) => (
            <li key={u.id}>
              <Link to={`/panel/users/${u.id}`} className={s.rowLink}>
                <Avatar name={u.name} url={u.avatarUrl} size={40} />
                <span className={s.rowMain}>
                  <span className={s.rowTitle}>
                    {u.name}
                    {u.role !== 'member' && <span className={s.badge}>{ROLE_LABEL[u.role]}</span>}
                    {u.active === false && <span className={`${s.badge} ${s.badgeOff}`}>Заблоковано</span>}
                    {u.twoFactorEnabled && <span className={`${s.badge} ${s.badgeOk}`}>2FA</span>}
                  </span>
                  <span className={s.rowSub}>{[u.email, u.position, u.specialty].filter(Boolean).join(' · ')}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
