import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { api, unwrap } from '../../api/client';
import type { Me, PointsHistoryEntry } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { ChoiceButton } from '../../components/ChoiceButton';
import { Card, ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { formatDate, formatPoints } from '../../lib/format';
import { pointsReason } from '../../lib/labels';
import { templateChoices, useNewPaper, usePaperForRecord, useTemplates } from '../../lib/paperTemplates';
import { EntryPaper, mergeReversals } from '../profile/ProfilePage';
import { MemberSelect } from '../../components/MemberSelect';
import s from './points.module.css';

/**
 * A manual award made before documents can be revoked here: admin any,
 * moderator own (API: PointsRevoke). One from «Відомість балів» — only by
 * cancelling the document. The same may give such an award its document.
 */
export function canRevokeEntry(e: PointsHistoryEntry, me: Me): boolean {
  return e.kind === 'manual' && !e.revoked && !e.paper && (me.role === 'admin' || e.createdBy?.id === me.id);
}

/**
 * Staff: a member's balance and history. Points are awarded by «Відомість
 * балів» (a document: a row — an award) and revoked by cancelling it; here —
 * revoking awards made before documents, or giving them their document.
 */
export function PointsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const userId = params.get('user') ?? '';
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const templates = useTemplates();
  const newPaper = useNewPaper();
  const forRecord = usePaperForRecord('points');
  const awardChoices = templateChoices(templates.data, { creates: 'points_entry' });

  const history = useQuery({
    queryKey: ['points', 'user', userId],
    enabled: !!userId,
    queryFn: () => unwrap(api.GET('/api/points/users/{userId}', { params: { path: { userId } } })),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => unwrap(api.POST('/api/points/{entryId}/revoke', { params: { path: { entryId: id } }, body: { reason: revokeReason.trim() } })),
    onSuccess: () => {
      setRevoking(null);
      setRevokeReason('');
      void qc.invalidateQueries({ queryKey: ['points'] });
    },
  });

  if (!user) return null;

  return (
    <>
      <PageHeader title="Бали">
        <ChoiceButton
          label="Нова відомість"
          choices={awardChoices}
          disabled={templates.isPending || newPaper.isPending}
          emptyNote="Немає шаблону, що нараховує бали: його додають у «Редактор» → «Шаблони»."
          // With a member chosen — they are in the first row.
          onPick={(templateId) => templateId && newPaper.mutate({ templateId, ...(userId ? { about: { type: 'user', id: userId } } : {}) })}
        />
      </PageHeader>
      <Card>
        <p className="hint">
          Бали за чергування й іншу роботу нараховують «Відомістю балів» у Редакторі: рядок — нарахування. Зняти — «Скасувати документ» у відомості. Нараховане до документів
          знімається тут, а «Створити документ» оформлює його відомістю. Бали за ТЗ нараховуються самі, коли ТЗ прийнято.
        </p>
        <div className={s.filters}>
          <MemberSelect excludeSelf id="pt-user" label="Учасник" value={userId} onChange={(id) => setParams(id ? { user: id } : {}, { replace: true })} />
        </div>
        <ErrorMessage text={[newPaper, forRecord, templates].map((q) => (q.isError ? errorOf(q.error) : null)).find(Boolean) ?? null} />
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
                      <EntryPaper e={e} />
                      {e.revoked && (e.revokeReason ? ` · знято: ${e.revokeReason}` : ' · знято')}
                    </span>
                  </span>
                  <span className={`${s.amount} ${e.revoked ? s.revoked : e.amount < 0 ? s.minus : s.plus}`}>{formatPoints(e.amount)}</span>
                  {canRevokeEntry(e, user) && revoking !== e.id && (
                    <span className={s.actions}>
                      <ChoiceButton
                        label="Створити документ"
                        className="btn btn-ghost"
                        choices={awardChoices}
                        disabled={forRecord.isPending}
                        onPick={(templateId) => templateId && forRecord.mutate({ templateId, targetId: e.id })}
                      />
                      <button type="button" className="btn btn-ghost" onClick={() => setRevoking(e.id)}>
                        Зняти
                      </button>
                    </span>
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
    </>
  );
}
