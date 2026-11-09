import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api, unwrap } from '../../api/client';
import type { UserListItem } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { Avatar } from '../../components/Avatar';
import { Chips, distinct, norm, SearchField } from '../../components/Filters';
import { ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { ROLE_LABEL } from '../../lib/labels';
import s from './team.module.css';

/** The group is small: one request, search and filter on the device (instant). */
export const TEAM_KEY = ['users', 'team'] as const;
const fetchTeam = () => unwrap(api.GET('/api/users', { params: { query: { limit: '100' } } }));

export function matches(u: UserListItem, search: string, specialty: string | null) {
  if (specialty && u.specialty !== specialty) return false;
  const q = norm(search);
  if (!q) return true;
  return [u.name, u.position, u.specialty].some((f) => norm(f).includes(q));
}

export function TeamPage() {
  const { user } = useAuth();
  const team = useQuery({ queryKey: TEAM_KEY, queryFn: fetchTeam });
  const [search, setSearch] = useState('');
  const [specialty, setSpecialty] = useState<string | null>(null);

  const items = team.data?.items ?? [];
  const specialties = useMemo(() => distinct(items.map((u) => u.specialty)), [items]);
  const shown = items.filter((u) => matches(u, search, specialty));

  return (
    <>
      <PageHeader title="Команда" />
      <div className={s.tools}>
        <SearchField value={search} onChange={setSearch} placeholder="Ім’я, посада чи спеціальність" />
        <Chips label="Спеціальність" values={specialties} value={specialty} onChange={setSpecialty} />
      </div>

      {team.isPending ? (
        <div className={s.grid}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={132} />
          ))}
        </div>
      ) : team.isError ? (
        <ErrorMessage text={errorOf(team.error)} />
      ) : shown.length === 0 ? (
        <p className="hint">Нікого не знайдено. Спробуйте інший запит або приберіть фільтр.</p>
      ) : (
        <ul className={s.grid} aria-label="Учасники">
          {shown.map((u) => (
            <li key={u.id}>
              <Link to={u.id === user?.id ? '/profile' : `/team/${u.id}`} className={s.card}>
                <Avatar name={u.name} url={u.avatarUrl} size={56} />
                <span className={s.cardText}>
                  <span className={s.name}>
                    {u.name}
                    {u.role !== 'member' && <span className={s.role}>{ROLE_LABEL[u.role]}</span>}
                  </span>
                  {(u.position || u.specialty) && (
                    <span className={s.meta}>{[u.position, u.specialty].filter(Boolean).join(' · ')}</span>
                  )}
                  {u.bio && <span className={s.bio}>{u.bio}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
