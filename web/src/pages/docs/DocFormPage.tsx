import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError, unwrap } from '../../api/client';
import type { AccessScope, Doc, LinkCandidate } from '../../api/types';
import { DictSelect } from '../../components/DictSelect';
import { DropZone } from '../../components/DropZone';
import { Icon } from '../../components/Icon';
import { LinkPicker } from '../../components/Related';
import { recordLabel } from '../../lib/records';
import { Card, ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { CATEGORY } from '../../lib/dictionaries';
import { docKey } from './DocPage';
import s from './docs.module.css';

const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.pptx,.txt,.md,.csv';

/** /docs/new (with the file) and /docs/:id/edit (description and access). */
export function DocFormPage() {
  const { id } = useParams();
  const q = useQuery({
    queryKey: docKey(id ?? ''),
    enabled: !!id,
    queryFn: () => unwrap(api.GET('/api/documents/{id}', { params: { path: { id: id! } } })),
  });
  if (id && q.isPending) return <Skeleton height={320} />;
  if (id && q.isError) return <ErrorMessage text={errorOf(q.error)} />;
  return <DocForm doc={q.data} />;
}

function DocForm({ doc }: { doc?: Doc }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  // New document only: records to link it with once it is uploaded.
  const [linked, setLinked] = useState<LinkCandidate[]>([]);
  const [picking, setPicking] = useState(false);
  const [f, setF] = useState({
    title: doc?.title ?? '',
    category: doc?.category ?? '',
    description: doc?.description ?? '',
    accessScope: (doc?.accessScope ?? 'members') as AccessScope,
  });

  const invalid = !f.title.trim() || !f.category ? 'Вкажіть назву й виберіть категорію.' : !doc && !file ? 'Додайте файл.' : null;
  const save = useMutation({
    mutationFn: async () => {
      if (doc) {
        return unwrap(
          api.PATCH('/api/documents/{id}', {
            params: { path: { id: doc.id } },
            body: {
              title: f.title.trim(),
              category: f.category,
              description: f.description,
              accessScope: f.accessScope,
            },
          }),
        );
      }
      if (file!.size > MAX_BYTES) throw new ApiError(0, 'FILE_TOO_LARGE');
      const body = new FormData();
      body.append('file', file!);
      body.append('title', f.title.trim());
      body.append('category', f.category);
      if (f.description) body.append('description', f.description);
      body.append('accessScope', f.accessScope);
      const created = await unwrap(api.POST('/api/documents', { body: body as never }));
      // The document is there already: a link that failed is added on its page.
      await Promise.allSettled(
        linked.map((r) => unwrap(api.POST('/api/links', { body: { fromType: 'document', fromId: created.id, toType: r.type, toId: r.id } }))),
      );
      return created;
    },
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: ['documents'] });
      void qc.invalidateQueries({ queryKey: ['links'] });
      void navigate(`/docs/${d.id}`);
    },
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((v) => ({ ...v, [k]: e.target.value }));
  const back = doc ? `/docs/${doc.id}` : '/docs';

  return (
    <>
      <Link to={back} className="btn btn-ghost">
        <Icon name="back" size={20} />
        {doc ? doc.title : 'Архів'}
      </Link>
      <PageHeader title={doc ? 'Редагувати документ' : 'Новий документ'} />
      <Card>
        <form
          className={s.form}
          noValidate
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (!invalid) save.mutate();
          }}
        >
          {!doc && (
            <DropZone
              id="doc-file"
              label="Вибрати файл"
              file={file}
              accept={ACCEPT}
              onFile={(x) => {
                setFile(x);
                if (x && !f.title) setF((v) => ({ ...v, title: x.name.replace(/\.[^.]+$/, '') }));
              }}
              hint="PDF, зображення, Word, Excel, PowerPoint, текст. До 20 МБ."
            />
          )}
          <div className="field">
            <label htmlFor="df-title">Назва</label>
            <input id="df-title" maxLength={200} value={f.title} onChange={set('title')} />
          </div>
          <div className="field">
            <label htmlFor="df-cat">Категорія</label>
            <DictSelect
              id="df-cat"
              dictionary={CATEGORY.document}
              value={f.category}
              onChange={(category) => setF((v) => ({ ...v, category }))}
              newLabel="+ Нова категорія…"
            />
          </div>
          <div className="field">
            <label htmlFor="df-desc">Опис</label>
            <textarea id="df-desc" maxLength={5000} value={f.description} onChange={set('description')} />
          </div>
          {!doc && (
            <fieldset className={s.access}>
              <legend>Пов’язати з</legend>
              {linked.length > 0 && (
                <ul className={s.linked} aria-label="Вибрані записи">
                  {linked.map((r) => (
                    <li key={`${r.type}:${r.id}`}>
                      <span>
                        {recordLabel(r.type)}: {r.title}
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        aria-label={`Не пов’язувати з «${r.title}»`}
                        onClick={() => setLinked((v) => v.filter((x) => x !== r))}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {picking ? (
                <LinkPicker exclude={linked} onPick={(c) => setLinked((v) => [...v, c])} onClose={() => setPicking(false)} />
              ) : (
                <button type="button" className="btn btn-ghost" onClick={() => setPicking(true)}>
                  {linked.length ? 'Додати ще' : 'Вибрати запис'}
                </button>
              )}
              <p className="hint">Документ з’явиться в блоці «Пов’язане» вибраного обладнання, позиції складу, технічного завдання чи проєкту.</p>
            </fieldset>
          )}
          <fieldset className={s.access}>
            <legend>Хто бачить</legend>
            <label className={s.check}>
              <input type="radio" name="access" checked={f.accessScope === 'members'} onChange={() => setF({ ...f, accessScope: 'members' })} />
              Усі учасники
            </label>
            <label className={s.check}>
              <input type="radio" name="access" checked={f.accessScope === 'supervisors'} onChange={() => setF({ ...f, accessScope: 'supervisors' })} />
              Лише модератори й адмін
            </label>
          </fieldset>
          <ErrorMessage text={invalid && (f.title || file) ? invalid : save.isError ? errorOf(save.error) : null} />
          <div className={s.actions}>
            <button type="submit" className="btn btn-primary" disabled={!!invalid || save.isPending}>
              {save.isPending ? 'Зберігаємо…' : doc ? 'Зберегти' : 'Додати документ'}
            </button>
            <Link to={back} className="btn btn-ghost">
              Скасувати
            </Link>
          </div>
        </form>
      </Card>
    </>
  );
}
