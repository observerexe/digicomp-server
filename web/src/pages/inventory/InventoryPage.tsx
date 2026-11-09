import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api, unwrap } from '../../api/client';
import type { InventoryItem } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { Chips, distinct, norm, SearchField } from '../../components/Filters';
import { ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import s from './inventory.module.css';

export const itemsKey = ['inventory', 'items'] as const;

/** «12 шт» with up to 3 decimals for weights and lengths. */
export function qty(n: number, unit: string): string {
  return `${n.toLocaleString('uk-UA', { maximumFractionDigits: 3 })} ${unit}`;
}

export function matchesItem(i: InventoryItem, search: string, category: string | null, low: boolean) {
  if (low && !i.lowStock) return false;
  if (category && i.category !== category) return false;
  const q = norm(search);
  return !q || [i.title, i.code, i.category, i.location].some((f) => norm(f).includes(q));
}

export function InventoryPage() {
  const { can } = useAuth();
  const q = useQuery({
    queryKey: itemsKey,
    queryFn: () => unwrap(api.GET('/api/inventory/items', { params: { query: { limit: '100' } } })),
  });
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [low, setLow] = useState(false);
  const items = q.data?.items ?? [];
  const categories = useMemo(() => distinct(items.map((i) => i.category)), [items]);
  const shown = items.filter((i) => matchesItem(i, search, category, low));
  const lowCount = items.filter((i) => i.lowStock).length;

  return (
    <>
      <PageHeader title="Склад">
        {can('inventory.manage') && (
          <div className={s.headerLinks}>
            <a className="btn btn-ghost" href="/api/inventory/export" download>
              CSV
            </a>
            <Link to="/lab/stickers?kind=items" className="btn btn-ghost">
              Наліпки QR
            </Link>
            <Link to="/inventory/new" className="btn btn-primary">
              Нова позиція
            </Link>
          </div>
        )}
      </PageHeader>
      <div className={s.tools}>
        <SearchField value={search} onChange={setSearch} placeholder="Назва, код чи місце" />
        <Chips label="Категорія" values={categories} value={category} onChange={setCategory} />
        {lowCount > 0 && (
          <label className={s.check}>
            <input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} />
            Лише ті, яких мало ({lowCount})
          </label>
        )}
      </div>
      {q.isPending ? (
        <Skeleton height={240} />
      ) : q.isError ? (
        <ErrorMessage text={errorOf(q.error)} />
      ) : shown.length === 0 ? (
        <p className="hint">{items.length ? 'Нічого не знайдено.' : 'Позицій ще немає.'}</p>
      ) : (
        <ul className={s.list} aria-label="Позиції складу">
          {shown.map((i) => (
            <li key={i.id}>
              <Link to={`/inventory/${encodeURIComponent(i.code)}`} className={s.row}>
                <span className={s.main}>
                  <span className={s.title}>{i.title}</span>
                  <span className={s.sub}>{[i.category, i.location, i.code].filter(Boolean).join(' · ')}</span>
                </span>
                <span className={`${s.qty} ${i.lowStock ? s.low : ''}`}>
                  {qty(i.quantity, i.unit)}
                  {i.lowStock && <span className={s.lowTag}>мало</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
