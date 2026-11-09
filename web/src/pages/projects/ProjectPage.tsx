import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ChangeEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError, unwrap } from '../../api/client';
import type { ProjectDetail, ProjectHistory, ProjectStage } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { Card, ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { formatDate, formatDateTime, formatSize } from '../../lib/format';
import { PROJECT_STAGE_LABEL } from '../../lib/labels';
import { projectKey, STAGES } from './queries';
import s from './projects.module.css';

const FILE_MAX_BYTES = 20 * 1024 * 1024;

export function ProjectPage() {
  const { id = '' } = useParams();
  const q = useQuery({
    queryKey: projectKey(id),
    queryFn: () => unwrap(api.GET('/api/projects/{id}', { params: { path: { id } } })),
  });
  const back = (
    <Link to="/projects" className="btn btn-ghost">
      <Icon name="back" size={20} />
      Проєкти
    </Link>
  );
  if (q.isPending) {
    return (
      <>
        {back}
        <Skeleton height={240} />
      </>
    );
  }
  if (q.isError) {
    const gone = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 400);
    return (
      <>
        {back}
        <PageHeader title={gone ? 'Проєкт не знайдено' : 'Не вдалося відкрити проєкт'} />
        <ErrorMessage text={gone ? 'Можливо, його перенесли в архів.' : errorOf(q.error)} />
      </>
    );
  }
  return (
    <>
      {back}
      <ProjectView p={q.data} />
    </>
  );
}

/** «https://…» sources become links; anything else stays text. */
function Source({ value }: { value: string }) {
  let url: URL | null = null;
  try {
    url = new URL(value);
  } catch {
    url = null;
  }
  return url && (url.protocol === 'https:' || url.protocol === 'http:') ? (
    <a href={url.href} target="_blank" rel="noopener noreferrer">
      {value}
    </a>
  ) : (
    <span>{value}</span>
  );
}

function ProjectView({ p }: { p: ProjectDetail }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [progress, setProgress] = useState(p.progress);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['projects'] });

  const patch = useMutation({
    mutationFn: (body: { stage?: ProjectStage; progress?: number }) =>
      unwrap(api.PATCH('/api/projects/{id}', { params: { path: { id: p.id } }, body })),
    onSuccess: (fresh) => qc.setQueryData(projectKey(p.id), fresh),
    onSettled: refresh,
  });
  const archive = useMutation({
    mutationFn: () => unwrap(api.DELETE('/api/projects/{id}', { params: { path: { id: p.id } } })),
    onSuccess: () => {
      refresh();
      void navigate('/projects');
    },
  });

  return (
    <>
      <PageHeader title={p.title}>
        <span className={s.stageBadge}>{PROJECT_STAGE_LABEL[p.stage]}</span>
      </PageHeader>
      <div className={s.detailGrid}>
        <div className={s.stack}>
          <Card>
            <dl className={s.facts}>
              <div>
                <dt>Початок</dt>
                <dd>{p.startDate ? formatDate(p.startDate) : '—'}</dd>
              </div>
              <div>
                <dt>Дедлайн</dt>
                <dd>{p.deadline ? formatDate(p.deadline) : '—'}</dd>
              </div>
              <div>
                <dt>Прогрес</dt>
                <dd>{p.progress}%</dd>
              </div>
            </dl>
            {p.description ? <p className={s.text}>{p.description}</p> : <p className="hint">Опису немає.</p>}
            {p.canEdit && (
              <div className={s.quick}>
                <div className="field">
                  <label htmlFor="pj-stage">Етап</label>
                  <select
                    id="pj-stage"
                    value={p.stage}
                    disabled={patch.isPending}
                    onChange={(e) => patch.mutate({ stage: e.target.value as ProjectStage })}
                  >
                    {STAGES.map((st) => (
                      <option key={st.key} value={st.key}>
                        {st.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="pj-progress">Прогрес: {progress}%</label>
                  <input
                    id="pj-progress"
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={progress}
                    onChange={(e) => setProgress(Number(e.target.value))}
                    onPointerUp={() => progress !== p.progress && patch.mutate({ progress })}
                    onKeyUp={() => progress !== p.progress && patch.mutate({ progress })}
                  />
                </div>
              </div>
            )}
            <ErrorMessage text={patch.isError ? errorOf(patch.error) : null} />
          </Card>
          {p.accomplishments && (
            <Card>
              <h2 className={s.caption}>Досягнення</h2>
              <p className={s.text}>{p.accomplishments}</p>
            </Card>
          )}
          {p.sources.length > 0 && (
            <Card>
              <h2 className={s.caption}>Джерела</h2>
              <ul className={s.sources}>
                {p.sources.map((src, i) => (
                  <li key={i}>
                    <Source value={src} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <History id={p.id} />
        </div>
        <div className={s.stack}>
          <Card>
            <h2 className={s.caption}>Учасники</h2>
            {p.members.length === 0 ? (
              <p className="hint">Учасників ще немає.</p>
            ) : (
              <ul className={s.members}>
                {p.members.map((m) => (
                  <li key={m.id}>
                    <Link to={`/team/${m.id}`}>
                      <Avatar name={m.name} url={m.avatarUrl} size={32} />
                      <span>
                        {m.name}
                        {m.position && <span className={s.sub}>{m.position}</span>}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Files p={p} />
          {(p.canEdit || can('projects.manage')) && (
            <Card>
              <div className={s.actions}>
                <Link to={`/projects/${p.id}/edit`} className="btn">
                  Редагувати
                </Link>
                {can('projects.manage') && !confirmArchive && (
                  <button type="button" className="btn btn-ghost" onClick={() => setConfirmArchive(true)}>
                    В архів
                  </button>
                )}
                {confirmArchive && (
                  <>
                    <button type="button" className="btn btn-danger" disabled={archive.isPending} onClick={() => archive.mutate()}>
                      Так, в архів
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => setConfirmArchive(false)}>
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

function Files({ p }: { p: ProjectDetail }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: projectKey(p.id) });
  const upload = useMutation({
    mutationFn: (file: File) => {
      if (file.size > FILE_MAX_BYTES) throw new ApiError(0, 'FILE_TOO_LARGE');
      const body = new FormData();
      body.append('file', file);
      return unwrap(api.POST('/api/projects/{id}/files', { params: { path: { id: p.id } }, body: body as never }));
    },
    onSuccess: refresh,
    onError: (e) => setError(errorOf(e)),
  });
  const remove = useMutation({
    mutationFn: (fileId: string) => unwrap(api.DELETE('/api/projects/{id}/files/{fileId}', { params: { path: { id: p.id, fileId } } })),
    onSuccess: refresh,
    onError: (e) => setError(errorOf(e)),
  });
  if (!p.files.length && !p.canEdit) return null;
  return (
    <Card>
      <h2 className={s.caption}>Файли</h2>
      {p.files.length > 0 && (
        <ul className={s.files} aria-label="Файли">
          {p.files.map((f) => (
            <li key={f.id}>
              <a href={`/api/projects/${p.id}/files/${f.id}/download`}>
                {f.fileName}
                <span className={s.sub}>
                  {formatSize(f.size)} · {formatDate(f.createdAt)}
                </span>
              </a>
              {can('projects.manage') && (
                <button type="button" className="btn btn-ghost" aria-label={`Видалити ${f.fileName}`} onClick={() => remove.mutate(f.id)}>
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {p.canEdit && (
        <>
          <input
            ref={input}
            type="file"
            className={s.fileInput}
            tabIndex={-1}
            aria-label="Файл"
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) {
                setError(null);
                upload.mutate(f);
              }
            }}
          />
          <button type="button" className="btn btn-ghost" disabled={upload.isPending} onClick={() => input.current?.click()}>
            {upload.isPending ? 'Завантажуємо…' : 'Додати файл'}
          </button>
        </>
      )}
      <ErrorMessage text={error} />
    </Card>
  );
}

const FIELD_LABEL: Record<string, string> = {
  title: 'назву',
  description: 'опис',
  stage: 'етап',
  startDate: 'дату початку',
  deadline: 'дедлайн',
  progress: 'прогрес',
  accomplishments: 'досягнення',
  sources: 'джерела',
  memberIds: 'учасників',
  members: 'учасників',
};

/** «Олег змінив етап, прогрес» from the audit record. */
export function historyText(h: ProjectHistory): string {
  const who = h.actor?.name ?? 'Хтось';
  const meta = (h.meta ?? {}) as { fields?: unknown };
  const fields = Array.isArray(meta.fields) ? (meta.fields as string[]) : Object.keys(h.meta ?? {});
  const what = [...new Set(fields.map((f) => FIELD_LABEL[f]).filter(Boolean))].join(', ');
  if (h.action === 'project.created') return `${who} створив(-ла) проєкт`;
  if (h.action === 'project.archived') return `${who} переніс(-ла) в архів`;
  if (h.action.startsWith('project.file')) return `${who} ${h.action.endsWith('removed') ? 'видалив(-ла)' : 'додав(-ла)'} файл`;
  if (h.action === 'project.stage_migrated') return 'Етап перенесено зі старого статусу';
  return what ? `${who} змінив(-ла) ${what}` : `${who} змінив(-ла) проєкт`;
}

function History({ id }: { id: string }) {
  const q = useQuery({
    queryKey: [...projectKey(id), 'history'],
    queryFn: () => unwrap(api.GET('/api/projects/{id}/history', { params: { path: { id } } })),
  });
  if (!q.data?.length) return null;
  return (
    <Card>
      <h2 className={s.caption}>Історія змін</h2>
      <ul className={s.history}>
        {q.data.map((h) => (
          <li key={h.id}>
            {historyText(h)}
            <span className={s.sub}>{formatDateTime(h.createdAt)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
