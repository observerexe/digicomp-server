import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api, unwrap } from '../../api/client';
import type { PaperItem, Place, Task } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { Icon } from '../../components/Icon';
import { Card, ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { currentMonthName, formatDate, formatDateTime, formatDuration, formatTime, plural } from '../../lib/format';
import { kyivParts } from '../../lib/kyiv';
import { TASK_STATUS_LABEL } from '../../lib/labels';
import { keys, useActiveSession } from '../lab/queries';
import { dueState } from '../tasks/logic';
import s from './home.module.css';

/** How many rows a block shows before «Усі …». */
export const HOME_LIMIT = 5;

/** Greeting by the Kyiv hour, whatever the device clock zone. */
export function greeting(now = new Date()): string {
  const h = Number(kyivParts(now).time.slice(0, 2));
  if (h < 5) return 'Доброї ночі';
  if (h < 12) return 'Доброго ранку';
  if (h < 18) return 'Добрий день';
  return 'Добрий вечір';
}

/** My unfinished tasks, nearest deadline first, no deadline last. */
export function homeTasks(tasks: Task[]): Task[] {
  const due = (t: Task) => (t.dueDate ? Date.parse(t.dueDate) : Number.POSITIVE_INFINITY);
  return tasks.filter((t) => t.status !== 'done').sort((a, b) => due(a) - due(b));
}

/** How many days a document about me stays «Нове про мене». */
export const NEWS_DAYS = 14;

/** Documents about me changed in the last NEWS_DAYS days. */
export function recentPapers(items: PaperItem[], now = new Date()): PaperItem[] {
  const since = now.getTime() - NEWS_DAYS * 24 * 60 * 60 * 1000;
  return items.filter((p) => Date.parse(p.updatedAt) >= since);
}

/** Equipment someone works on right now. */
export function busyPlaces(places: Place[]): Place[] {
  return places.filter((p) => p.inUse && p.status !== 'archived');
}

/** «/»: active session, my tasks and deadlines, points, documents, busy equipment, next bookings (docs/tech/ARCHITECTURE.md). */
export function HomePage() {
  const { user } = useAuth();
  const first = user?.name.split(/\s+/)[0] ?? '';
  return (
    <>
      <PageHeader title={`${greeting()}, ${first}`} />
      <div className={s.grid}>
        <div className={s.column}>
          <SessionCard />
          <TasksCard />
          <BusyCard />
        </div>
        <div className={s.column}>
          {user && <PointsCard userId={user.id} />}
          <PapersCard staff={!!user && user.role !== 'member'} />
          <BookingsCard />
        </div>
      </div>
    </>
  );
}

function SessionCard() {
  const active = useActiveSession();
  if (active.isPending) return <Skeleton height={88} />;
  const session = active.data;
  if (!session) {
    return (
      <Card>
        <div className={s.session}>
          <p className={s.sessionText}>
            <span className={s.sessionTitle}>Зараз ви не працюєте на обладнанні</span>
            <span className={s.sessionSub}>Щоб почати, відскануйте QR-наліпку на обладнанні.</span>
          </p>
          <Link to="/scan" className={`btn btn-primary ${s.scan}`}>
            <Icon name="qr" size={20} />
            Сканувати QR
          </Link>
        </div>
        {active.isError && <ErrorMessage text={errorOf(active.error)} />}
      </Card>
    );
  }
  const code = session.place.code ?? '';
  return (
    <Card>
      <div className={`${s.session} ${s.sessionActive}`} role="region" aria-label="Мій сеанс">
        <p className={s.sessionText}>
          <span className={s.sessionTitle}>Працюєте на {session.place.title ?? code}</span>
          <span className={s.sessionSub}>
            з {formatTime(session.startedAt)} · {formatDuration(session.startedAt, new Date())} год
          </span>
        </p>
        <Link to={`/lab/${encodeURIComponent(code)}`} className="btn">
          До обладнання
        </Link>
      </div>
    </Card>
  );
}

function TasksCard() {
  const q = useQuery({
    queryKey: ['tasks', { mine: true }],
    queryFn: () => unwrap(api.GET('/api/tasks', { params: { query: { mine: 'true' } } })),
  });
  const tasks = q.data ? homeTasks(q.data) : [];
  return (
    <Card>
      <h2 className={s.caption}>Мої ТЗ</h2>
      {q.isPending ? (
        <Skeleton height={120} />
      ) : q.isError ? (
        <ErrorMessage text={errorOf(q.error)} />
      ) : tasks.length === 0 ? (
        <>
          <p className="hint">Активних ТЗ немає. Вільні ТЗ — на дошці.</p>
          <Link to="/tasks" className="btn">
            До дошки ТЗ
          </Link>
        </>
      ) : (
        <>
          <ul className={s.rows} aria-label="Мої ТЗ">
            {tasks.slice(0, HOME_LIMIT).map((t) => {
              const due = dueState(t);
              return (
                <li key={t.id}>
                  <Link to={`/tasks/${t.id}`} className={s.row}>
                    <span className={s.rowMain}>
                      <span className={s.rowTitle}>{t.title}</span>
                      <span className={s.rowSub}>
                        {TASK_STATUS_LABEL[t.status]} · {t.points} {plural(t.points, ['бал', 'бали', 'балів'])}
                      </span>
                    </span>
                    <span className={`${s.due} ${s[`due_${due.tone}`] ?? ''}`}>{due.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <Link to="/tasks" className={`btn btn-ghost ${s.more}`}>
            {tasks.length > HOME_LIMIT ? `Усі мої ТЗ (${tasks.length})` : 'До дошки ТЗ'}
          </Link>
        </>
      )}
    </Card>
  );
}

/**
 * My drafts and what others published about me lately; to staff — documents
 * waiting to be frozen by hand. The rest — in «Редактор».
 */
function PapersCard({ staff }: { staff: boolean }) {
  const limit = String(HOME_LIMIT);
  const drafts = useQuery({
    queryKey: ['papers', 'list', 'home', 'drafts'],
    queryFn: () => unwrap(api.GET('/api/papers', { params: { query: { mine: 'true', status: 'draft', limit } } })),
  });
  const about = useQuery({
    queryKey: ['papers', 'list', 'home', 'about'],
    queryFn: () => unwrap(api.GET('/api/papers', { params: { query: { about: 'me', limit } } })),
  });
  const due = useQuery({
    queryKey: ['papers', 'list', 'home', 'freeze'],
    queryFn: () => unwrap(api.GET('/api/papers', { params: { query: { due: 'freeze', limit } } })),
    enabled: staff,
  });
  const error = drafts.error ?? about.error ?? due.error;
  const mine = drafts.data?.items ?? [];
  const news = about.data ? recentPapers(about.data.items) : [];
  const toFreeze = due.data?.items ?? [];
  return (
    <Card>
      <h2 className={s.caption}>Документи</h2>
      {drafts.isPending || about.isPending || (staff && due.isPending) ? (
        <Skeleton height={88} />
      ) : error ? (
        <ErrorMessage text={errorOf(error)} />
      ) : mine.length === 0 && news.length === 0 && toFreeze.length === 0 ? (
        <p className="hint">{staff ? 'Чернеток, нових документів про вас і документів до фіксації немає.' : 'Чернеток і нових документів про вас немає.'}</p>
      ) : (
        <>
          <PaperRows
            title="Зафіксувати"
            items={toFreeze}
            sub={(p) => [p.number, p.author.name, p.publishedAt && `опубліковано ${formatDate(p.publishedAt)}`].filter(Boolean).join(' · ')}
          />
          <PaperRows title="Мої чернетки" items={mine} sub={(p) => `змінено ${formatDate(p.updatedAt)}`} />
          <PaperRows
            title="Нове про мене"
            items={news}
            sub={(p) => [p.number, p.author.name, p.status === 'cancelled' ? 'скасовано' : formatDate(p.updatedAt)].filter(Boolean).join(' · ')}
          />
        </>
      )}
      <Link to="/editor" className={`btn btn-ghost ${s.more}`}>
        До Редактора
      </Link>
    </Card>
  );
}

function PaperRows({ title, items, sub }: { title: string; items: PaperItem[]; sub: (p: PaperItem) => string }) {
  if (items.length === 0) return null;
  return (
    <>
      <h3 className={s.subcaption}>{title}</h3>
      <ul className={s.rows} aria-label={title}>
        {items.map((p) => (
          <li key={p.id}>
            <Link to={`/editor/${p.id}`} className={s.row}>
              <span className={s.rowMain}>
                <span className={s.rowTitle}>{p.title}</span>
                <span className={s.rowSub}>{sub(p)}</span>
              </span>
              <Icon name="chevron" size={20} />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function BusyCard() {
  const q = useQuery({ queryKey: keys.places, queryFn: () => unwrap(api.GET('/api/places')) });
  const busy = q.data ? busyPlaces(q.data) : [];
  return (
    <Card>
      <h2 className={s.caption}>Зайняте зараз</h2>
      {q.isPending ? (
        <Skeleton height={88} />
      ) : q.isError ? (
        <ErrorMessage text={errorOf(q.error)} />
      ) : busy.length === 0 ? (
        <p className="hint">Усе обладнання вільне.</p>
      ) : (
        <ul className={s.rows} aria-label="Зайняте обладнання">
          {busy.map((p) => {
            const sessions = p.activeSessions;
            const who = sessions
              .map((x) => x.user.name)
              .filter(Boolean)
              .join(', ');
            const since = sessions[0]?.startedAt;
            return (
              <li key={p.id}>
                <Link to={`/lab/${encodeURIComponent(p.code)}`} className={s.row}>
                  <span className={s.rowMain}>
                    <span className={s.rowTitle}>{p.title}</span>
                    <span className={s.rowSub}>{[who, since && `з ${formatTime(since)}`].filter(Boolean).join(' · ')}</span>
                  </span>
                  <Icon name="chevron" size={20} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function PointsCard({ userId }: { userId: string }) {
  const points = useQuery({ queryKey: ['points', 'me'], queryFn: () => unwrap(api.GET('/api/points/me')) });
  const month = useQuery({
    queryKey: ['points', 'leaderboard', 'month'],
    queryFn: () => unwrap(api.GET('/api/points/leaderboard', { params: { query: { period: 'month' } } })),
  });
  const rank = month.data?.find((r) => r.id === userId)?.rank;
  return (
    <Card>
      <h2 className={s.caption}>Мої бали</h2>
      {points.isPending ? (
        <Skeleton height={64} />
      ) : points.isError ? (
        <ErrorMessage text={errorOf(points.error)} />
      ) : (
        <>
          <p className={s.balance}>{points.data.balance}</p>
          <p className={s.meta}>{rank ? `${rank} місце за ${currentMonthName()}` : 'Бали нараховуються, коли модератор приймає ТЗ.'}</p>
          <Link to="/rating" className={`btn btn-ghost ${s.more}`}>
            Рейтинг
          </Link>
        </>
      )}
    </Card>
  );
}

function BookingsCard() {
  const q = useQuery({ queryKey: ['bookings', 'me'], queryFn: () => unwrap(api.GET('/api/bookings/me')) });
  const items = q.data ?? [];
  return (
    <Card>
      <h2 className={s.caption}>Найближчі бронювання</h2>
      {q.isPending ? (
        <Skeleton height={88} />
      ) : q.isError ? (
        <ErrorMessage text={errorOf(q.error)} />
      ) : items.length === 0 ? (
        <p className="hint">Бронювань немає. Забронювати можна на сторінці обладнання.</p>
      ) : (
        <ul className={s.rows} aria-label="Мої бронювання">
          {items.slice(0, HOME_LIMIT).map((b) => (
            <li key={b.id}>
              <Link to={b.place.code ? `/lab/${encodeURIComponent(b.place.code)}` : '/lab'} className={s.row}>
                <span className={s.rowMain}>
                  <span className={s.rowTitle}>{b.place.title ?? 'Обладнання'}</span>
                  <span className={s.rowSub}>
                    {formatDateTime(b.startsAt)} – {formatTime(b.endsAt)}
                  </span>
                </span>
                <Icon name="chevron" size={20} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {items.length > HOME_LIMIT && <p className={s.meta}>Усі бронювання — у профілі.</p>}
    </Card>
  );
}
