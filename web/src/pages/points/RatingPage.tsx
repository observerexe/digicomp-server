import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, unwrap } from '../../api/client';
import type { LeaderboardRow } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { Avatar } from '../../components/Avatar';
import { ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { currentMonthName, plural } from '../../lib/format';
import s from './points.module.css';

type Period = 'month' | 'all';

/** Rating: top 3 on a podium, then the table; equal totals share a place. */
export function RatingPage() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>('month');
  const q = useQuery({
    queryKey: ['points', 'leaderboard', period],
    queryFn: () => unwrap(api.GET('/api/points/leaderboard', { params: { query: { period } } })),
  });
  const rows = q.data ?? [];
  const top = rows.filter((r) => r.rank <= 3 && r.total > 0).slice(0, 3);
  const rest = rows.filter((r) => !top.includes(r));
  const me = rows.find((r) => r.id === user?.id);
  const href = (r: LeaderboardRow) => (r.id === user?.id ? '/profile' : `/team/${r.id}`);
  const pts = (n: number) => `${n} ${plural(n, ['бал', 'бали', 'балів'])}`;

  return (
    <>
      <PageHeader title="Рейтинг">
        <div className={s.segmented} role="group" aria-label="Період">
          <button type="button" aria-pressed={period === 'month'} onClick={() => setPeriod('month')}>
            За {currentMonthName()}
          </button>
          <button type="button" aria-pressed={period === 'all'} onClick={() => setPeriod('all')}>
            За весь час
          </button>
        </div>
      </PageHeader>
      {q.isPending ? (
        <Skeleton height={320} />
      ) : q.isError ? (
        <ErrorMessage text={errorOf(q.error)} />
      ) : rows.every((r) => r.total === 0) ? (
        <p className="hint">{period === 'month' ? 'Цього місяця балів ще ніхто не отримав.' : 'Балів ще немає.'}</p>
      ) : (
        <>
          <ol className={s.podium} aria-label="Топ-3">
            {top.map((r) => (
              <li key={r.id} className={`${s.place} ${s[`place${r.rank}`] ?? ''}`}>
                <Link to={href(r)} className={s.placeLink}>
                  <span className={s.medal}>{r.rank}</span>
                  <Avatar name={r.name} url={r.avatarUrl} size={r.rank === 1 ? 96 : 56} />
                  <span className={s.placeName}>{r.name}</span>
                  <span className={s.placePoints}>{pts(r.total)}</span>
                </Link>
              </li>
            ))}
          </ol>
          <ol className={s.table} aria-label="Рейтинг">
            {rest.map((r) => (
              <li key={r.id} className={r.id === user?.id ? s.mine : undefined}>
                <Link to={href(r)} className={s.row}>
                  <span className={s.rank}>{r.rank}</span>
                  <Avatar name={r.name} url={r.avatarUrl} size={40} />
                  <span className={s.who}>
                    {r.id === user?.id ? `${r.name} (ви)` : r.name}
                    {r.position && <span className={s.sub}>{r.position}</span>}
                  </span>
                  <span className={s.total}>{r.total}</span>
                </Link>
              </li>
            ))}
          </ol>
          {me && !top.includes(me) && (
            <p className={s.meBar} aria-live="polite">
              Ваше місце: <b>{me.rank}</b> · {pts(me.total)}
            </p>
          )}
        </>
      )}
    </>
  );
}
