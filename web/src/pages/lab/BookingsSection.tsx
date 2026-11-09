import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, unwrap } from '../../api/client';
import type { Booking, Place } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { Card, ErrorMessage, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { formatDate, formatTime } from '../../lib/format';
import { addDays, kyivDay, kyivParts, kyivToDate } from '../../lib/kyiv';
import s from './lab.module.css';

/** Free slots are offered inside working hours (Kyiv time). */
export const DAY_START = '08:00';
export const DAY_END = '22:00';
const MAX_HOURS = 12;
const MAX_DAYS_AHEAD = 60;
const STEP = 15 * 60_000;
const DAYS = 7;

export type Slot = { start: Date; end: Date; booking?: Booking };

/** Bookings of a Kyiv day and the free gaps between them (from now on today). */
export function daySlots(date: string, bookings: Booking[], now = Date.now()): Slot[] {
  const { start: dayStart, end: dayEnd } = kyivDay(date);
  const own = bookings
    .filter((b) => Date.parse(b.startsAt) < dayEnd.getTime() && Date.parse(b.endsAt) > dayStart.getTime())
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const win = { from: kyivToDate(date, DAY_START).getTime(), to: kyivToDate(date, DAY_END).getTime() };
  let cursor = Math.max(win.from, Math.ceil(now / STEP) * STEP);
  const out: Slot[] = [];
  for (const b of own) {
    const bs = Date.parse(b.startsAt);
    const be = Date.parse(b.endsAt);
    if (bs - cursor >= STEP && cursor < win.to) out.push({ start: new Date(cursor), end: new Date(Math.min(bs, win.to)) });
    out.push({ start: new Date(bs), end: new Date(be), booking: b });
    cursor = Math.max(cursor, be);
  }
  if (win.to - cursor >= STEP) out.push({ start: new Date(cursor), end: new Date(win.to) });
  return out;
}

const weekday = new Intl.DateTimeFormat('uk-UA', { weekday: 'short', timeZone: 'Europe/Kyiv' });

export function BookingsSection(props: { place: Place; today: string; bookings: Booking[] | undefined; error: unknown }) {
  const { place, today } = props;
  const { user, can } = useAuth();
  const qc = useQueryClient();
  const [day, setDay] = useState(today);
  const [form, setForm] = useState<{ date: string; from: string; to: string; note: string } | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<string | null>(null);

  const refresh = () => void qc.invalidateQueries({ queryKey: ['bookings'] });
  const create = useMutation({
    mutationFn: (f: NonNullable<typeof form>) =>
      unwrap(
        api.POST('/api/bookings', {
          body: {
            placeId: place.id,
            startsAt: kyivToDate(f.date, f.from).toISOString(),
            endsAt: kyivToDate(f.date, f.to).toISOString(),
            note: f.note.trim() || undefined,
          },
        }),
      ),
    onSuccess: (b) => {
      setForm(null);
      setDone(`Заброньовано: ${formatDate(b.startsAt)}, ${formatTime(b.startsAt)}–${formatTime(b.endsAt)}.`);
      setDay(kyivParts(b.startsAt).date);
    },
    onSettled: refresh,
  });
  const cancel = useMutation({
    mutationFn: (v: { id: string; reason?: string }) =>
      unwrap(api.POST('/api/bookings/{id}/cancel', { params: { path: { id: v.id } }, body: { reason: v.reason } })),
    onSuccess: () => {
      setCancelId(null);
      setReason('');
    },
    onSettled: refresh,
  });

  const blockedByAuth = place.needsAuthorization && !place.myAuthorization && !can('places.authorize');
  const canBook = place.status !== 'archived' && !blockedByAuth;
  const bookings = props.bookings ?? [];
  const slots = daySlots(day, bookings);
  const days = Array.from({ length: DAYS }, (_, i) => addDays(today, i));

  const openForm = (slot?: Slot) => {
    setDone(null);
    const start = slot?.start ?? new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000);
    const end = slot ? new Date(Math.min(slot.end.getTime(), slot.start.getTime() + 2 * 3_600_000)) : new Date(start.getTime() + 3_600_000);
    const a = kyivParts(start);
    setForm({ date: slot ? a.date : day < a.date ? a.date : day, from: a.time, to: kyivParts(end).time, note: '' });
  };

  const formError = (() => {
    if (!form) return null;
    if (!form.date || !form.from || !form.to) return 'Вкажіть дату й час.';
    const a = kyivToDate(form.date, form.from).getTime();
    const b = kyivToDate(form.date, form.to).getTime();
    if (b <= a) return 'Кінець має бути пізніше за початок.';
    if (b - a > MAX_HOURS * 3_600_000) return `Бронювання — не довше ${MAX_HOURS} годин.`;
    return null;
  })();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (form && !formError) create.mutate(form);
  };

  return (
    <Card>
      <section id="bookings" aria-labelledby="bookings-title" className={s.form}>
        <div className={s.sectionHead}>
          <h2 id="bookings-title" className={s.caption}>
            Бронювання
          </h2>
          {canBook && !form && (
            <button type="button" className="btn" onClick={() => openForm()}>
              Забронювати
            </button>
          )}
        </div>
        {blockedByAuth && <p className="hint">Бронювати можна лише обладнання, до якого є допуск.</p>}
        {done && (
          <p role="status" className={s.okBox}>
            {done}
          </p>
        )}

        {form && (
          <form className={s.bookingForm} onSubmit={submit} noValidate>
            <div className="field">
              <label htmlFor="bk-date">Дата</label>
              <input
                id="bk-date"
                type="date"
                min={today}
                max={addDays(today, MAX_DAYS_AHEAD)}
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>
            <div className={s.timeRow}>
              <div className="field">
                <label htmlFor="bk-from">З</label>
                <input id="bk-from" type="time" step={900} value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="bk-to">До</label>
                <input id="bk-to" type="time" step={900} value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="bk-note">Для чого (необов’язково)</label>
              <input id="bk-note" maxLength={500} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>
            <p className="hint">Київський час. До {MAX_HOURS} годин, не далі ніж на {MAX_DAYS_AHEAD} днів уперед.</p>
            <ErrorMessage text={formError ?? (create.isError ? errorOf(create.error) : null)} />
            <div className={s.actions}>
              <button type="submit" className="btn btn-primary" disabled={!!formError || create.isPending}>
                {create.isPending ? 'Бронюємо…' : 'Забронювати'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>
                Скасувати
              </button>
            </div>
          </form>
        )}

        <div className={s.week} role="group" aria-label="День">
          {days.map((d) => {
            const n = daySlots(d, bookings, 0).filter((x) => x.booking).length;
            const date = kyivDay(d).start;
            return (
              <button key={d} type="button" className={s.day} aria-pressed={d === day} onClick={() => setDay(d)}>
                <span className={s.dayName}>{d === today ? 'Сьогодні' : weekday.format(date)}</span>
                <span className={s.dayNum}>{Number(d.slice(8))}</span>
                <span className={n ? s.dot : s.dotEmpty} aria-label={n ? `${n} бронювань` : undefined} />
              </button>
            );
          })}
        </div>

        {props.bookings === undefined && !props.error ? (
          <Skeleton height={96} />
        ) : props.error ? (
          <ErrorMessage text={errorOf(props.error)} />
        ) : (
          <ul className={s.slots} aria-label={`Бронювання на ${formatDate(kyivDay(day).start)}`}>
            {slots.length === 0 && <li className="hint">На цей день вільного часу вже немає.</li>}
            {slots.map((sl) => {
              const b = sl.booking;
              const time = `${formatTime(sl.start)}–${formatTime(sl.end)}`;
              if (!b) {
                return (
                  <li key={`free-${sl.start.getTime()}`}>
                    <button type="button" className={s.freeSlot} disabled={!canBook} onClick={() => openForm(sl)}>
                      <span className={s.slotTime}>{time}</span>
                      <span>Вільно</span>
                    </button>
                  </li>
                );
              }
              const mine = b.user.id === user?.id;
              const past = Date.parse(b.endsAt) <= Date.now();
              const canCancel = !past && (mine || can('bookings.cancel_any'));
              return (
                <li key={b.id} className={`${s.slot} ${mine ? s.slotMine : s.slotOther} ${past ? s.slotPast : ''}`}>
                  <span className={s.slotTime}>{time}</span>
                  <span className={s.slotWho}>
                    {mine ? 'Ви' : b.user.name}
                    {past && ' · минуло'}
                    {b.note && <span className={s.rowSub}>{b.note}</span>}
                  </span>
                  {canCancel && cancelId !== b.id && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => (mine ? cancel.mutate({ id: b.id }) : setCancelId(b.id))}
                      disabled={cancel.isPending}
                    >
                      Скасувати
                    </button>
                  )}
                  {cancelId === b.id && (
                    <form
                      className={s.cancelForm}
                      onSubmit={(e) => {
                        e.preventDefault();
                        cancel.mutate({ id: b.id, reason: reason.trim() });
                      }}
                    >
                      <div className="field">
                        <label htmlFor={`cr-${b.id}`}>Причина скасування</label>
                        <input id={`cr-${b.id}`} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
                      </div>
                      <div className={s.actions}>
                        <button type="submit" className="btn btn-danger" disabled={!reason.trim() || cancel.isPending}>
                          Скасувати бронювання
                        </button>
                        <button type="button" className="btn btn-ghost" onClick={() => setCancelId(null)}>
                          Назад
                        </button>
                      </div>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <ErrorMessage text={cancel.isError ? errorOf(cancel.error) : null} />
      </section>
    </Card>
  );
}
