import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api, unwrap } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { Chips, distinct, SearchField } from '../../components/Filters';
import { Icon } from '../../components/Icon';
import { ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { formatDate, formatSize } from '../../lib/format';
import { useDebounced } from '../../lib/useDebounced';
import s from './docs.module.css';

/** File type for the list: «PDF», «DOCX». */
export const fileKind = (name: string | null) => name?.split('.').pop()?.toUpperCase() ?? '';

/** Archive: search on the server (titles), categories, archived for staff. */
export function DocsPage() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);
  const q = useDebounced(search.trim(), 300);
  const docs = useQuery({
    queryKey: ['documents', 'list', q, archived],
    queryFn: () =>
      unwrap(api.GET('/api/documents', { params: { query: { limit: '100', ...(q ? { search: q } : {}), ...(archived ? { archived: 'true' } : {}) } } })),
  });
  const items = docs.data?.items ?? [];
  const categories = useMemo(() => distinct(items.map((d) => d.category)), [items]);
  const shown = items.filter((d) => !category || d.category === category);

  return (
    <>
      <PageHeader title="Архів">
        {can('documents.manage') && (
          <Link to="/docs/new" className="btn btn-primary">
            Новий документ
          </Link>
        )}
      </PageHeader>
      <div className={s.tools}>
        <SearchField value={search} onChange={setSearch} placeholder="Назва документа" />
        <Chips label="Категорія" values={categories} value={category} onChange={setCategory} />
        {can('documents.manage') && (
          <label className={s.check}>
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            Показати архівні
          </label>
        )}
      </div>
      {docs.isPending ? (
        <Skeleton height={240} />
      ) : docs.isError ? (
        <ErrorMessage text={errorOf(docs.error)} />
      ) : shown.length === 0 ? (
        <p className="hint">{q || category ? 'Нічого не знайдено.' : 'Документів ще немає.'}</p>
      ) : (
        <ul className={s.list} aria-label="Документи">
          {shown.map((d) => (
            <li key={d.id}>
              <Link to={`/docs/${d.id}`} className={s.row}>
                <span className={s.kind}>
                  <Icon name="file" size={20} />
                  {fileKind(d.fileName)}
                </span>
                <span className={s.main}>
                  <span className={s.title}>
                    {d.title}
                    {d.accessScope === 'supervisors' && <span className={s.tag}>лише модератори</span>}
                    {d.archived && <span className={s.tag}>в архіві</span>}
                  </span>
                  <span className={s.sub}>
                    {[d.category, d.version !== null && `версія ${d.version}`, d.size !== null && formatSize(d.size), `оновлено ${formatDate(d.updatedAt)}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
