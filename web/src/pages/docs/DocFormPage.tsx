import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError, unwrap } from '../../api/client';
import type { AccessScope, Doc } from '../../api/types';
import { DropZone } from '../../components/DropZone';
import { Icon } from '../../components/Icon';
import { Card, ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
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
  const [f, setF] = useState({
    title: doc?.title ?? '',
    category: doc?.category ?? '',
    description: doc?.description ?? '',
    accessScope: (doc?.accessScope ?? 'members') as AccessScope,
    placeId: doc?.placeId ?? '',
    inventoryItemId: doc?.inventoryItemId ?? '',
  });
  const places = useQuery({ queryKey: ['places', 'list'], queryFn: () => unwrap(api.GET('/api/places')) });
  const items = useQuery({
    queryKey: ['inventory', 'items'],
    queryFn: () => unwrap(api.GET('/api/inventory/items', { params: { query: { limit: '100' } } })),
  });

  const invalid = !f.title.trim() || !f.category.trim() ? 'Вкажіть назву й категорію.' : !doc && !file ? 'Додайте файл.' : null;
  const save = useMutation({
    mutationFn: () => {
      if (doc) {
        return unwrap(
          api.PATCH('/api/documents/{id}', {
            params: { path: { id: doc.id } },
            body: {
              title: f.title.trim(),
              category: f.category.trim(),
              description: f.description,
              accessScope: f.accessScope,
              placeId: f.placeId || null,
              inventoryItemId: f.inventoryItemId || null,
            },
          }),
        );
      }
      if (file!.size > MAX_BYTES) throw new ApiError(0, 'FILE_TOO_LARGE');
      const body = new FormData();
      body.append('file', file!);
      body.append('title', f.title.trim());
      body.append('category', f.category.trim());
      if (f.description) body.append('description', f.description);
      body.append('accessScope', f.accessScope);
      if (f.placeId) body.append('placeId', f.placeId);
      if (f.inventoryItemId) body.append('inventoryItemId', f.inventoryItemId);
      return unwrap(api.POST('/api/documents', { body: body as never }));
    },
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: ['documents'] });
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
            <input id="df-cat" maxLength={100} placeholder="Інструкції, паспорти, шаблони…" value={f.category} onChange={set('category')} />
          </div>
          <div className="field">
            <label htmlFor="df-desc">Опис</label>
            <textarea id="df-desc" maxLength={5000} value={f.description} onChange={set('description')} />
          </div>
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
          <div className={s.row}>
            <div className="field">
              <label htmlFor="df-place">Обладнання</label>
              <select id="df-place" value={f.placeId} onChange={set('placeId')}>
                <option value="">Не прив’язано</option>
                {places.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} ({p.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="df-item">Позиція складу</label>
              <select id="df-item" value={f.inventoryItemId} onChange={set('inventoryItemId')}>
                <option value="">Не прив’язано</option>
                {items.data?.items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.title} ({i.code})
                  </option>
                ))}
              </select>
            </div>
          </div>
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
