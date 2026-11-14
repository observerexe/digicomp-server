import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, unwrap } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { SearchField } from '../../components/Filters';
import { Icon } from '../../components/Icon';
import { ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { formatDate } from '../../lib/format';
import { PAPER_STATUS_LABEL } from '../../lib/labels';
import { useDebounced } from '../../lib/useDebounced';
import s from './editor.module.css';

/** «Редактор»: my documents and all I can see; a new document opens at once. */
export function PapersPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [mine, setMine] = useState(true);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 300);
  const papers = useQuery({
    queryKey: ['papers', 'list', mine, q],
    queryFn: () => unwrap(api.GET('/api/papers', { params: { query: { limit: '100', ...(mine ? { mine: 'true' } : {}), ...(q ? { search: q } : {}) } } })),
  });
  const create = useMutation({
    mutationFn: () => unwrap(api.POST('/api/papers', { body: {} })),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ['papers', 'list'] });
      void navigate(`/editor/${p.id}`);
    },
  });
  const items = papers.data?.items ?? [];

  return (
    <>
      <PageHeader title="Редактор">
        <div className={s.headerTools}>
          <div className={s.segmented} role="group" aria-label="Які документи показати">
            <button type="button" aria-pressed={mine} onClick={() => setMine(true)}>
              Мої
            </button>
            <button type="button" aria-pressed={!mine} onClick={() => setMine(false)}>
              Усі
            </button>
          </div>
          {can('papers.create') && (
            <button type="button" className="btn btn-primary" disabled={create.isPending} onClick={() => create.mutate()}>
              Новий документ
            </button>
          )}
        </div>
      </PageHeader>
      <ErrorMessage text={create.isError ? errorOf(create.error) : null} />
      <div className={s.tools}>
        <SearchField value={search} onChange={setSearch} placeholder="Назва документа" />
      </div>
      {papers.isPending ? (
        <Skeleton height={240} />
      ) : papers.isError ? (
        <ErrorMessage text={errorOf(papers.error)} />
      ) : items.length === 0 ? (
        <p className="hint">{q ? 'Нічого не знайдено.' : mine ? 'У вас ще немає документів.' : 'Документів ще немає.'}</p>
      ) : (
        <ul className={s.list} aria-label="Документи редактора">
          {items.map((p) => (
            <li key={p.id}>
              <Link to={`/editor/${p.id}`} className={s.row}>
                <span className={s.kind}>
                  <Icon name="file" size={20} />
                </span>
                <span className={s.main}>
                  <span className={s.title}>
                    {p.title}
                    <span className={s.tag}>{PAPER_STATUS_LABEL[p.status]}</span>
                  </span>
                  <span className={s.sub}>{[!mine && (p.author.name ?? 'Видалений учасник'), `оновлено ${formatDate(p.updatedAt)}`].filter(Boolean).join(' · ')}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {papers.data && papers.data.total > items.length && <p className="hint">Показано {items.length} з {papers.data.total}. Уточніть пошук, щоб знайти інші.</p>}
    </>
  );
}
