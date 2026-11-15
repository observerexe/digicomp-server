import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
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
import { useDropdown } from '../../lib/useDropdown';
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
    mutationFn: (templateId: string | null) => unwrap(api.POST('/api/papers', { body: templateId ? { templateId } : {} })),
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
          {can('papers.create') && <NewPaper pending={create.isPending} onCreate={(templateId) => create.mutate(templateId)} />}
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

/**
 * «Новий документ»: with templates to make documents from — a choice
 * («Порожній документ» or a template); without — an empty document at once.
 */
function NewPaper({ pending, onCreate }: { pending: boolean; onCreate: (templateId: string | null) => void }) {
  const d = useDropdown();
  const id = useId();
  const templates = useQuery({
    queryKey: ['paper-templates', 'list'],
    queryFn: () => unwrap(api.GET('/api/papers/templates')),
  });
  const ready = (templates.data ?? []).filter((t) => t.currentVersion !== null && !t.archived);
  const pick = (templateId: string | null) => {
    d.setOpen(false);
    onCreate(templateId);
  };
  if (!ready.length) {
    return (
      <button type="button" className="btn btn-primary" disabled={pending || templates.isPending} onClick={() => onCreate(null)}>
        Новий документ
      </button>
    );
  }
  return (
    <div className={s.newPaper} ref={d.root} onKeyDown={d.onKeyDown}>
      <button type="button" className="btn btn-primary" aria-haspopup="true" aria-expanded={d.open} aria-controls={id} disabled={pending} onClick={() => d.setOpen(!d.open)}>
        Новий документ
        <Icon name="down" size={18} />
      </button>
      {d.open && (
        <ul id={id} className={s.menu} aria-label="Новий документ">
          <li>
            <button type="button" onClick={() => pick(null)}>
              Порожній документ
            </button>
          </li>
          {ready.map((t) => (
            <li key={t.id}>
              <button type="button" disabled={t.needsUpdate} onClick={() => pick(t.id)}>
                {t.title}
                {t.needsUpdate && <span className={s.sub}>Шаблон потребує оновлення</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
