import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError, CLIENT_HEADER, unwrap } from '../../api/client';
import type { Doc } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { DropZone } from '../../components/DropZone';
import { Icon } from '../../components/Icon';
import { Card, ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { formatDateTime, formatSize } from '../../lib/format';
import { fileKind } from './DocsPage';
import s from './docs.module.css';

const MAX_BYTES = 20 * 1024 * 1024;
export const docKey = (id: string) => ['documents', 'one', id] as const;
const download = (id: string, version?: number) => `/api/documents/${id}/download${version ? `?version=${version}` : ''}`;

type PreviewKind = 'pdf' | 'image' | 'text' | null;
export function previewKind(mime: string | null): PreviewKind {
  if (!mime) return null;
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('text/')) return 'text';
  return null;
}

export function DocPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: docKey(id), queryFn: () => unwrap(api.GET('/api/documents/{id}', { params: { path: { id } } })) });
  const back = (
    <Link to="/docs" className="btn btn-ghost">
      <Icon name="back" size={20} />
      Архів
    </Link>
  );
  if (q.isPending) {
    return (
      <>
        {back}
        <Skeleton height={320} />
      </>
    );
  }
  if (q.isError) {
    const gone = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 400);
    return (
      <>
        {back}
        <PageHeader title={gone ? 'Документ не знайдено' : 'Не вдалося відкрити'} />
        <ErrorMessage text={gone ? 'Можливо, його перенесли в архів або він лише для модераторів.' : errorOf(q.error)} />
      </>
    );
  }
  return (
    <>
      {back}
      <DocView doc={q.data} />
    </>
  );
}

function Preview({ doc }: { doc: Doc }) {
  const kind = previewKind(doc.mimeType);
  const text = useQuery({
    queryKey: [...docKey(doc.id), 'text', doc.version],
    enabled: kind === 'text',
    queryFn: async () => {
      const r = await fetch(download(doc.id), { credentials: 'same-origin', headers: CLIENT_HEADER });
      if (!r.ok) throw new ApiError(r.status, 'ERROR');
      return r.text();
    },
  });
  if (doc.version === null) return <p className="hint">У документа ще немає файлу.</p>;
  if (kind === 'pdf') return <iframe className={s.pdf} src={`/api/documents/${doc.id}/download?inline=1`} title={`Перегляд: ${doc.title}`} />;
  if (kind === 'image') return <img className={s.image} src={download(doc.id)} alt={doc.title} />;
  if (kind === 'text') {
    if (text.isPending) return <Skeleton height={160} />;
    if (text.isError) return <ErrorMessage text={errorOf(text.error)} />;
    return <pre className={s.text}>{text.data}</pre>;
  }
  return <p className="hint">Перегляд для {fileKind(doc.fileName) || 'цього типу'} у застосунку недоступний — завантажте файл.</p>;
}

function DocView({ doc }: { doc: Doc }) {
  const { can } = useAuth();
  const staff = can('documents.manage');
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  const versions = useQuery({
    queryKey: [...docKey(doc.id), 'versions'],
    queryFn: () => unwrap(api.GET('/api/documents/{id}/versions', { params: { path: { id: doc.id } } })),
  });
  const upload = useMutation({
    mutationFn: () => {
      if (!file) throw new ApiError(0, 'FILE_REQUIRED');
      if (file.size > MAX_BYTES) throw new ApiError(0, 'FILE_TOO_LARGE');
      const body = new FormData();
      body.append('file', file);
      if (note.trim()) body.append('changeNote', note.trim());
      return unwrap(api.POST('/api/documents/{id}/files', { params: { path: { id: doc.id } }, body: body as never }));
    },
    onSuccess: () => {
      setFile(null);
      setNote('');
      void qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });
  const archive = useMutation({
    mutationFn: () => unwrap(api.DELETE('/api/documents/{id}', { params: { path: { id: doc.id } } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['documents'] });
      void navigate('/docs');
    },
  });

  return (
    <>
      <PageHeader title={doc.title}>
        <a className="btn" href={download(doc.id)} download>
          Завантажити
        </a>
      </PageHeader>
      <p className={s.sub}>
        {[doc.category, doc.version !== null && `версія ${doc.version}`, doc.size !== null && formatSize(doc.size), doc.accessScope === 'supervisors' && 'лише модератори', doc.archived && 'в архіві']
          .filter(Boolean)
          .join(' · ')}
      </p>
      {doc.description && <p className={s.description}>{doc.description}</p>}
      <div className={s.grid}>
        <Card>
          <Preview doc={doc} />
        </Card>
        <div className={s.stack}>
          <Card>
            <h2 className={s.caption}>Версії</h2>
            {versions.isPending ? (
              <Skeleton height={80} />
            ) : versions.isError ? (
              <ErrorMessage text={errorOf(versions.error)} />
            ) : (
              <ol className={s.versions} aria-label="Версії">
                {versions.data.map((v) => (
                  <li key={v.id}>
                    <a href={download(doc.id, v.version)} download>
                      Версія {v.version} · {v.fileName}
                    </a>
                    <span className={s.sub}>
                      {formatDateTime(v.createdAt)} · {formatSize(v.size)}
                      {v.changeNote && ` · ${v.changeNote}`}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          {staff && !doc.archived && (
            <Card>
              <form
                className={s.form}
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  upload.mutate();
                }}
              >
                <h2 className={s.caption}>Нова версія</h2>
                <DropZone id="doc-version" label="Вибрати файл" file={file} onFile={setFile} hint="До 20 МБ. Попередні версії лишаються." />
                <div className="field">
                  <label htmlFor="doc-note">Що змінилось</label>
                  <input id="doc-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
                <ErrorMessage text={upload.isError ? errorOf(upload.error) : null} />
                <button type="submit" className="btn btn-primary" disabled={!file || upload.isPending}>
                  {upload.isPending ? 'Завантажуємо…' : 'Додати версію'}
                </button>
              </form>
            </Card>
          )}
          {staff && !doc.archived && (
            <Card>
              <div className={s.actions}>
                <Link to={`/docs/${doc.id}/edit`} className="btn">
                  Редагувати
                </Link>
                {!confirm ? (
                  <button type="button" className="btn btn-ghost" onClick={() => setConfirm(true)}>
                    В архів
                  </button>
                ) : (
                  <>
                    <button type="button" className="btn btn-danger" disabled={archive.isPending} onClick={() => archive.mutate()}>
                      Так, в архів
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => setConfirm(false)}>
                      Ні
                    </button>
                  </>
                )}
              </div>
              <ErrorMessage text={archive.isError ? errorOf(archive.error) : null} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
