import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { api, unwrap } from '../../api/client';
import type { DisciplineRecord, DisciplineType, Me } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { Card, ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { formatDate } from '../../lib/format';
import { disciplineTitle } from '../../lib/labels';
import { MemberSelect } from './MemberSelect';
import s from './points.module.css';

const TYPES: { value: DisciplineType; label: string }[] = [
  { value: 'warning', label: 'Попередження' },
  { value: 'fine', label: 'Штраф' },
  { value: 'reprimand', label: 'Догана' },
];
type State = 'active' | 'revoked' | 'all';

/** Admin revokes any record, a moderator only own (API: DisciplineRevoke). */
export function canRevokeRecord(r: DisciplineRecord, me: Me): boolean {
  return !r.revoked && (me.role === 'admin' || r.issuedBy?.id === me.id);
}

/** Staff: discipline table with filters, issue and revoke with a reason. */
export function DisciplinePage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const filterUser = params.get('user') ?? '';
  const [state, setState] = useState<State>('active');
  const [form, setForm] = useState({ userId: filterUser, type: 'warning' as DisciplineType, amount: '10', reason: '' });
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState('');

  const list = useQuery({
    queryKey: ['discipline', 'list', filterUser, state],
    queryFn: () =>
      unwrap(api.GET('/api/discipline', { params: { query: { state, limit: '100', ...(filterUser ? { userId: filterUser } : {}) } } })),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['discipline'] });
    void qc.invalidateQueries({ queryKey: ['points'] });
  };
  const issue = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/api/discipline', {
          body: {
            userId: form.userId,
            type: form.type,
            reason: form.reason.trim(),
            ...(form.type === 'fine' ? { amount: Number(form.amount) } : {}),
          },
        }),
      ),
    onSuccess: () => {
      setForm((f) => ({ ...f, reason: '' }));
      refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => unwrap(api.POST('/api/discipline/{id}/revoke', { params: { path: { id } }, body: { reason: revokeReason.trim() } })),
    onSuccess: () => {
      setRevoking(null);
      setRevokeReason('');
      refresh();
    },
  });

  const amount = Number(form.amount);
  const invalid =
    !form.userId || !form.reason.trim() || (form.type === 'fine' && (!Number.isInteger(amount) || amount < 1 || amount > 1000));
  if (!user) return null;

  return (
    <>
      <PageHeader title="Дисципліна" />
      <div className={s.columns}>
        <Card>
          <form
            className={s.form}
            noValidate
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (!invalid) issue.mutate();
            }}
          >
            <h2 className={s.caption}>Видати</h2>
            <MemberSelect id="dc-user" label="Кому" value={form.userId} onChange={(id) => setForm({ ...form, userId: id })} />
            <fieldset className={s.types}>
              <legend>Тип</legend>
              {TYPES.map((t) => (
                <label key={t.value} className={s.typeOption}>
                  <input type="radio" name="dc-type" value={t.value} checked={form.type === t.value} onChange={() => setForm({ ...form, type: t.value })} />
                  {t.label}
                </label>
              ))}
            </fieldset>
            {form.type === 'fine' && (
              <div className="field">
                <label htmlFor="dc-amount">Скільки балів зняти</label>
                <input id="dc-amount" type="number" inputMode="numeric" min={1} max={1000} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
            )}
            <div className="field">
              <label htmlFor="dc-reason">Причина</label>
              <textarea id="dc-reason" maxLength={1000} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </div>
            <p className="hint">Учасник бачить запис у своєму профілі разом з тим, хто його видав. Інші не бачать.</p>
            <ErrorMessage text={issue.isError ? errorOf(issue.error) : null} />
            <button type="submit" className="btn btn-primary" disabled={invalid || issue.isPending}>
              Видати
            </button>
          </form>
        </Card>
        <Card>
          <div className={s.filters}>
            <MemberSelect id="dc-filter" label="Учасник" allowAll value={filterUser} onChange={(id) => setParams(id ? { user: id } : {}, { replace: true })} />
            <div className="field">
              <label htmlFor="dc-state">Стан</label>
              <select id="dc-state" value={state} onChange={(e) => setState(e.target.value as State)}>
                <option value="active">Діють</option>
                <option value="revoked">Зняті</option>
                <option value="all">Усі</option>
              </select>
            </div>
          </div>
          <ErrorMessage text={revoke.isError ? errorOf(revoke.error) : null} />
          {list.isPending ? (
            <Skeleton height={160} />
          ) : list.isError ? (
            <ErrorMessage text={errorOf(list.error)} />
          ) : list.data.items.length === 0 ? (
            <p className="hint">Записів немає.</p>
          ) : (
            <ul className={s.list} aria-label="Записи дисципліни">
              {list.data.items.map((r) => (
                <li key={r.id} className={`${s.record} ${r.revoked ? s.recordRevoked : ''}`}>
                  <span className={s.who}>
                    <span>
                      <b>{r.user?.name}</b> · {disciplineTitle(r)}
                    </span>
                    <span>{r.reason}</span>
                    <span className={s.sub}>
                      {formatDate(r.createdAt)} · видав {r.issuedBy?.name}
                      {r.revoked && ` · знято ${r.revokedAt ? formatDate(r.revokedAt) : ''}${r.revokeReason ? `: ${r.revokeReason}` : ''}`}
                    </span>
                  </span>
                  {canRevokeRecord(r, user) && revoking !== r.id && (
                    <button type="button" className="btn btn-ghost" onClick={() => setRevoking(r.id)}>
                      Зняти
                    </button>
                  )}
                  {revoking === r.id && (
                    <form
                      className={s.inline}
                      onSubmit={(e) => {
                        e.preventDefault();
                        revoke.mutate(r.id);
                      }}
                    >
                      <div className="field">
                        <label htmlFor={`dr-${r.id}`}>Причина зняття</label>
                        <input id={`dr-${r.id}`} maxLength={500} value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} />
                      </div>
                      <div className={s.actions}>
                        <button type="submit" className="btn btn-danger" disabled={!revokeReason.trim() || revoke.isPending}>
                          Зняти запис
                        </button>
                        <button type="button" className="btn btn-ghost" onClick={() => setRevoking(null)}>
                          Назад
                        </button>
                      </div>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
