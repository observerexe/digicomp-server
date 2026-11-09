import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { api, unwrap } from '../../api/client';
import type { Me, PointsHistoryEntry } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { Card, ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { currentMonthName, formatDate, formatDateTime, formatPoints, plural } from '../../lib/format';
import { disciplineTitle, PROJECT_STAGE_LABEL, pointsReason, ROLE_LABEL, TASK_STATUS_LABEL } from '../../lib/labels';
import s from './profile.module.css';

const HISTORY_PREVIEW = 5;

export function ProfilePage() {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <>
      <PageHeader title="Профіль" />
      <div className={s.layout}>
        <div className={s.column}>
          <Header user={user} />
          <PointsCard userId={user.id} />
          <DisciplineCard />
        </div>
        <div className={s.column}>
          <MineCard user={user} />
          <SecurityCard user={user} />
          <button type="button" className={`btn btn-ghost ${s.logout}`} onClick={() => void logout({ next: '/' })}>
            <Icon name="logout" size={20} />
            Вийти
          </button>
        </div>
      </div>
    </>
  );
}

function Header({ user }: { user: Me }) {
  return (
    <Card>
      <div className={s.head}>
        <Avatar name={user.name} url={user.avatarUrl} size={96} />
        <div className={s.headText}>
          <h2 className={s.name}>{user.name}</h2>
          <p className={s.meta}>{[user.position, user.specialty].filter(Boolean).join(' · ') || ROLE_LABEL[user.role]}</p>
        </div>
      </div>
      {user.bio ? <p className={s.bio}>{user.bio}</p> : <p className="hint">Розкажіть про себе: що вмієте і з чим можна до вас звертатися.</p>}
      <div className={s.actions}>
        <Link to="/profile/edit" className="btn">
          Змінити біо й аватар
        </Link>
        <Link to="/profile/password" className="btn btn-ghost">
          Змінити пароль
        </Link>
      </div>
    </Card>
  );
}

function PointsCard({ userId }: { userId: string }) {
  const [all, setAll] = useState(false);
  const points = useQuery({ queryKey: ['points', 'me'], queryFn: () => unwrap(api.GET('/api/points/me')) });
  const month = useQuery({
    queryKey: ['points', 'leaderboard', 'month'],
    queryFn: () => unwrap(api.GET('/api/points/leaderboard', { params: { query: { period: 'month' } } })),
  });
  const total = useQuery({
    queryKey: ['points', 'leaderboard', 'all'],
    queryFn: () => unwrap(api.GET('/api/points/leaderboard', { params: { query: { period: 'all' } } })),
  });

  if (points.isPending) return <Skeleton height={200} />;
  if (points.isError) return <ErrorMessage text={errorOf(points.error)} />;

  const rankMonth = month.data?.find((r) => r.id === userId)?.rank;
  const rankAll = total.data?.find((r) => r.id === userId)?.rank;
  const ranks = [
    rankMonth && `${rankMonth} місце за ${currentMonthName()}`,
    rankAll && `${rankAll} за весь час`,
  ].filter(Boolean);
  const rows = mergeReversals(points.data.history);
  const history = all ? rows : rows.slice(0, HISTORY_PREVIEW);

  return (
    <Card>
      <h2 className={s.caption}>Баланс</h2>
      <p className={s.balance}>{points.data.balance}</p>
      {ranks.length > 0 && <p className={s.meta}>{ranks.join(' · ')}</p>}
      {history.length === 0 ? (
        <p className="hint">Балів ще немає. Беріть ТЗ на дошці — бали нараховуються, коли модератор приймає роботу.</p>
      ) : (
        <ul className={s.rows} aria-label="Історія балів">
          {history.map((e) => (
            <li key={e.id} className={s.row}>
              <span className={s.rowMain}>
                <span className={s.rowTitle}>{pointsReason(e)}</span>
                <span className={s.rowSub}>
                  {formatDate(e.createdAt)} · {e.createdBy?.name ?? 'Система'}
                  {e.revoked && (e.revokeReason ? ` · знято: ${e.revokeReason}` : ' · знято')}
                </span>
              </span>
              <span className={`${s.amount} ${e.revoked ? s.revoked : e.amount < 0 ? s.minus : s.plus}`}>{formatPoints(e.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      {rows.length > HISTORY_PREVIEW && (
        <button type="button" className="btn btn-ghost" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? 'Згорнути' : 'Уся історія балів'}
        </button>
      )}
    </Card>
  );
}

type HistoryRow = PointsHistoryEntry & { revokeReason?: string };

/**
 * A revoked entry and its reversal are one event for the person: show the
 * original crossed out with the reason, hide the reversal row. A reversal
 * whose original is older than the loaded history stays as its own row.
 */
export function mergeReversals(history: PointsHistoryEntry[]): HistoryRow[] {
  const ids = new Set(history.map((e) => e.id));
  const reasonOf = new Map(history.filter((e) => e.reversesId).map((e) => [e.reversesId!, e.reason]));
  return history
    .filter((e) => !(e.reversesId && ids.has(e.reversesId)))
    .map((e) => (reasonOf.has(e.id) ? { ...e, revokeReason: reasonOf.get(e.id) } : e));
}

function DisciplineCard() {
  const q = useQuery({ queryKey: ['discipline', 'me'], queryFn: () => unwrap(api.GET('/api/discipline/me')) });
  return (
    <Card>
      <h2 className={s.caption}>
        Попередження й штрафи <span className={s.private}>бачите лише ви</span>
      </h2>
      {q.isPending ? (
        <Skeleton height={64} />
      ) : q.isError ? (
        <ErrorMessage text={errorOf(q.error)} />
      ) : q.data.length === 0 ? (
        <p className="hint">Записів немає.</p>
      ) : (
        <ul className={s.rows} aria-label="Попередження й штрафи">
          {q.data.map((r) => (
            <li key={r.id} className={`${s.record} ${r.revoked ? s.recordRevoked : ''}`}>
              <span className={s.rowTitle}>
                {disciplineTitle(r)}
                <span className={s.rowSub}>
                  {' '}
                  {formatDate(r.createdAt)}
                  {r.revoked && r.revokedAt && ` · знято ${formatDate(r.revokedAt)}`}
                </span>
              </span>
              <span>{r.reason}</span>
              {r.revoked && r.revokeReason && <span className={s.rowSub}>Знято: {r.revokeReason}</span>}
              {r.issuedBy?.name && <span className={s.rowSub}>Видав {r.issuedBy.name}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** «Мої ТЗ, проєкти, допуски, бронювання»: a count on the row, the list inside. */
function MineCard({ user }: { user: Me }) {
  const tasks = useQuery({
    queryKey: ['tasks', { mine: true }],
    queryFn: () => unwrap(api.GET('/api/tasks', { params: { query: { mine: 'true' } } })),
  });
  const projects = useQuery({
    queryKey: ['projects', { memberId: user.id }],
    queryFn: () => unwrap(api.GET('/api/projects', { params: { query: { memberId: user.id, limit: '100' } } })),
  });
  const auths = useQuery({
    queryKey: ['place-authorizations', 'me'],
    queryFn: () => unwrap(api.GET('/api/place-authorizations')),
  });
  const bookings = useQuery({ queryKey: ['bookings', 'me'], queryFn: () => unwrap(api.GET('/api/bookings/me')) });

  const activeTasks = tasks.data?.filter((t) => t.status !== 'done') ?? [];
  const validAuths = auths.data?.filter((a) => !a.expired) ?? [];
  const next = bookings.data?.[0];

  return (
    <Card>
      <h2 className={s.caption}>Моє</h2>
      <div className={s.mine}>
        <Mine
          title="Мої ТЗ"
          value={
            tasks.data &&
            (activeTasks.length ? `${activeTasks.length} ${plural(activeTasks.length, ['активне', 'активні', 'активних'])}` : 'немає')
          }
          error={tasks.error}
          empty="Активних ТЗ немає. Вільні ТЗ — на дошці."
          items={activeTasks.map((t) => ({
            key: t.id,
            to: `/tasks/${t.id}`,
            title: t.title,
            sub: [TASK_STATUS_LABEL[t.status], t.dueDate && `до ${formatDate(t.dueDate)}`].filter(Boolean).join(' · '),
          }))}
        />
        <Mine
          title="Проєкти"
          value={projects.data && String(projects.data.total)}
          error={projects.error}
          empty="Ви ще не в жодному проєкті."
          items={(projects.data?.items ?? []).map((p) => ({
            key: p.id,
            to: '/projects',
            title: p.title,
            sub: [PROJECT_STAGE_LABEL[p.stage], p.deadline && `дедлайн ${formatDate(p.deadline)}`].filter(Boolean).join(' · '),
          }))}
        />
        <Mine
          title="Допуски"
          value={auths.data && String(validAuths.length)}
          error={auths.error}
          empty="Допусків до обладнання ще немає. Їх видає модератор."
          items={(auths.data ?? []).map((a) => ({
            key: a.id,
            to: `/lab/${encodeURIComponent(a.place.code)}`,
            title: a.place.title,
            sub: a.expired ? 'термін минув' : a.expiresAt ? `до ${formatDate(a.expiresAt)}` : 'безстроково',
          }))}
        />
        <Mine
          title="Бронювання"
          value={bookings.data && (next ? formatDate(next.startsAt) : 'немає')}
          error={bookings.error}
          empty="Найближчих бронювань немає."
          items={(bookings.data ?? []).map((b) => ({
            key: b.id,
            to: b.place.code ? `/lab/${encodeURIComponent(b.place.code)}` : '/lab',
            title: b.place.title ?? 'Обладнання',
            sub: formatDateTime(b.startsAt),
          }))}
        />
      </div>
    </Card>
  );
}

type MineItem = { key: string; to: string; title: string; sub: ReactNode };

function Mine(props: { title: string; value: string | undefined; error: unknown; empty: string; items: MineItem[] }) {
  return (
    <details className={s.details}>
      <summary className={s.summary}>
        <span>{props.title}</span>
        <span className={s.summaryValue}>{props.error ? '—' : (props.value ?? '…')}</span>
        <Icon name="chevron" size={20} />
      </summary>
      {props.error ? (
        <ErrorMessage text={errorOf(props.error)} />
      ) : props.items.length === 0 ? (
        <p className="hint">{props.empty}</p>
      ) : (
        <ul className={s.rows}>
          {props.items.map((i) => (
            <li key={i.key}>
              <Link to={i.to} className={s.linkRow}>
                <span className={s.rowTitle}>{i.title}</span>
                <span className={s.rowSub}>{i.sub}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function SecurityCard({ user }: { user: Me }) {
  return (
    <Card>
      <h2 className={s.caption}>Безпека</h2>
      <p className={s.rowTitle}>Вхід із кодом (2FA)</p>
      <p className="hint">
        {user.twoFactorEnabled
          ? 'Увімкнено. Під час входу потрібен код із застосунку на телефоні.'
          : 'Вимкнено. Код із застосунку на телефоні захистить акаунт, навіть якщо пароль дізнаються.'}
      </p>
      {user.role === 'admin' && !user.twoFactorEnabled && (
        <p className={s.warn}>Розширена панель відкривається лише з увімкненим входом із кодом.</p>
      )}
      <Link to="/profile/2fa" className={user.twoFactorEnabled ? 'btn' : 'btn btn-primary'}>
        {user.twoFactorEnabled ? 'Керувати входом із кодом' : 'Увімкнути 2FA'}
      </Link>
    </Card>
  );
}
