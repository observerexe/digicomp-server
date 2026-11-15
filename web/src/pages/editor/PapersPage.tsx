import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
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
import { NewTemplate, TemplatesList } from './TemplatesTab';

type Tab = 'mine' | 'all' | 'templates';

/**
 * «Редактор»: my documents, all I can see, and (staff) templates. A new
 * document opens at once; a new template — in the constructor. The tab is
 * in the address: back from the constructor is back to «Шаблони».
 */
export function PapersPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const templates = can('paper_templates.manage');
  const asked = params.get('tab');
  const tab: Tab = asked === 'all' ? 'all' : asked === 'templates' && templates ? 'templates' : 'mine';
  const [creating, setCreating] = useState(false);
  const show = (t: Tab) => setParams(t === 'mine' ? {} : { tab: t }, { replace: true });

  return (
    <>
      <PageHeader title="Редактор">
        <div className={s.headerTools}>
          <div className={s.segmented} role="group" aria-label="Що показати">
            <button type="button" aria-pressed={tab === 'mine'} onClick={() => show('mine')}>
              Мої
            </button>
            <button type="button" aria-pressed={tab === 'all'} onClick={() => show('all')}>
              Усі
            </button>
            {templates && (
              <button type="button" aria-pressed={tab === 'templates'} onClick={() => show('templates')}>
                Шаблони
              </button>
            )}
          </div>
          {tab === 'templates' ? (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)} disabled={creating}>
              Новий шаблон
            </button>
          ) : (
            can('papers.create') && <NewPaperButton />
          )}
        </div>
      </PageHeader>
      {tab === 'templates' ? (
        <>
          {creating && <NewTemplate onClose={() => setCreating(false)} />}
          <TemplatesList />
        </>
      ) : (
        <Papers mine={tab === 'mine'} />
      )}
    </>
  );
}

/** «Новий документ» and what it may fail with. */
function NewPaperButton() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: (templateId: string | null) => unwrap(api.POST('/api/papers', { body: templateId ? { templateId } : {} })),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ['papers', 'list'] });
      void navigate(`/editor/${p.id}`);
    },
  });
  return (
    <>
      <NewPaper pending={create.isPending} onCreate={(templateId) => create.mutate(templateId)} />
      {create.isError && (
        <div className={s.headerError}>
          <ErrorMessage text={errorOf(create.error)} />
        </div>
      )}
    </>
  );
}

function Papers({ mine }: { mine: boolean }) {
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 300);
  const papers = useQuery({
    queryKey: ['papers', 'list', mine, q],
    queryFn: () => unwrap(api.GET('/api/papers', { params: { query: { limit: '100', ...(mine ? { mine: 'true' } : {}), ...(q ? { search: q } : {}) } } })),
  });
  const items = papers.data?.items ?? [];

  return (
    <>
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
      {papers.data && papers.data.total > items.length && (
        <p className="hint">
          Показано {items.length} з {papers.data.total}. Уточніть пошук, щоб знайти інші.
        </p>
      )}
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
