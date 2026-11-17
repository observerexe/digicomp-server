import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { api, ApiError, unwrap } from '../../api/client';
import type { Booking, Me, Place } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { QrCode } from '../../components/QrCode';
import { Related } from '../../components/Related';
import { TrashButton } from '../../components/TrashButton';
import { Card, ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { CATEGORY, itemTitle, useDictionary } from '../../lib/dictionaries';
import { formatDate, formatDateTime, formatDuration, formatTime, sentence } from '../../lib/format';
import { kyivDay, kyivParts, addDays } from '../../lib/kyiv';
import { placeUrl } from '../../lib/scan';
import { AuthorizationsSection } from './AuthorizationsSection';
import { BookingsSection } from './BookingsSection';
import { FaultsSection } from './FaultsSection';
import { PlaceState } from './LabPage';
import { keys, newActionKey, useActiveSession, usePlace } from './queries';
import s from './lab.module.css';

/** Days of bookings loaded with the page: today and the next 7. */
export const BOOKING_DAYS = 8;

/** Equipment page (approved mockup): state, start/end, bookings, faults, history, related records. */
export function EquipmentPage() {
  const { code = '' } = useParams();
  const { user, can } = useAuth();
  const place = usePlace(code);
  const categories = useDictionary(CATEGORY.place);
  const [showQr, setShowQr] = useState(false);

  const today = kyivParts(new Date()).date;
  const placeId = place.data?.id ?? '';
  const bookings = useQuery({
    queryKey: keys.bookings(placeId, today),
    enabled: !!placeId,
    queryFn: () =>
      unwrap(
        api.GET('/api/places/{id}/bookings', {
          params: {
            path: { id: placeId },
            query: { from: kyivDay(today).start.toISOString(), to: kyivDay(addDays(today, BOOKING_DAYS - 1)).end.toISOString() },
          },
        }),
      ),
  });

  const back = (
    <Link to="/lab" className="btn btn-ghost">
      <Icon name="back" size={20} />
      Лабораторія
    </Link>
  );

  if (place.isPending) {
    return (
      <>
        {back}
        <Skeleton height={64} />
        <div className={s.columns}>
          <Skeleton height={240} />
          <Skeleton height={240} />
        </div>
      </>
    );
  }
  if (place.isError) {
    const err = place.error instanceof ApiError ? place.error : null;
    // A sticker of deleted equipment still leads here.
    if (err?.code === 'PLACE_DELETED') {
      return (
        <>
          {back}
          <PageHeader title="Обладнання видалено" />
          <p className="hint">Наліпку можна зняти. Якщо обладнання видалили помилково, модератор відновить його з кошика.</p>
        </>
      );
    }
    const gone = err?.status === 404;
    return (
      <>
        {back}
        <PageHeader title={gone ? 'Обладнання не знайдено' : 'Не вдалося відкрити'} />
        <ErrorMessage text={gone ? 'Перевірте QR-код або виберіть обладнання зі списку.' : errorOf(place.error)} />
      </>
    );
  }

  const p = place.data;
  return (
    <>
      {back}
      <PageHeader title={p.title}>
        <PlaceState place={p} />
      </PageHeader>
      <p className={s.meta}>
        {[itemTitle(categories.data, p.category), p.location, `код ${p.code}`, p.needsAuthorization ? 'потрібен допуск' : 'без допуску'].filter(Boolean).join(' · ')}
      </p>
      {p.description && <p className={s.description}>{p.description}</p>}
      <div className={s.actions}>
        <button type="button" className="btn btn-ghost" aria-expanded={showQr} onClick={() => setShowQr((v) => !v)}>
          QR-код
        </button>
        {can('places.manage') && (
          <Link to={`/lab/${encodeURIComponent(p.code)}/edit`} className="btn btn-ghost">
            Редагувати
          </Link>
        )}
      </div>
      {showQr && (
        <div className={s.qrBox}>
          <QrCode value={placeUrl(location.origin, p.code)} label={`QR-код ${p.title}`} size={180} />
          <span className={s.code}>{p.code}</span>
        </div>
      )}

      <div className={s.columns}>
        <div className={s.column}>
          {user && <SessionPanel place={p} bookings={bookings.data ?? []} me={user} />}
          <BookingsSection place={p} today={today} bookings={bookings.data} error={bookings.error} />
        </div>
        <div className={s.column}>
          <FaultsSection place={p} />
          {can('places.authorize') && p.needsAuthorization && <AuthorizationsSection place={p} />}
          <RecentSessions code={p.code} />
          <Related type="place" id={p.id} />
          {can('places.manage') && (
            <div className={s.actions}>
              <TrashButton
                question={`Видалити «${p.title}» у кошик? Майбутні бронювання скасуються.`}
                remove={() => unwrap(api.DELETE('/api/places/{id}', { params: { path: { id: p.id } } }))}
                own={keys.place(code)}
                lists={['places']}
                to="/lab"
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function SessionPanel({ place, bookings, me }: { place: Place; bookings: Booking[]; me: Me }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const active = useActiveSession();
  const [safety, setSafety] = useState(false);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['work-sessions'] });
    void qc.invalidateQueries({ queryKey: ['places'] });
  };
  const start = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/api/places/{id}/sessions', {
          params: { path: { id: place.id } },
          body: { safetyConfirmed: true, idempotencyKey: newActionKey() },
        }),
      ),
    onSuccess: () => setSafety(false),
    onSettled: refresh,
  });
  const end = useMutation({
    mutationFn: (v: { id: string; note?: string; reason?: string }) =>
      unwrap(api.PATCH('/api/work-sessions/{id}/end', { params: { path: { id: v.id } }, body: { note: v.note, reason: v.reason } })),
    onSuccess: () => {
      setNote('');
      setReason('');
    },
    onSettled: refresh,
  });

  const mine = active.data && active.data.place.id === place.id ? active.data : null;
  const elsewhere = active.data && !mine ? active.data : null;
  const now = Date.now();
  const today = kyivParts(now).date;
  const foreign = bookings.filter((b) => b.user.id !== me.id);
  const bookedNow = foreign.find((b) => Date.parse(b.startsAt) <= now && Date.parse(b.endsAt) > now);
  const bookedLater = foreign.find((b) => Date.parse(b.startsAt) > now && kyivParts(b.startsAt).date === today);
  const others = place.activeSessions.filter((x) => x.user.id !== me.id);
  const busy = place.exclusive && others.length > 0;
  const needAuth = place.needsAuthorization && !place.myAuthorization && !can('places.authorize');
  const slotBlocked = !!bookedNow && !can('sessions.ignore_booking');
  const error = start.error ?? end.error;

  if (place.status === 'maintenance') {
    return (
      <Card>
        <p className={s.warn}>Обладнання на обслуговуванні. Працювати можна буде, коли модератор поверне його в роботу.</p>
      </Card>
    );
  }

  if (mine) {
    return (
      <Card>
        <form
          className={s.form}
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            end.mutate({ id: mine.id, note: note.trim() || undefined });
          }}
        >
          <p className={s.working}>
            <span className={s.pulse} aria-hidden="true" /> Ви працюєте з {formatTime(mine.startedAt)}
          </p>
          <div className="field">
            <label htmlFor="end-note">Нотатка (необов’язково)</label>
            <textarea id="end-note" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <ErrorMessage text={error ? errorOf(error) : null} />
          <button type="submit" className="btn btn-primary" disabled={end.isPending}>
            {end.isPending ? 'Завершуємо…' : 'Завершити роботу'}
          </button>
          <a href="#faults" className="hint">
            Щось не так з обладнанням? Повідомте про несправність.
          </a>
        </form>
      </Card>
    );
  }

  return (
    <Card>
      <div className={s.form}>
        {place.myAuthorization ? (
          <p className={s.okLine}>
            {place.myAuthorization.expiresAt ? sentence(`Ваш допуск діє до ${formatDate(place.myAuthorization.expiresAt)}`) : 'Ваш допуск безстроковий.'}
          </p>
        ) : (
          needAuth && <p className={s.warn}>Для роботи потрібен допуск. Його видає модератор після інструктажу.</p>
        )}
        {busy &&
          others.map((o) => (
            <p key={o.id} className={s.warn}>
              Зараз працює {o.user.name} з {formatTime(o.startedAt)}.
            </p>
          ))}
        {bookedNow && (
          <p className={s.warn}>
            Зараз бронювання: {bookedNow.user.name} до {formatTime(bookedNow.endsAt)}.
            {!slotBlocked && ' Ви адміністратор і можете почати попри бронювання.'}
          </p>
        )}
        {!bookedNow && bookedLater && (
          <p className={s.info}>
            О {formatTime(bookedLater.startsAt)} забронював(-ла) {bookedLater.user.name}. Працювати можна до{' '}
            {formatTime(Date.parse(bookedLater.startsAt) - 5 * 60_000)}.
          </p>
        )}
        {elsewhere && (
          <p className={s.warn}>
            У вас уже триває сеанс на{' '}
            <Link to={`/lab/${encodeURIComponent(elsewhere.place.code ?? '')}`}>{elsewhere.place.title}</Link>. Спершу завершіть його.
          </p>
        )}
        <label className={s.check}>
          <input type="checkbox" checked={safety} onChange={(e) => setSafety(e.target.checked)} />
          Я ознайомився(-лася) з інструкцією з безпеки і маю засоби захисту
        </label>
        <ErrorMessage text={error ? errorOf(error) : null} />
        <button
          type="button"
          className={`btn btn-primary ${s.big}`}
          disabled={!safety || start.isPending || needAuth || busy || slotBlocked || !!elsewhere}
          onClick={() => start.mutate()}
        >
          {start.isPending ? 'Починаємо…' : 'Почати роботу'}
        </button>
        <p className="hint">Час початку й кінця ставить сервер.</p>

        {busy && can('sessions.end_other') && (
          <form
            className={s.staffBox}
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              end.mutate({ id: others[0]!.id, reason: reason.trim() });
            }}
          >
            <div className="field">
              <label htmlFor="end-reason">Причина завершення чужого сеансу</label>
              <input id="end-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <button type="submit" className="btn btn-danger" disabled={!reason.trim() || end.isPending}>
              Завершити сеанс {others[0]!.user.name}
            </button>
          </form>
        )}
      </div>
    </Card>
  );
}

function RecentSessions({ code }: { code: string }) {
  const q = useQuery({
    queryKey: keys.recent(code),
    queryFn: () => unwrap(api.GET('/api/places/{id}/sessions/recent', { params: { path: { id: code } } })),
  });
  return (
    <Card>
      <h2 className={s.caption}>Останні сеанси</h2>
      {q.isPending ? (
        <Skeleton height={64} />
      ) : q.isError ? (
        <ErrorMessage text={errorOf(q.error)} />
      ) : q.data.length === 0 ? (
        <p className="hint">Тут ще ніхто не працював.</p>
      ) : (
        <ul className={s.rows} aria-label="Останні сеанси">
          {q.data.map((r) => (
            <li key={r.id} className={s.row}>
              <Avatar name={r.user.name} url={r.user.avatarUrl} size={32} />
              <span className={s.rowMain}>
                <span className={s.rowTitle}>{r.user.name ?? 'Учасник'}</span>
                <span className={s.rowSub}>
                  {formatDateTime(r.startedAt)}
                  {r.endedAt ? `–${formatTime(r.endedAt)}` : ' · триває'}
                  {r.autoClosed && ' · закрито автоматично'}
                </span>
              </span>
              {r.endedAt && <span className={s.duration}>{formatDuration(r.startedAt, r.endedAt)}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
