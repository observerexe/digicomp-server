import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { api, ApiError, unwrap } from '../../api/client';
import type { PaperVerify } from '../../api/types';
import { Card, ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { formatDateTime } from '../../lib/format';
import { PAPER_STATUS_LABEL } from '../../lib/labels';
import s from './verify.module.css';

/**
 * «Перевірка документа» — where the QR of a printed document leads: the
 * snapshot is genuine (its hash is known) and what the document is now.
 * The document itself opens only for who sees it.
 */
export function VerifyPage() {
  const { sha = '' } = useParams();
  const q = useQuery({
    queryKey: ['papers', 'verify', sha],
    queryFn: () => unwrap(api.GET('/api/papers/verify/{sha}', { params: { path: { sha } } })),
    retry: false,
  });
  return (
    <>
      <PageHeader title="Перевірка документа" />
      <Card>
        {q.isPending ? (
          <Skeleton height={160} />
        ) : q.isError ? (
          q.error instanceof ApiError && q.error.status === 404 ? (
            <>
              <p className={`${s.verdict} ${s.bad}`}>Не підтверджено</p>
              <p className="hint">{errorOf(q.error)}</p>
            </>
          ) : (
            <ErrorMessage text={errorOf(q.error)} />
          )
        ) : (
          <Verified v={q.data} />
        )}
      </Card>
    </>
  );
}

function Verified({ v }: { v: PaperVerify }) {
  const cancelled = v.status === 'cancelled';
  return (
    <>
      <p className={`${s.verdict} ${cancelled ? s.bad : s.good}`}>{cancelled ? 'Документ справжній, але його скасовано' : 'Документ справжній'}</p>
      {cancelled && v.cancelReason && <p className="hint">Причина: {v.cancelReason}</p>}
      {!v.latest && <p className="hint">Це не остання версія документа: є новіший знімок.</p>}
      <dl className={s.facts}>
        <div>
          <dt>Документ</dt>
          <dd>{[v.title, v.number && `№ ${v.number}`].filter(Boolean).join(' · ')}</dd>
        </div>
        <div>
          <dt>Стан</dt>
          <dd>{PAPER_STATUS_LABEL[v.status]}</dd>
        </div>
        <div>
          <dt>Зафіксовано</dt>
          <dd>{[formatDateTime(v.frozenAt), v.frozenBy?.name].filter(Boolean).join(' · ')}</dd>
        </div>
        {/* Drawn signatures: who each line awaits and when they signed (a paper signature shows on the paper itself). */}
        {v.signatures.map((g, i) => (
          <div key={i}>
            <dt>{g.label}</dt>
            <dd>
              {g.name} · {g.signedAt ? `підписано ${formatDateTime(g.signedAt)}` : 'підпису в DigiComp HUB ще немає'}
            </dd>
          </div>
        ))}
        <div className={s.wide}>
          <dt>Код перевірки (SHA-256)</dt>
          <dd className={s.code}>{v.sha256}</dd>
        </div>
      </dl>
      {v.paperId ? (
        <div className={s.actions}>
          <Link to={`/editor/${v.paperId}`} className="btn">
            Відкрити документ
          </Link>
          <a href={`/api/papers/${v.paperId}/print?snapshot=${v.n}`} target="_blank" rel="noopener noreferrer" className="btn">
            Друк цього знімка
          </a>
        </div>
      ) : (
        <p className="hint">Сам документ вам недоступний: перевірка лише підтверджує, що папір справжній.</p>
      )}
    </>
  );
}
