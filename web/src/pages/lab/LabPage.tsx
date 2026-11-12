import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api, unwrap } from '../../api/client';
import type { Place } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { Chips, distinct, norm, SearchField } from '../../components/Filters';
import { Icon } from '../../components/Icon';
import { ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { keys } from './queries';
import s from './lab.module.css';

export function matchesPlace(p: Place, search: string, category: string | null) {
  if (category && p.category !== category) return false;
  const q = norm(search);
  return !q || [p.title, p.code, p.category, p.location].some((f) => norm(f).includes(q));
}

/** «Лабораторія»: equipment with its state; smart devices live on /smart. */
export function LabPage() {
  const { can } = useAuth();
  const places = useQuery({ queryKey: keys.places, queryFn: () => unwrap(api.GET('/api/places')) });
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  // Staff can open the archive to restore a piece of equipment.
  const [archive, setArchive] = useState(false);
  const items = useMemo(() => (places.data ?? []).filter((p) => (p.status === 'archived') === archive), [places.data, archive]);
  const categories = useMemo(() => distinct(items.map((p) => p.category)), [items]);
  const shown = items.filter((p) => matchesPlace(p, search, category));

  return (
    <>
      <PageHeader title="Лабораторія">
        <div className={s.headerLinks}>
          <Link to="/lab/journal" className="btn btn-ghost">
            Журнал
          </Link>
          {can('smart.read') && (
            <Link to="/smart" className="btn btn-ghost">
              Розумна лабораторія
            </Link>
          )}
          {can('places.manage') && (
            <>
              <Link to="/lab/stickers" className="btn btn-ghost">
                Наліпки QR
              </Link>
              <button type="button" className="btn btn-ghost" aria-pressed={archive} onClick={() => setArchive((v) => !v)}>
                {archive ? 'До робочого' : 'Архів'}
              </button>
              <Link to="/lab/new" className="btn btn-primary">
                Додати
              </Link>
            </>
          )}
        </div>
      </PageHeader>
      <div className={s.tools}>
        <SearchField value={search} onChange={setSearch} placeholder="Назва, код чи місце" />
        <Chips label="Категорія" values={categories} value={category} onChange={setCategory} />
      </div>
      {places.isPending ? (
        <div className={s.grid}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={120} />
          ))}
        </div>
      ) : places.isError ? (
        <ErrorMessage text={errorOf(places.error)} />
      ) : shown.length === 0 ? (
        <p className="hint">{items.length ? 'Нічого не знайдено. Спробуйте інший запит.' : archive ? 'В архіві порожньо.' : 'Обладнання ще не додано.'}</p>
      ) : (
        <ul className={s.grid} aria-label="Обладнання">
          {shown.map((p) => (
            <li key={p.id}>
              <Link to={`/lab/${encodeURIComponent(p.code)}`} className={s.card}>
                <span className={s.cardTop}>
                  <span className={s.cardTitle}>{p.title}</span>
                  <PlaceState place={p} />
                </span>
                <span className={s.meta}>{[p.category, p.location].filter(Boolean).join(' · ')}</span>
                <span className={s.cardBottom}>
                  <span className={s.code}>{p.code}</span>
                  {p.needsAuthorization &&
                    (p.myAuthorization ? (
                      <span className={s.ok}>
                        <Icon name="shield" size={16} /> є допуск
                      </span>
                    ) : (
                      <span className={s.meta}>потрібен допуск</span>
                    ))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Вільне / Зайняте (ким) / На обслуговуванні. */
export function PlaceState({ place }: { place: Place }) {
  if (place.status === 'maintenance') return <span className={`${s.badge} ${s.badgeWarn}`}>На обслуговуванні</span>;
  if (place.status === 'archived') return <span className={s.badge}>В архіві</span>;
  if (place.inUse) {
    const who = place.activeSessions[0]?.user.name;
    return <span className={`${s.badge} ${s.badgeBusy}`}>{who ? `Зайняте: ${who}` : 'Зайняте'}</span>;
  }
  return <span className={`${s.badge} ${s.badgeFree}`}>Вільне</span>;
}
