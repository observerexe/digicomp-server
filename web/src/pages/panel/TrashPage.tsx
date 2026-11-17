import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, unwrap } from '../../api/client';
import type { TrashItem, TrashType } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { Chips, SearchField } from '../../components/Filters';
import { Icon } from '../../components/Icon';
import { ConfirmButton, ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { formatDate, formatDateTime } from '../../lib/format';
import { useDebounced } from '../../lib/useDebounced';
import s from './panel.module.css';

export const TRASH_PAGE = 50;

/** Chip of the filter and badge of a row; the section's lists to refresh after «Відновити». */
const TYPES: Record<TrashType, { chip: string; badge: string; lists: string }> = {
  place: { chip: 'Обладнання', badge: 'Обладнання', lists: 'places' },
  inventory_item: { chip: 'Склад', badge: 'Позиція складу', lists: 'inventory' },
  document: { chip: 'Файли', badge: 'Файл Архіву', lists: 'documents' },
  project: { chip: 'Проєкти', badge: 'Проєкт', lists: 'projects' },
};

/** Where a restored record lives. */
function recordUrl(r: TrashItem): string {
  const code = encodeURIComponent(r.code ?? r.id);
  if (r.type === 'place') return `/lab/${code}`;
  if (r.type === 'inventory_item') return `/inventory/${code}`;
  if (r.type === 'document') return `/docs/${r.id}`;
  return `/projects/${r.id}`;
}

/** /panel/trash: what staff deleted; restore, or (admin) delete for good. The server purges it itself after 90 days. */
export function TrashPage() {
  const [type, setType] = useState<TrashType | null>(null);
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim());
  const [restored, setRestored] = useState<TrashItem | null>(null);
  const q = useInfiniteQuery({
    queryKey: ['trash', type, term],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET('/api/trash', {
          params: { query: { page: String(pageParam), limit: String(TRASH_PAGE), ...(type ? { type } : {}), ...(term ? { search: term } : {}) } },
        }),
      ),
    getNextPageParam: (last) => (last.page * last.limit < last.total ? last.page + 1 : undefined),
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = !!type || !!term;

  return (
    <>
      <Link to="/panel" className="btn btn-ghost">
        <Icon name="back" size={20} />
        Панель керування
      </Link>
      <PageHeader title="Кошик" />
      <div className={s.tools}>
        <SearchField value={search} onChange={setSearch} placeholder="Назва чи код" />
        <Chips
          label="Що"
          options={(Object.keys(TYPES) as TrashType[]).map((t) => ({ value: t, label: TYPES[t].chip }))}
          value={type}
          onChange={(v) => setType(v as TrashType | null)}
        />
      </div>
      {restored && (
        <p role="status" className="hint">
          Відновлено: <Link to={recordUrl(restored)}>{restored.title}</Link>
        </p>
      )}
      {q.isPending ? (
        <Skeleton height={240} />
      ) : q.isError ? (
        <ErrorMessage text={errorOf(q.error)} />
      ) : rows.length === 0 ? (
        <p className="hint">
          {filtered ? 'Нічого не знайдено. Спробуйте прибрати фільтр.' : 'Кошик порожній. Видалене лежить тут 90 днів, потім сервер видаляє його сам.'}
        </p>
      ) : (
        <>
          <ul className={s.rows} aria-label="Видалене">
            {rows.map((r) => (
              <Row key={`${r.type}:${r.id}`} r={r} onRestored={setRestored} />
            ))}
          </ul>
          {q.hasNextPage && (
            <p className={s.actions}>
              <button type="button" className="btn" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
                {q.isFetchingNextPage ? 'Завантажуємо…' : 'Показати ще'}
              </button>
            </p>
          )}
        </>
      )}
    </>
  );
}

function Row({ r, onRestored }: { r: TrashItem; onRestored: (r: TrashItem) => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const path = { params: { path: { type: r.type, id: r.id } } };
  const refresh = () => void qc.invalidateQueries({ queryKey: ['trash'] });
  const restore = useMutation({
    mutationFn: () => unwrap(api.POST('/api/trash/{type}/{id}/restore', path)),
    onSuccess: () => {
      onRestored(r);
      void qc.invalidateQueries({ queryKey: [TYPES[r.type].lists] });
    },
    onSettled: refresh,
  });
  const purge = useMutation({
    mutationFn: () => unwrap(api.DELETE('/api/trash/{type}/{id}', path)),
    onSettled: refresh,
  });
  const error = restore.isError ? restore.error : purge.isError ? purge.error : null;
  const busy = restore.isPending || purge.isPending;
  return (
    <li>
      <div className={s.row}>
        <div className={s.rowMain}>
          <span className={s.rowTitle}>
            {r.title}
            <span className={s.badge}>{TYPES[r.type].badge}</span>
          </span>
          <span className={s.rowSub}>
            {[
              r.code && `код ${r.code}`,
              `видалив(-ла) ${r.deletedBy?.name ?? 'видалений обліковий запис'}, ${formatDateTime(r.deletedAt)}`,
              `назавжди — ${formatDate(r.purgeAt)}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
        <div className={s.actions}>
          <button type="button" className="btn" disabled={busy} onClick={() => restore.mutate()}>
            Відновити
          </button>
          {can('trash.purge') && (
            <ConfirmButton
              label="Видалити назавжди"
              question={`Видалити «${r.title}» назавжди? Повернути вже не вийде.`}
              confirmLabel="Видалити"
              danger
              disabled={busy}
              onConfirm={() => purge.mutate()}
            />
          )}
        </div>
        <ErrorMessage text={error ? errorOf(error) : null} />
      </div>
    </li>
  );
}
