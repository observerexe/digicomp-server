import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, unwrap } from '../../api/client';
import type { Authorization } from '../../api/types';
import { Card, ConfirmButton, ErrorMessage, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { formatDate } from '../../lib/format';
import { kyivDay, kyivParts } from '../../lib/kyiv';
import s from './lab.module.css';

/** Either the member's допуски (panel) or the equipment's (equipment page). */
type Scope = { user: { id: string; name: string; active: boolean } } | { place: { id: string; title: string; status: string } };

export const authKey = (scope: Scope) =>
  'user' in scope ? (['place-authorizations', 'user', scope.user.id] as const) : (['place-authorizations', 'place', scope.place.id] as const);

/** «Діє до» a picked day means the whole day by Kyiv time. */
export function expiresAtFor(day: string): string {
  return new Date(kyivDay(day).end.getTime() - 1000).toISOString();
}

/** Staff (places.authorize): list, grant (a repeat updates the term), revoke. */
export function AuthorizationsSection(scope: Scope) {
  const qc = useQueryClient();
  const byUser = 'user' in scope;
  const q = useQuery({
    queryKey: authKey(scope),
    queryFn: () =>
      unwrap(api.GET('/api/place-authorizations', { params: { query: byUser ? { userId: scope.user.id } : { placeId: scope.place.id } } })),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['place-authorizations'] });
    void qc.invalidateQueries({ queryKey: ['places'] });
  };
  const revoke = useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/api/place-authorizations/{id}', { params: { path: { id } } })),
    onSettled: refresh,
  });
  const canGrant = byUser ? scope.user.active : scope.place.status !== 'archived';

  return (
    <Card>
      <section aria-labelledby="auth-title" className={s.form}>
        <h2 id="auth-title" className={s.caption}>
          Допуски
        </h2>
        {q.isPending ? (
          <Skeleton height={64} />
        ) : q.isError ? (
          <ErrorMessage text={errorOf(q.error)} />
        ) : q.data.length === 0 ? (
          <p className="hint">{byUser ? 'Допусків до обладнання ще немає.' : 'Допуску ще не має ніхто.'}</p>
        ) : (
          <ul className={s.rows} aria-label="Видані допуски">
            {q.data.map((a) => (
              <AuthRow key={a.id} a={a} byUser={byUser} busy={revoke.isPending} onRevoke={() => revoke.mutate(a.id)} />
            ))}
          </ul>
        )}
        <ErrorMessage text={revoke.isError ? errorOf(revoke.error) : null} />
        {canGrant && <GrantForm scope={scope} onDone={refresh} />}
      </section>
    </Card>
  );
}

function AuthRow({ a, byUser, busy, onRevoke }: { a: Authorization; byUser: boolean; busy: boolean; onRevoke: () => void }) {
  const title = byUser ? a.place.title : a.user.name;
  return (
    <li className={s.row}>
      <span className={s.rowMain}>
        <span className={s.rowTitle}>
          {byUser ? <Link to={`/lab/${encodeURIComponent(a.place.code)}`}>{title}</Link> : <Link to={`/panel/users/${a.user.id}`}>{title}</Link>}{' '}
          {a.expired && <span className={`${s.badge} ${s.badgeBusy}`}>Прострочено</span>}
        </span>
        <span className={s.rowSub}>
          {[a.expiresAt ? `до ${formatDate(a.expiresAt)}` : 'безстроково', `видано ${formatDate(a.grantedAt)}`, a.note].filter(Boolean).join(' · ')}
        </span>
      </span>
      <ConfirmButton label="Відкликати" question={`Відкликати допуск «${title}»?`} danger disabled={busy} onConfirm={onRevoke} />
    </li>
  );
}

function GrantForm({ scope, onDone }: { scope: Scope; onDone: () => void }) {
  const byUser = 'user' in scope;
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState('');
  const [until, setUntil] = useState('');
  const [note, setNote] = useState('');
  const options = useQuery({
    queryKey: ['place-authorizations', 'options', byUser ? 'places' : 'users'],
    enabled: open,
    queryFn: async () =>
      byUser
        ? (await unwrap(api.GET('/api/places'))).filter((p) => p.status !== 'archived').map((p) => ({ id: p.id, label: `${p.title} (${p.code})` }))
        : (await unwrap(api.GET('/api/users', { params: { query: { limit: '100', active: 'true' } } }))).items.map((u) => ({
            id: u.id,
            label: u.position ? `${u.name} — ${u.position}` : u.name,
          })),
  });
  const grant = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/api/place-authorizations', {
          body: {
            userId: byUser ? scope.user.id : target,
            placeId: byUser ? target : scope.place.id,
            ...(until ? { expiresAt: expiresAtFor(until) } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
          },
        }),
      ),
    onSuccess: () => {
      setTarget('');
      setUntil('');
      setNote('');
      setOpen(false);
      onDone();
    },
  });
  const today = kyivParts(new Date()).date;

  if (!open) {
    return (
      <span className={s.actions}>
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          Видати допуск
        </button>
      </span>
    );
  }
  const list = options.data ?? [];
  return (
    <form
      className={s.staffBox}
      noValidate
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (target) grant.mutate();
      }}
    >
      <div className="field">
        <label htmlFor="auth-target">{byUser ? 'Обладнання' : 'Учасник'}</label>
        <select id="auth-target" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">{options.isPending ? 'Завантажуємо…' : byUser ? 'Виберіть обладнання' : 'Виберіть учасника'}</option>
          {list.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="auth-until">Діє до (необов’язково)</label>
        <input id="auth-until" type="date" min={today} value={until} onChange={(e) => setUntil(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="auth-note">Примітка</label>
        <input id="auth-note" maxLength={500} placeholder="Інструктаж 10.11, провів Олег" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <p className="hint">Повторна видача того самого допуску оновлює термін.</p>
      <ErrorMessage text={grant.isError ? errorOf(grant.error) : options.isError ? errorOf(options.error) : null} />
      <span className={s.actions}>
        <button type="submit" className="btn btn-primary" disabled={!target || grant.isPending}>
          Видати
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
          Скасувати
        </button>
      </span>
    </form>
  );
}
