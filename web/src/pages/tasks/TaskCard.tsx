import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { Me, Task } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { Avatar } from '../../components/Avatar';
import type { DragProps } from '../../components/Board';
import { formatDate, formatTime, plural } from '../../lib/format';
import { kyivParts } from '../../lib/kyiv';
import { actionLabel, actionsFor, dueState, splitPoints, type ActionKind } from './logic';
import s from './tasks.module.css';

const MAX_FACES = 5;

/** Who got how much for a done task: «Ірина +14, Андрій +13». */
export function pointsTitle(t: Task): string | undefined {
  if (t.status !== 'done') return undefined;
  const split = splitPoints(t.points, t.assignees.length);
  return split.map((p, i) => `${t.assignees[i]?.name ?? '—'} +${p}`).join(', ');
}

/** «1 з 2 · можна приєднатися», «здано сьогодні о 11:20», «+14 / +13 / +13». */
export function slotsText(t: Task, now = new Date()): string {
  const n = t.assignees.length;
  if (t.status === 'done') return splitPoints(t.points, n).map((p) => `+${p}`).join(' / ');
  if (t.status === 'review') {
    const d = new Date(t.updatedAt);
    const day = kyivParts(d).date === kyivParts(now).date ? 'сьогодні' : formatDate(d, now);
    return `здано ${day} о ${formatTime(d)}`;
  }
  const base = `${n} з ${t.maxAssignees}`;
  return (t.status === 'todo' || t.status === 'queued') && n > 0 && n < t.maxAssignees ? `${base} · можна приєднатися` : base;
}

export function TaskCard(props: {
  task: Task;
  me: Me;
  busy: boolean;
  onAction: (kind: ActionKind, body?: string) => void;
  drag: DragProps;
  returning: boolean;
  setReturning: (v: boolean) => void;
}) {
  const { task: t, me } = props;
  const { can } = useAuth();
  const [comment, setComment] = useState('');
  const actions = actionsFor(t, me, can).filter((a) => a !== 'leave');
  const due = dueState(t);
  const open = t.status === 'todo' || t.status === 'queued';
  const empty = open ? Math.max(0, Math.min(MAX_FACES, t.maxAssignees) - t.assignees.length) : 0;

  const onSubmitReturn = (e: FormEvent) => {
    e.preventDefault();
    props.onAction('return', comment.trim());
    setComment('');
    props.setReturning(false);
  };

  return (
    <article
      className={`${s.card} ${t.status === 'review' ? s.cardReview : ''}`}
      draggable={props.drag.draggable}
      onDragStart={props.drag.onDragStart}
      onDragEnd={props.drag.onDragEnd}
      aria-busy={props.busy}
    >
      <Link to={`/tasks/${t.id}`} className={s.cardTitle}>
        {t.title}
      </Link>
      <div className={s.cardMeta}>
        <span className={s.points}>
          {t.points} {plural(t.points, ['бал', 'бали', 'балів'])}
        </span>
        <span className={`${s.due} ${s[`due_${due.tone}`] ?? ''}`}>{due.label}</span>
      </div>
      <div className={s.people}>
        <span className={s.faces}>
          {t.assignees.slice(0, MAX_FACES).map((a) => (
            <span key={a.id} title={a.name ?? ''}>
              <Avatar name={a.name} url={a.avatarUrl} size={32} />
            </span>
          ))}
          {Array.from({ length: empty }, (_, i) => (
            <span key={`e${i}`} className={s.emptyFace} title="Вільне місце" aria-hidden="true">
              +
            </span>
          ))}
        </span>
        <span className={s.slots} title={pointsTitle(t)}>
          {slotsText(t)}
        </span>
      </div>
      {actions.length > 0 && !props.returning && (
        <div className={s.cardActions}>
          {actions.map((k) =>
            k === 'return' ? (
              <button key={k} type="button" className="btn btn-ghost" disabled={props.busy} onClick={() => props.setReturning(true)}>
                Повернути
              </button>
            ) : (
              <button
                key={k}
                type="button"
                className={k === 'accept' || k === 'take' ? 'btn btn-primary' : 'btn'}
                disabled={props.busy}
                onClick={() => props.onAction(k)}
              >
                {actionLabel(k, t)}
              </button>
            ),
          )}
        </div>
      )}
      {props.returning && (
        <form className={s.returnForm} onSubmit={onSubmitReturn}>
          <div className="field">
            <label htmlFor={`ret-${t.id}`}>Що виправити</label>
            <textarea id={`ret-${t.id}`} maxLength={2000} autoFocus value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          <div className={s.cardActions}>
            <button type="submit" className="btn btn-primary" disabled={!comment.trim() || props.busy}>
              Повернути на допрацювання
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => props.setReturning(false)}>
              Скасувати
            </button>
          </div>
        </form>
      )}
    </article>
  );
}
