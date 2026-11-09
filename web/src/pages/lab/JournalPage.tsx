import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, unwrap } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { Icon } from '../../components/Icon';
import { Card, ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { formatDateTime, formatDuration, formatTime } from '../../lib/format';
import { kyivDay, kyivParts } from '../../lib/kyiv';
import { keys } from './queries';
import s from './lab.module.css';

const LIMIT = 100;

/** First day of this month and today, Kyiv dates. */
function thisMonth() {
  const today = kyivParts(new Date()).date;
  return { from: `${today.slice(0, 8)}01`, to: today };
}

/**
 * Equipment log. Staff: filters and export (CSV, print page from the API);
 * a member sees own sessions only (the API enforces it).
 */
export function JournalPage() {
  const { can, user } = useAuth();
  const staff = can('sessions.read_all');
  const [filters, setFilters] = useState({ ...thisMonth(), placeId: '', userId: '' });

  const range = {
    from: kyivDay(filters.from).start.toISOString(),
    // The «to» day is included.
    to: kyivDay(filters.to).end.toISOString(),
  };
  const query = {
    ...range,
    ...(filters.placeId ? { placeId: filters.placeId } : {}),
    ...(staff && filters.userId ? { userId: filters.userId } : {}),
  };
  const sessions = useQuery({
    queryKey: ['work-sessions', 'journal', query],
    enabled: filters.from <= filters.to,
    queryFn: () => unwrap(api.GET('/api/work-sessions', { params: { query: { ...query, limit: String(LIMIT) } } })),
  });
  const places = useQuery({ queryKey: keys.places, queryFn: () => unwrap(api.GET('/api/places')) });
  const people = useQuery({
    queryKey: ['users', 'team'],
    enabled: staff,
    queryFn: () => unwrap(api.GET('/api/users', { params: { query: { limit: '100' } } })),
  });

  const qs = new URLSearchParams(query).toString();
  const set = (k: keyof typeof filters) => (e: { target: { value: string } }) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  return (
    <>
      <Link to="/lab" className="btn btn-ghost">
        <Icon name="back" size={20} />
        Лабораторія
      </Link>
      <PageHeader title={staff ? 'Журнал обладнання' : 'Мої сеанси'}>
        {can('sessions.export') && (
          <div className={s.headerLinks}>
            <a className="btn" href={`/api/work-sessions/export.csv?${qs}`} download>
              CSV
            </a>
            <a className="btn" href={`/api/work-sessions/report?${qs}`} target="_blank" rel="noopener">
              Для друку / PDF
            </a>
          </div>
        )}
      </PageHeader>
      <Card>
        <div className={s.filters}>
          <div className="field">
            <label htmlFor="j-from">З</label>
            <input id="j-from" type="date" value={filters.from} max={filters.to} onChange={set('from')} />
          </div>
          <div className="field">
            <label htmlFor="j-to">По</label>
            <input id="j-to" type="date" value={filters.to} min={filters.from} onChange={set('to')} />
          </div>
          <div className="field">
            <label htmlFor="j-place">Обладнання</label>
            <select id="j-place" value={filters.placeId} onChange={set('placeId')}>
              <option value="">Усе</option>
              {places.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} ({p.code})
                </option>
              ))}
            </select>
          </div>
          {staff && (
            <div className="field">
              <label htmlFor="j-user">Особа</label>
              <select id="j-user" value={filters.userId} onChange={set('userId')}>
                <option value="">Усі</option>
                {people.data?.items.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </Card>

      {filters.from > filters.to ? (
        <ErrorMessage text="Кінець періоду має бути пізніше за початок." />
      ) : sessions.isPending ? (
        <Skeleton height={200} />
      ) : sessions.isError ? (
        <ErrorMessage text={errorOf(sessions.error)} />
      ) : sessions.data.items.length === 0 ? (
        <p className="hint">За цей період сеансів немає.</p>
      ) : (
        <>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">Обладнання</th>
                  {staff && <th scope="col">Особа</th>}
                  <th scope="col">Початок</th>
                  <th scope="col">Кінець</th>
                  <th scope="col">Тривалість</th>
                  <th scope="col">Примітка</th>
                </tr>
              </thead>
              <tbody>
                {sessions.data.items.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link to={`/lab/${encodeURIComponent(r.place.code ?? '')}`}>{r.place.title}</Link>
                    </td>
                    {staff && <td>{r.user.id === user?.id ? 'Ви' : r.user.name}</td>}
                    <td>{formatDateTime(r.startedAt)}</td>
                    <td>{r.endedAt ? formatTime(r.endedAt) : 'триває'}</td>
                    <td className={s.num}>{r.endedAt ? formatDuration(r.startedAt, r.endedAt) : ''}</td>
                    <td>{r.autoClosed ? 'закрито автоматично' : r.endReason ? `завершено: ${r.endReason}` : r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sessions.data.total > LIMIT && (
            <p className="hint">
              Показано {LIMIT} найновіших із {sessions.data.total}. Звузьте період{can('sessions.export') && ' або вивантажте CSV'}.
            </p>
          )}
        </>
      )}
    </>
  );
}
