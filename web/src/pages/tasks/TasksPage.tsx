import { useState } from 'react';
import { Link } from 'react-router';
import type { Task } from '../../api/types';
import { Board } from '../../components/Board';
import { useAuth } from '../../auth/AuthProvider';
import { ErrorMessage, PageHeader } from '../../components/ui';
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
  const [returning, setReturning] = useState<string | null>(null);
  const board = useBoard(mine, doneLimit);
  const action = useTaskAction(user);

  if (!user) return null;
  const run = (task: Task, kind: ActionKind, body?: string) => action.mutate({ task, kind, body });

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
      <ErrorMessage text={action.isError ? errorOf(action.error) : board.isError ? errorOf(board.error) : null} />
      <Board
        columns={COLUMNS.map((c) => ({ key: c.status, title: c.title }))}
        items={board.data?.tasks}
        columnOf={(t) => t.status}
        canDrop={(t, to) => !!dropAction(t, to, user, can)}
        onDrop={(t, to) => {
          const kind = dropAction(t, to, user, can);
          if (kind === 'return') setReturning(t.id);
          else if (kind) run(t, kind);
        }}
        hint={{
          phone: 'Беріть ТЗ самі. Поки ніхто не почав роботу, до нього можна приєднатися.',
          desk:
            'Перетягніть картку, щоб змінити статус.' +
            (can('tasks.accept') ? ' Прийняти чи повернути можна лише чуже ТЗ; бали діляться порівну між виконавцями.' : ''),
        }}
        empty={(k) => (k === 'todo' ? 'Вільних ТЗ немає.' : 'Порожньо.')}
        footer={(k) =>
          k === 'done' && board.data?.moreDone ? (
            <button type="button" className="btn btn-ghost" onClick={() => setDoneLimit((n) => n + DONE_PAGE)}>
              Показати ще
            </button>
          ) : null
        }
        renderCard={(t, drag) => (
          <TaskCard
            key={t.id}
            task={t}
            me={user}
            busy={action.isPending && action.variables?.task.id === t.id}
            onAction={(kind, body) => run(t, kind, body)}
            drag={drag}
            returning={returning === t.id}
            setReturning={(v) => setReturning(v ? t.id : null)}
          />
        )}
      />
    </>
  );
}
