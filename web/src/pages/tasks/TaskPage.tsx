import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError, unwrap } from '../../api/client';
import type { Me, TaskDetail } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { Avatar } from '../../components/Avatar';
import { ChoiceButton } from '../../components/ChoiceButton';
import { ExtraFacts } from '../../components/ExtraFields';
import { Icon } from '../../components/Icon';
import { Related } from '../../components/Related';
import { Card, ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { useSignWith } from '../../editor/useSignWith';
import { errorOf } from '../../errors/messages';
import { useFieldDefs } from '../../lib/fields';
import { formatDate, formatDateTime, formatSize, plural } from '../../lib/format';
import { templateChoices, useTemplates } from '../../lib/paperTemplates';
import { TASK_STATUS_LABEL } from '../../lib/labels';
import { ACTION_LABEL, actionsFor, dueState, isAssignee, shareLabel, splitPoints, type ActionKind } from './logic';
import { taskKey, useTaskAction, useTaskPaper } from './queries';
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
      Технічні завдання
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
        <PageHeader title={gone ? 'Технічне завдання не знайдено' : 'Не вдалося відкрити технічне завдання'} />
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
  const action = useTaskAction(me);
  // Accepting with a document awaiting who accepts: only with their signature.
  const signed = useSignWith(action);
  const [returning, setReturning] = useState(false);
  const [returnText, setReturnText] = useState('');
  const actions = actionsFor(t, me, can);
  const due = dueState(t);
  const split = splitPoints(t.points, t.assignees.length);
  const defs = useFieldDefs('task');

  const run = (kind: ActionKind, body?: string) => signed.mutate({ task: t, kind, body });

  return (
    <div className={s.detail}>
      <PageHeader title={t.title}>
        <span className={`${s.statusBadge} ${s[`status_${t.status}`] ?? ''}`}>{TASK_STATUS_LABEL[t.status]}</span>
        {t.archivedAt && <span className={s.statusBadge}>В архіві з {formatDate(t.archivedAt)}</span>}
      </PageHeader>
      <div className={s.detailGrid}>
        <div className={s.detailMain}>
          <Card>
            <dl className={s.facts}>
              <div>
                <dt>Бали</dt>
                <dd>
                  {t.points} {plural(t.points, ['бал', 'бали', 'балів'])}
                  {split.length > 1 && <span className={s.sub}> · {shareLabel(split)}</span>}
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
              <ExtraFacts defs={defs.data ?? []} extra={t.extra} />
            </dl>
            {t.description ? <p className={s.description}>{t.description}</p> : <p className="hint">Опису немає.</p>}
            {actions.length > 0 && !returning && (
              <div className={s.cardActions}>
                {actions.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={k === 'leave' || k === 'archive' ? 'btn btn-ghost' : k === 'return' || k === 'unarchive' ? 'btn' : 'btn btn-primary'}
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
            <ErrorMessage text={signed.error ? errorOf(signed.error) : null} />
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
          <Related type="task" id={t.id} />
          <TaskPaper task={t} />
        </div>
      </div>
      {signed.pad}
    </div>
  );
}

/**
 * The task's document: open it (changes are made there); an old task
 * without one — «Редагувати» makes it from the task's values. «Скасувати
 * ТЗ» — while it is free without assignees: with its document, or alone.
 */
function TaskPaper({ task: t }: { task: TaskDetail }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const manage = can('tasks.manage');
  const templates = useTemplates(manage && !t.paper && t.status !== 'done');
  const edit = useTaskPaper();
  // An accepted task's document is frozen: who its lines await may sign it now (or later, from «Головна»).
  const paperId = t.status === 'done' ? t.paper?.id : undefined;
  const toSign = useQuery({
    queryKey: ['papers', 'sign', paperId],
    queryFn: () => unwrap(api.GET('/api/papers/{id}', { params: { path: { id: paperId! } } })),
    enabled: !!paperId && can('papers.read'),
    select: (p) => p.canSignDrawn,
  });
  const [reason, setReason] = useState<string | null>(null);
  const cancel = useMutation({
    mutationFn: async () => {
      const body = { reason: (reason ?? '').trim() };
      if (t.paper) await unwrap(api.POST('/api/papers/{id}/cancel', { params: { path: { id: t.paper.id } }, body }));
      else await unwrap(api.POST('/api/tasks/{id}/cancel', { params: { path: { id: t.id } }, body }));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['papers'] });
      void navigate('/tasks');
    },
  });
  const cancellable = manage && t.status === 'todo' && t.assignees.length === 0;
  const editable = manage && !t.paper && t.status !== 'done';
  if (!t.paper && !editable && !cancellable) return null;

  return (
    <Card>
      <h2 className={s.caption}>Документ</h2>
      {t.paper ? (
        <>
          {t.paper.number && <p className={s.paperNumber}>{t.paper.number}</p>}
          <div className={s.cardActions}>
            <Link to={`/editor/${t.paper.id}`} className="btn">
              Відкрити документ
            </Link>
          </div>
          {toSign.data && (
            <>
              <p className="hint">Документ зафіксовано й чекає вашого підпису. Його можна підписати зараз або пізніше — з «Головної».</p>
              <div className={s.cardActions}>
                <Link to={`/editor/${t.paper.id}`} className="btn btn-primary">
                  Підписати документ
                </Link>
              </div>
            </>
          )}
          {manage && t.status !== 'done' && <p className="hint">Назву, мету, бали й термін змінюють у документі: «Змінити».</p>}
        </>
      ) : (
        <>
          <p className="hint">Технічне завдання створено до документів.{editable ? ' «Редагувати» створить його документ з поточних значень.' : ''}</p>
          {editable && (
            <div className={s.cardActions}>
              <ChoiceButton
                label="Редагувати"
                className="btn"
                choices={templateChoices(templates.data, { creates: 'task' })}
                disabled={templates.isPending || edit.isPending}
                emptyNote="Немає шаблону, що створює технічні завдання: його додають у «Редактор» → «Шаблони»."
                onPick={(templateId) => templateId && edit.mutate({ templateId, taskId: t.id })}
              />
            </div>
          )}
          <ErrorMessage text={edit.isError ? errorOf(edit.error) : templates.isError ? errorOf(templates.error) : null} />
        </>
      )}
      {cancellable && reason === null && (
        <div className={s.cardActions}>
          <button type="button" className="btn btn-ghost" onClick={() => setReason('')}>
            Скасувати технічне завдання
          </button>
        </div>
      )}
      {cancellable && reason !== null && (
        <form
          className={s.returnForm}
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            cancel.mutate();
          }}
        >
          <div className="field">
            <label htmlFor="task-cancel-reason">Причина скасування</label>
            <input id="task-cancel-reason" maxLength={1000} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <p className="hint">
            {t.paper ? 'Технічне завдання зникне з дошки, а документ стане «Скасовано» з цією причиною.' : 'Технічне завдання зникне з дошки; причина лишиться в журналі.'}
          </p>
          <ErrorMessage text={cancel.isError ? errorOf(cancel.error) : null} />
          <div className={s.cardActions}>
            <button type="submit" className="btn btn-danger" disabled={!reason.trim() || cancel.isPending}>
              Скасувати технічне завдання
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setReason(null)}>
              Ні
            </button>
          </div>
        </form>
      )}
    </Card>
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
