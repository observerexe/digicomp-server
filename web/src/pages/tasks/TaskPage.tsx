import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError, unwrap } from '../../api/client';
import type { Me, TaskDetail } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { Card, ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { formatDate, formatDateTime, formatSize, plural } from '../../lib/format';
import { TASK_STATUS_LABEL } from '../../lib/labels';
import { ACTION_LABEL, actionsFor, dueState, isAssignee, splitPoints, type ActionKind } from './logic';
import { taskKey, useTaskAction } from './queries';
import s from './tasks.module.css';

const FILE_MAX_BYTES = 20 * 1024 * 1024;

export function TaskPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const q = useQuery({
    queryKey: taskKey(id),
    queryFn: () => unwrap(api.GET('/api/tasks/{id}', { params: { path: { id } } })),
  });
  const back = (
    <Link to="/tasks" className="btn btn-ghost">
      <Icon name="back" size={20} />
      ТЗ
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
        <PageHeader title={gone ? 'ТЗ не знайдено' : 'Не вдалося відкрити ТЗ'} />
        <ErrorMessage text={gone ? 'Можливо, його видалили.' : errorOf(q.error)} />
      </>
    );
  }
  if (!user) return null;
  return (
    <>
      {back}
      <TaskView task={q.data} me={user} />
    </>
  );
}

function TaskView({ task: t, me }: { task: TaskDetail; me: Me }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const action = useTaskAction(me);
  const [returning, setReturning] = useState(false);
  const [returnText, setReturnText] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const actions = actionsFor(t, me, can);
  const due = dueState(t);
  const split = splitPoints(t.points, t.assignees.length);

  const remove = useMutation({
    mutationFn: () => unwrap(api.DELETE('/api/tasks/{id}', { params: { path: { id: t.id } } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void navigate('/tasks');
    },
  });

  const run = (kind: ActionKind, body?: string) => action.mutate({ task: t, kind, body });

  return (
    <div className={s.detail}>
      <PageHeader title={t.title}>
        <span className={`${s.statusBadge} ${s[`status_${t.status}`] ?? ''}`}>{TASK_STATUS_LABEL[t.status]}</span>
      </PageHeader>
      <div className={s.detailGrid}>
        <div className={s.detailMain}>
          <Card>
            <dl className={s.facts}>
              <div>
                <dt>Бали</dt>
                <dd>
                  {t.points} {plural(t.points, ['бал', 'бали', 'балів'])}
                  {split.length > 1 && <span className={s.sub}> · кожному {split.join(' · ')}</span>}
                </dd>
              </div>
              <div>
                <dt>Дедлайн</dt>
                <dd>
                  {t.dueDate ? (
                    <span className={`${s.due} ${s[`due_${due.tone}`] ?? ''}`}>
                      {due.label === formatDate(t.dueDate) ? due.label : `${formatDate(t.dueDate)} · ${due.label}`}
                    </span>
                  ) : (
                    'без дедлайну'
                  )}
                </dd>
              </div>
              <div>
                <dt>Виконавці</dt>
                <dd>
                  {t.assignees.length} з {t.maxAssignees}
                </dd>
              </div>
            </dl>
            {t.description ? <p className={s.description}>{t.description}</p> : <p className="hint">Опису немає.</p>}
            {actions.length > 0 && !returning && (
              <div className={s.cardActions}>
                {actions.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={k === 'leave' ? 'btn btn-ghost' : k === 'return' ? 'btn' : 'btn btn-primary'}
                    disabled={action.isPending}
                    onClick={() => (k === 'return' ? setReturning(true) : run(k))}
                  >
                    {k === 'take' && t.assignees.length ? 'Приєднатися' : ACTION_LABEL[k]}
                  </button>
                ))}
              </div>
            )}
            {returning && (
              <form
                className={s.returnForm}
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  run('return', returnText.trim());
                  setReturning(false);
                  setReturnText('');
                }}
              >
                <div className="field">
                  <label htmlFor="ret-detail">Що виправити</label>
                  <textarea id="ret-detail" maxLength={2000} value={returnText} onChange={(e) => setReturnText(e.target.value)} />
                </div>
                <div className={s.cardActions}>
                  <button type="submit" className="btn btn-primary" disabled={!returnText.trim()}>
                    Повернути на допрацювання
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setReturning(false)}>
                    Скасувати
                  </button>
                </div>
              </form>
            )}
            <ErrorMessage text={action.isError ? errorOf(action.error) : null} />
          </Card>
          <Comments task={t} />
        </div>
        <div className={s.detailSide}>
          <Card>
            <h2 className={s.caption}>Виконавці</h2>
            {t.assignees.length === 0 ? (
              <p className="hint">Ще ніхто не взяв.</p>
            ) : (
              <ol className={s.assignees}>
                {t.assignees.map((a, i) => (
                  <li key={a.id}>
                    <Avatar name={a.name} url={a.avatarUrl} size={32} />
                    <span className={s.grow}>
                      {a.id === me.id ? 'Ви' : a.name}
                      <span className={s.sub}>взяв(-ла) {formatDate(a.takenAt)}</span>
                    </span>
                    {split[i] !== undefined && t.status === 'done' && <span className={s.points}>+{split[i]}</span>}
                  </li>
                ))}
              </ol>
            )}
          </Card>
          <Files task={t} me={me} />
          {can('tasks.manage') && t.status !== 'done' && (
            <Card>
              <div className={s.cardActions}>
                <Link to={`/tasks/${t.id}/edit`} className="btn">
                  Редагувати
                </Link>
                {t.status === 'todo' && t.assignees.length === 0 && !confirmDelete && (
                  <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(true)}>
                    Видалити
                  </button>
                )}
                {confirmDelete && (
                  <>
                    <button type="button" className="btn btn-danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
                      Так, видалити ТЗ
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
                      Ні
                    </button>
                  </>
                )}
              </div>
              <ErrorMessage text={remove.isError ? errorOf(remove.error) : null} />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Comments({ task: t }: { task: TaskDetail }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const add = useMutation({
    mutationFn: () => unwrap(api.POST('/api/tasks/{id}/comments', { params: { path: { id: t.id } }, body: { body: text.trim() } })),
    onSuccess: () => {
      setText('');
      void qc.invalidateQueries({ queryKey: taskKey(t.id) });
    },
  });
  return (
    <Card>
      <h2 className={s.caption}>Коментарі</h2>
      {t.comments.length === 0 ? (
        <p className="hint">Коментарів ще немає.</p>
      ) : (
        <ul className={s.comments} aria-label="Коментарі">
          {t.comments.map((c) => (
            <li key={c.id} className={c.kind === 'return' ? s.commentReturn : s.comment}>
              <Avatar name={c.author.name} url={c.author.avatarUrl} size={32} />
              <div className={s.grow}>
                <span className={s.commentHead}>
                  <b>{c.author.name ?? 'Учасник'}</b> · {formatDateTime(c.createdAt)}
                  {c.kind === 'return' && <span className={s.returnTag}>Повернуто на допрацювання</span>}
                </span>
                <p className={s.commentBody}>{c.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form
        className={s.commentForm}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <div className="field">
          <label htmlFor="comment">Новий коментар</label>
          <textarea id="comment" maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <ErrorMessage text={add.isError ? errorOf(add.error) : null} />
        <button type="submit" className="btn" disabled={!text.trim() || add.isPending}>
          Надіслати
        </button>
      </form>
    </Card>
  );
}

function Files({ task: t, me }: { task: TaskDetail; me: Me }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const canAttach = (isAssignee(t, me) || can('tasks.manage')) && t.status !== 'done';
  const refresh = () => void qc.invalidateQueries({ queryKey: taskKey(t.id) });

  const upload = useMutation({
    mutationFn: (file: File) => {
      if (file.size > FILE_MAX_BYTES) throw new ApiError(0, 'FILE_TOO_LARGE');
      const body = new FormData();
      body.append('file', file);
      return unwrap(api.POST('/api/tasks/{id}/files', { params: { path: { id: t.id } }, body: body as never }));
    },
    onSuccess: refresh,
    onError: (e) => setError(errorOf(e)),
  });
  const remove = useMutation({
    mutationFn: (fileId: string) => unwrap(api.DELETE('/api/tasks/{id}/files/{fileId}', { params: { path: { id: t.id, fileId } } })),
    onSuccess: refresh,
    onError: (e) => setError(errorOf(e)),
  });

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError(null);
    upload.mutate(f);
  };

  if (!t.files.length && !canAttach) return null;
  return (
    <Card>
      <h2 className={s.caption}>Файли</h2>
      {t.files.length > 0 && (
        <ul className={s.files} aria-label="Файли">
          {t.files.map((f) => (
            <li key={f.id}>
              <a href={`/api/tasks/${t.id}/files/${f.id}/download`} className={s.grow}>
                {f.fileName}
                <span className={s.sub}>
                  {formatSize(f.size)} · {formatDate(f.createdAt)}
                </span>
              </a>
              {(f.uploadedById === me.id || can('tasks.manage')) && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  aria-label={`Видалити ${f.fileName}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(f.id)}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canAttach && (
        <>
          <input ref={input} type="file" className={s.fileInput} onChange={onFile} tabIndex={-1} aria-label="Файл" />
          <button type="button" className="btn btn-ghost" disabled={upload.isPending} onClick={() => input.current?.click()}>
            {upload.isPending ? 'Завантажуємо…' : 'Додати файл'}
          </button>
          <p className="hint">До 20 МБ: документи, зображення, архіви.</p>
        </>
      )}
      <ErrorMessage text={error} />
    </Card>
  );
}
