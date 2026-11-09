import { useState, type DragEvent } from 'react';
import { Link } from 'react-router';
import type { Task, TaskStatus } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { COLUMNS, dropAction, type ActionKind } from './logic';
import { DONE_PAGE, useBoard, useTaskAction } from './queries';
import { TaskCard } from './TaskCard';
import s from './tasks.module.css';

/**
 * Task board (approved mockups): five columns side by side on a computer with
 * drag and drop, one column per tab on a phone with buttons on the cards.
 */
export function TasksPage() {
  const { user, can } = useAuth();
  const [mine, setMine] = useState(false);
  const [doneLimit, setDoneLimit] = useState(DONE_PAGE);
  const [tab, setTab] = useState<TaskStatus>('todo');
  const [dragging, setDragging] = useState<Task | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const [returning, setReturning] = useState<string | null>(null);
  const board = useBoard(mine, doneLimit);
  const action = useTaskAction(user);

  if (!user) return null;
  const tasks = board.data?.tasks ?? [];
  const byStatus = (st: TaskStatus) => tasks.filter((t) => t.status === st);
  const run = (task: Task, kind: ActionKind, body?: string) => action.mutate({ task, kind, body });

  const onDrop = (to: TaskStatus) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const t = dragging;
    setDragging(null);
    if (!t) return;
    const kind = dropAction(t, to, user, can);
    if (kind === 'return') setReturning(t.id);
    else if (kind) run(t, kind);
  };

  return (
    <>
      <PageHeader title="ТЗ">
        <div className={s.headerTools}>
          <div className={s.segmented} role="group" aria-label="Які ТЗ показати">
            <button type="button" aria-pressed={!mine} onClick={() => setMine(false)}>
              Усі
            </button>
            <button type="button" aria-pressed={mine} onClick={() => setMine(true)}>
              Мої
            </button>
          </div>
          {can('tasks.create') && (
            <Link to="/tasks/new" className="btn btn-primary">
              Нове ТЗ
            </Link>
          )}
        </div>
      </PageHeader>
      <p className={`hint ${s.hintPhone}`}>Беріть ТЗ самі. Поки ніхто не почав роботу, до нього можна приєднатися.</p>
      <p className={`hint ${s.hintDesk}`}>
        Перетягніть картку, щоб змінити статус.{can('tasks.accept') && ' Прийняти чи повернути можна лише чуже ТЗ; бали діляться порівну між виконавцями.'}
      </p>

      <div className={s.tabs} role="tablist" aria-label="Колонки">
        {COLUMNS.map((c) => (
          <button
            key={c.status}
            type="button"
            role="tab"
            aria-selected={tab === c.status}
            className={s.tab}
            onClick={() => setTab(c.status)}
          >
            {c.title}
            <span className={s.count}>{board.data ? byStatus(c.status).length : ''}</span>
          </button>
        ))}
      </div>

      <ErrorMessage text={action.isError ? errorOf(action.error) : board.isError ? errorOf(board.error) : null} />

      <div className={s.board}>
        {COLUMNS.map((c) => {
          const list = byStatus(c.status);
          const canDrop = !!dragging && !!dropAction(dragging, c.status, user, can);
          return (
            <section
              key={c.status}
              className={`${s.column} ${tab === c.status ? s.columnActive : ''} ${over === c.status && canDrop ? s.columnOver : ''}`}
              aria-label={c.title}
              data-droppable={canDrop || undefined}
              onDragOver={(e) => {
                if (!canDrop) return;
                e.preventDefault();
                setOver(c.status);
              }}
              onDragLeave={() => setOver((o) => (o === c.status ? null : o))}
              onDrop={onDrop(c.status)}
            >
              <h2 className={s.columnTitle}>
                {c.title} <span className={s.count}>{board.data ? list.length : ''}</span>
              </h2>
              {board.isPending ? (
                <>
                  <Skeleton height={140} />
                  <Skeleton height={140} />
                </>
              ) : list.length === 0 ? (
                <p className={s.empty}>{c.status === 'todo' ? 'Вільних ТЗ немає.' : 'Порожньо.'}</p>
              ) : (
                list.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    me={user}
                    busy={action.isPending && action.variables?.task.id === t.id}
                    onAction={(kind, body) => run(t, kind, body)}
                    draggable={COLUMNS.some((col) => dropAction(t, col.status, user, can))}
                    onDragStart={() => setDragging(t)}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    returning={returning === t.id}
                    setReturning={(v) => setReturning(v ? t.id : null)}
                  />
                ))
              )}
              {c.status === 'done' && board.data?.moreDone && (
                <button type="button" className="btn btn-ghost" onClick={() => setDoneLimit((n) => n + DONE_PAGE)}>
                  Показати ще
                </button>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
