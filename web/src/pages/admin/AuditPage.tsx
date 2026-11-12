import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, unwrap } from '../../api/client';
import { Icon } from '../../components/Icon';
import { Card, ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { formatDateTime } from '../../lib/format';
import { fetchStaffUsers, STAFF_USERS_KEY } from '../panel/UsersPage';
import { AUDIT_ACTION, AUDIT_GROUPS, entityLink, metaLines, type AuditEntry } from './labels';
import s from './admin.module.css';

export const AUDIT_PAGE = 50;

/** /admin/audit: every action of every member (admin, docs/PLAN.md). Works on any port. */
export function AuditPage() {
  const [group, setGroup] = useState('');
  const [actorId, setActorId] = useState('');
  const people = useQuery({ queryKey: STAFF_USERS_KEY, queryFn: fetchStaffUsers });
  const q = useInfiniteQuery({
    queryKey: ['audit', group, actorId],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET('/api/audit', {
          params: {
            query: {
              limit: String(AUDIT_PAGE),
              ...(pageParam ? { before: pageParam } : {}),
              ...(group ? { action: group } : {}),
              ...(actorId ? { actorId } : {}),
            },
          },
        }),
      ),
    getNextPageParam: (last) => (last.length === AUDIT_PAGE ? last[last.length - 1]!.id : undefined),
  });
  const entries = q.data?.pages.flat() ?? [];

  return (
    <>
      <Link to="/admin" className="btn btn-ghost">
        <Icon name="back" size={20} />
        Розширена панель
      </Link>
      <PageHeader title="Журнал дій" />
      <div className={s.tools}>
        <div className="field">
          <label htmlFor="audit-group">Що</label>
          <select id="audit-group" value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">Усі дії</option>
            {AUDIT_GROUPS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="audit-actor">Хто</label>
          <select id="audit-actor" value={actorId} onChange={(e) => setActorId(e.target.value)}>
            <option value="">Усі</option>
            {(people.data?.items ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {q.isPending ? (
        <Skeleton height={320} />
      ) : q.isError ? (
        <ErrorMessage text={errorOf(q.error)} />
      ) : entries.length === 0 ? (
        <p className="hint">Записів немає. Спробуйте прибрати фільтр.</p>
      ) : (
        <Card>
          <ul className={s.rows} aria-label="Записи журналу">
            {entries.map((e) => (
              <Entry key={e.id} e={e} />
            ))}
          </ul>
          {q.hasNextPage && (
            <p className={s.actions}>
              <button type="button" className="btn" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
                {q.isFetchingNextPage ? 'Завантажуємо…' : 'Показати ще'}
              </button>
            </p>
          )}
        </Card>
      )}
    </>
  );
}

function Entry({ e }: { e: AuditEntry }) {
  const link = entityLink(e.entity, e.entityId);
  const lines = metaLines(e.meta);
  return (
    <li className={s.entry}>
      <span className={s.entryHead}>
        <span className={s.entryAction}>{AUDIT_ACTION[e.action] ?? e.action}</span>
        <span className={s.sub}>{e.actor?.name ?? (e.actorId ? 'Видалений учасник' : 'Сервер')}</span>
        <span className={s.sub}>{formatDateTime(e.createdAt)}</span>
        {link && (
          <Link to={link} className={s.sub}>
            Відкрити
          </Link>
        )}
      </span>
      {lines.length > 0 && (
        <ul className={s.meta}>
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
    </li>
  );
}
