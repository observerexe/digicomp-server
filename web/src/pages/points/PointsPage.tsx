import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { api, unwrap } from '../../api/client';
import type { Me, PointsHistoryEntry } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { Card, ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { formatDate, formatPoints } from '../../lib/format';
import { pointsReason } from '../../lib/labels';
import { mergeReversals } from '../profile/ProfilePage';
import { MemberSelect } from './MemberSelect';
import s from './points.module.css';

/** Manual award can be revoked: admin any, moderator own (API: PointsRevoke). */
export function canRevokeEntry(e: PointsHistoryEntry, me: Me): boolean {
  return e.kind === 'manual' && !e.revoked && (me.role === 'admin' || e.createdBy?.id === me.id);
}

/** Staff: award points for chores and see/revoke a member's history. */
export function PointsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const userId = params.get('user') ?? '';
  const [amount, setAmount] = useState('10');
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState('');

  const history = useQuery({
    queryKey: ['points', 'user', userId],
    enabled: !!userId,
    queryFn: () => unwrap(api.GET('/api/points/users/{userId}', { params: { path: { userId } } })),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['points'] });
  const award = useMutation({
    mutationFn: () => unwrap(api.POST('/api/points/award', { body: { userId, amount: Number(amount), reason: reason.trim() } })),
    onSuccess: (e) => {
      setDone(`Нараховано ${formatPoints(e.amount)}.`);
      setReason('');
      refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => unwrap(api.POST('/api/points/{entryId}/revoke', { params: { path: { entryId: id } }, body: { reason: revokeReason.trim() } })),
    onSuccess: () => {
      setRevoking(null);
      setRevokeReason('');
      refresh();
    },
  });

  const n = Number(amount);
  const invalid = !userId || !Number.isInteger(n) || n < 1 || n > 1000 || !reason.trim();
  if (!user) return null;

  return (
    <>
      <PageHeader title="Бали" />
      <div className={s.columns}>
        <Card>
          <form
            className={s.form}
            noValidate
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (!invalid) award.mutate();
            }}
          >
            <h2 className={s.caption}>Нарахувати</h2>
            <MemberSelect
              id="pt-user"
              label="Кому"
              value={userId}
              onChange={(id) => {
                setDone(null);
                setParams(id ? { user: id } : {}, { replace: true });
              }}
            />
            <div className="field">
              <label htmlFor="pt-amount">Скільки балів</label>
              <input id="pt-amount" type="number" inputMode="numeric" min={1} max={1000} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="pt-reason">За що</label>
              <input id="pt-reason" maxLength={500} placeholder="Чергування, прибирання складу…" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <p className="hint">Від 1 до 1000. Бали за ТЗ нараховуються самі, коли ТЗ прийнято.</p>
            {done && (
              <p role="status" className={s.ok}>
                {done}
              </p>
            )}
            <ErrorMessage text={award.isError ? errorOf(award.error) : null} />
            <button type="submit" className="btn btn-primary" disabled={invalid || award.isPending}>
              Нарахувати
            </button>
          </form>
        </Card>
        <Card>
          <h2 className={s.caption}>Історія учасника</h2>
          {!userId ? (
            <p className="hint">Виберіть учасника, щоб побачити баланс і записи.</p>
          ) : history.isPending ? (
            <Skeleton height={160} />
          ) : history.isError ? (
            <ErrorMessage text={errorOf(history.error)} />
          ) : (
            <>
              <p className={s.balance}>{history.data.balance}</p>
              <ErrorMessage text={revoke.isError ? errorOf(revoke.error) : null} />
              <ul className={s.list} aria-label="Історія учасника">
                {mergeReversals(history.data.history).map((e) => (
                  <li key={e.id} className={s.entry}>
                    <span className={s.who}>
                      {pointsReason(e)}
                      <span className={s.sub}>
                        {formatDate(e.createdAt)} · {e.createdBy?.name ?? 'Система'}
                        {e.revoked && (e.revokeReason ? ` · знято: ${e.revokeReason}` : ' · знято')}
                      </span>
                    </span>
                    <span className={`${s.amount} ${e.revoked ? s.revoked : e.amount < 0 ? s.minus : s.plus}`}>{formatPoints(e.amount)}</span>
                    {canRevokeEntry(e, user) && revoking !== e.id && (
                      <button type="button" className="btn btn-ghost" onClick={() => setRevoking(e.id)}>
                        Зняти
                      </button>
                    )}
                    {revoking === e.id && (
                      <form
                        className={s.inline}
                        onSubmit={(ev) => {
                          ev.preventDefault();
                          revoke.mutate(e.id);
                        }}
                      >
                        <div className="field">
                          <label htmlFor={`rv-${e.id}`}>Причина зняття</label>
                          <input id={`rv-${e.id}`} maxLength={500} value={revokeReason} onChange={(ev) => setRevokeReason(ev.target.value)} />
                        </div>
                        <div className={s.actions}>
                          <button type="submit" className="btn btn-danger" disabled={!revokeReason.trim() || revoke.isPending}>
                            Зняти {formatPoints(e.amount)}
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
            </>
          )}
        </Card>
      </div>
    </>
  );
}
