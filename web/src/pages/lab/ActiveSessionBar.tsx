import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api, unwrap } from '../../api/client';
import { errorOf } from '../../errors/messages';
import { formatTime } from '../../lib/format';
import { useActiveSession } from './queries';
import s from './lab.module.css';

/** «Працюєте на … з 10:02 · Завершити» above every screen: fewer forgotten sessions. */
export function ActiveSessionBar() {
  const qc = useQueryClient();
  const active = useActiveSession();
  const end = useMutation({
    mutationFn: (id: string) => unwrap(api.PATCH('/api/work-sessions/{id}/end', { params: { path: { id } }, body: {} })),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['work-sessions'] });
      void qc.invalidateQueries({ queryKey: ['places'] });
    },
  });

  const session = active.data;
  if (!session) return null;
  const code = session.place.code ?? '';
  return (
    <div className={s.activeBar} role="region" aria-label="Активний сеанс">
      <span className={s.pulse} aria-hidden="true" />
      <span className={s.activeText}>
        Працюєте на{' '}
        <Link to={`/lab/${encodeURIComponent(code)}`}>{session.place.title ?? code}</Link> з {formatTime(session.startedAt)}
      </span>
      <button type="button" className="btn btn-primary" disabled={end.isPending} onClick={() => end.mutate(session.id)}>
        {end.isPending ? 'Завершуємо…' : 'Завершити'}
      </button>
      {end.isError && (
        <span role="alert" className={s.activeError}>
          {errorOf(end.error)}
        </span>
      )}
    </div>
  );
}
