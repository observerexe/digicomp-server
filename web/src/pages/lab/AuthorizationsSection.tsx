import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api, unwrap } from '../../api/client';
import type { Authorization } from '../../api/types';
import { ChoiceButton, type Choice } from '../../components/ChoiceButton';
import { RecordPapers } from '../../components/RecordPapers';
import { Card, ConfirmButton, ErrorMessage, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { formatDate } from '../../lib/format';
import { templateChoices, useNewPaper, usePaperForRecord, useTemplates } from '../../lib/paperTemplates';
import s from './lab.module.css';

/** Either the member's допуски (panel) or the equipment's (equipment page). */
type Scope = { user: { id: string; name: string; active: boolean } } | { place: { id: string; title: string; status: string } };

const authKey = (scope: Scope) => ('user' in scope ? (['place-authorizations', 'user', scope.user.id] as const) : (['place-authorizations', 'place', scope.place.id] as const));

/**
 * Staff (places.authorize): the list; a допуск is granted (and renewed) by
 * «Запис про інструктаж і допуск» and revoked by cancelling it. One granted
 * before documents is revoked here or gets its document.
 */
export function AuthorizationsSection(scope: Scope) {
  const qc = useQueryClient();
  const byUser = 'user' in scope;
  const q = useQuery({
    queryKey: authKey(scope),
    queryFn: () => unwrap(api.GET('/api/place-authorizations', { params: { query: byUser ? { userId: scope.user.id } : { placeId: scope.place.id } } })),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/api/place-authorizations/{id}', { params: { path: { id } } })),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['place-authorizations'] });
      void qc.invalidateQueries({ queryKey: ['places'] });
    },
  });
  const templates = useTemplates();
  const newPaper = useNewPaper();
  const forRecord = usePaperForRecord('place-authorizations');
  const choices = templateChoices(templates.data, { creates: 'place_authorization' });
  const canGrant = byUser ? scope.user.active : scope.place.status !== 'archived';
  const about = byUser ? ({ type: 'user', id: scope.user.id } as const) : ({ type: 'place', id: scope.place.id } as const);

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
              <AuthRow
                key={a.id}
                a={a}
                byUser={byUser}
                busy={revoke.isPending || forRecord.isPending}
                choices={choices}
                onRevoke={() => revoke.mutate(a.id)}
                onPaper={(templateId) => forRecord.mutate({ templateId, targetId: a.id })}
              />
            ))}
          </ul>
        )}
        <ErrorMessage text={[revoke, newPaper, forRecord, templates].map((m) => (m.isError ? errorOf(m.error) : null)).find(Boolean) ?? null} />
        {canGrant && (
          <>
            <p className="hint">Допуск видають «Записом про інструктаж і допуск»; повторний інструктаж оновлює термін. Відкликати — «Скасувати документ» у записі.</p>
            <span className={s.actions}>
              <ChoiceButton
                label="Видати допуск"
                className="btn"
                choices={choices}
                disabled={templates.isPending || newPaper.isPending}
                emptyNote="Немає шаблону, що видає допуск: його додають у «Редактор» → «Шаблони»."
                onPick={(templateId) => templateId && newPaper.mutate({ templateId, about })}
              />
            </span>
          </>
        )}
      </section>
    </Card>
  );
}

function AuthRow(props: { a: Authorization; byUser: boolean; busy: boolean; choices: Choice[]; onRevoke: () => void; onPaper: (templateId: string) => void }) {
  const { a, byUser } = props;
  const title = byUser ? a.place.title : a.user.name;
  return (
    <li className={s.row}>
      <span className={s.rowMain}>
        <span className={s.rowTitle}>
          {byUser ? <Link to={`/lab/${encodeURIComponent(a.place.code)}`}>{title}</Link> : <Link to={`/panel/users/${a.user.id}`}>{title}</Link>}{' '}
          {a.expired && <span className={`${s.badge} ${s.badgeBusy}`}>Прострочено</span>}
        </span>
        <span className={s.rowSub}>{[a.expiresAt ? `до ${formatDate(a.expiresAt)}` : 'безстроково', `видано ${formatDate(a.grantedAt)}`, a.note].filter(Boolean).join(' · ')}</span>
        <RecordPapers label="Запис" paper={a.paper} papers={[]} />
      </span>
      {/* Granted before documents: revoked here, or gets its document. */}
      {!a.paper && (
        <span className={s.actions}>
          <ChoiceButton
            label="Створити документ"
            className="btn btn-ghost"
            choices={props.choices}
            disabled={props.busy}
            onPick={(templateId) => templateId && props.onPaper(templateId)}
          />
          <ConfirmButton label="Відкликати" question={`Відкликати допуск «${title}»?`} danger disabled={props.busy} onConfirm={props.onRevoke} />
        </span>
      )}
    </li>
  );
}
