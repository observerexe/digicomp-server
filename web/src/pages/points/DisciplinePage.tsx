import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { api, unwrap } from '../../api/client';
import type { DisciplineRecord, Me } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { ChoiceButton } from '../../components/ChoiceButton';
import { RecordPapers } from '../../components/RecordPapers';
import { Card, ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { formatDate } from '../../lib/format';
import { disciplineTitle } from '../../lib/labels';
import { templateChoices, useNewPaper, usePaperForRecord, useTemplates } from '../../lib/paperTemplates';
import { MemberSelect } from '../../components/MemberSelect';
import s from './points.module.css';

type State = 'active' | 'revoked' | 'all';

/**
 * Admin revokes any record, a moderator only own (API: DisciplineRevoke);
 * here — only records issued before documents: one with a document is
 * revoked by cancelling it. The same may give such a record its document.
 */
export function canRevokeRecord(r: DisciplineRecord, me: Me): boolean {
  return !r.revoked && !r.paper && (me.role === 'admin' || r.issuedBy?.id === me.id);
}

/**
 * Staff: discipline table with filters. Issued through «Подання про
 * стягнення» (a document); revoked by cancelling it — here only records
 * made before documents, with a reason, or they get their document.
 */
export function DisciplinePage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const filterUser = params.get('user') ?? '';
  const [state, setState] = useState<State>('active');
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const templates = useTemplates();
  const newPaper = useNewPaper();
  const forRecord = usePaperForRecord('discipline');
  const issueChoices = templateChoices(templates.data, { creates: 'discipline_record' });

  const list = useQuery({
    queryKey: ['discipline', 'list', filterUser, state],
    queryFn: () => unwrap(api.GET('/api/discipline', { params: { query: { state, limit: '100', ...(filterUser ? { userId: filterUser } : {}) } } })),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => unwrap(api.POST('/api/discipline/{id}/revoke', { params: { path: { id } }, body: { reason: revokeReason.trim() } })),
    onSuccess: () => {
      setRevoking(null);
      setRevokeReason('');
      void qc.invalidateQueries({ queryKey: ['discipline'] });
      void qc.invalidateQueries({ queryKey: ['points'] });
    },
  });

  if (!user) return null;

  return (
    <>
      <PageHeader title="Дисципліна">
        <ChoiceButton
          label="Нове подання"
          choices={issueChoices}
          disabled={templates.isPending || newPaper.isPending}
          emptyNote="Немає шаблону, що видає стягнення: його додають у «Редактор» → «Шаблони»."
          // From a member's page — about them.
          onPick={(templateId) => templateId && newPaper.mutate({ templateId, ...(filterUser ? { about: { type: 'user', id: filterUser } } : {}) })}
        />
      </PageHeader>
      <Card>
        <p className="hint">
          Попередження, штраф чи догану видають «Поданням про стягнення» в Редакторі; штраф знімає бали. Зняти стягнення — «Скасувати документ» у поданні. Видане до документів
          знімається тут, а «Створити документ» оформлює його поданням. Учасник бачить свої записи й подання про себе; інші — ні.
        </p>
        <div className={s.filters}>
          <MemberSelect excludeSelf id="dc-filter" label="Учасник" allowAll value={filterUser} onChange={(id) => setParams(id ? { user: id } : {}, { replace: true })} />
          <div className="field">
            <label htmlFor="dc-state">Стан</label>
            <select id="dc-state" value={state} onChange={(e) => setState(e.target.value as State)}>
              <option value="active">Діють</option>
              <option value="revoked">Зняті</option>
              <option value="all">Усі</option>
            </select>
          </div>
        </div>
        <ErrorMessage text={[newPaper, forRecord, templates, revoke].map((q) => (q.isError ? errorOf(q.error) : null)).find(Boolean) ?? null} />
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
                  <span className={s.actions}>
                    <ChoiceButton
                      label="Створити документ"
                      className="btn btn-ghost"
                      choices={issueChoices}
                      disabled={forRecord.isPending}
                      onPick={(templateId) => templateId && forRecord.mutate({ templateId, targetId: r.id })}
                    />
                    <button type="button" className="btn btn-ghost" onClick={() => setRevoking(r.id)}>
                      Зняти
                    </button>
                  </span>
                )}
                <RecordPapers label="Подання" paper={r.paper} papers={r.papers} />
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
    </>
  );
}
