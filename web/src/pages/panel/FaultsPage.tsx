import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, unwrap } from '../../api/client';
import type { FaultStatus } from '../../api/types';
import { Chips } from '../../components/Filters';
import { Icon } from '../../components/Icon';
import { Card, ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { FAULT_STATUS_LABEL, FaultRow } from '../lab/FaultsSection';
import lab from '../lab/lab.module.css';
import s from './panel.module.css';

type Open = Exclude<FaultStatus, 'closed'>;
const OPEN: Open[] = ['open', 'in_progress'];

/** /panel/faults: every report not closed yet, oldest first — what waits longest. */
export function FaultsPage() {
  const [status, setStatus] = useState<Open | null>(null);
  const q = useQuery({
    queryKey: ['faults', 'panel'],
    queryFn: async () => {
      const lists = await Promise.all(
        OPEN.map((st) => unwrap(api.GET('/api/faults', { params: { query: { status: st, limit: '100' } } }))),
      );
      return lists.flatMap((l) => l.items).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    },
  });
  const shown = (q.data ?? []).filter((f) => !status || f.status === status);

  return (
    <>
      <Link to="/panel" className="btn btn-ghost">
        <Icon name="back" size={20} />
        Панель керування
      </Link>
      <PageHeader title="Несправності" />
      <div className={s.tools}>
        <Chips
          label="Стан"
          values={OPEN.map((st) => FAULT_STATUS_LABEL[st])}
          value={status ? FAULT_STATUS_LABEL[status] : null}
          onChange={(v) => setStatus(OPEN.find((st) => FAULT_STATUS_LABEL[st] === v) ?? null)}
        />
      </div>
      {q.isPending ? (
        <Skeleton height={200} />
      ) : q.isError ? (
        <ErrorMessage text={errorOf(q.error)} />
      ) : shown.length === 0 ? (
        <p className="hint">Відкритих несправностей немає. Закриті звіти — на сторінках обладнання.</p>
      ) : (
        <Card>
          <ul className={lab.rows} aria-label="Відкриті несправності">
            {shown.map((f) => (
              <FaultRow key={f.id} fault={f} placeStatus={f.place.status} showPlace />
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
