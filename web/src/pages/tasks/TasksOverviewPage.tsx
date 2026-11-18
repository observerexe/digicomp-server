import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../../api/client';
import { Avatar } from '../../components/Avatar';
import { Board } from '../../components/Board';
import { DictChip } from '../../components/Palette';
import { ErrorMessage, PageHeader } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { plural } from '../../lib/format';
import { COLUMNS, dueState } from './logic';
import s from './tasks.module.css';

const MAX_FACES = 4;

/**
 * The board for a guest (`tasks.overview`, no `tasks.read`): which tasks
 * there are, where they are and who does them. Cards do not open.
 */
export function TasksOverviewPage() {
  const q = useQuery({ queryKey: ['tasks', 'overview'], queryFn: () => unwrap(api.GET('/api/tasks/overview')) });
  return (
    <>
      <PageHeader title="Технічні завдання" />
      <ErrorMessage text={q.isError ? errorOf(q.error) : null} />
      <Board
        columns={COLUMNS.map((c) => ({ key: c.status, title: c.title }))}
        items={q.data}
        columnOf={(t) => t.status}
        canDrop={() => false}
        onDrop={() => undefined}
        hint={{
          phone: 'Огляд: які технічні завдання є, де вони й хто їх виконує. Відкрити й узяти завдання можуть учасники команди.',
          desk: 'Огляд: які технічні завдання є, де вони й хто їх виконує. Відкрити й узяти завдання можуть учасники команди.',
        }}
        empty={(k) => (k === 'todo' ? 'Вільних технічних завдань немає.' : 'Порожньо.')}
        renderCard={(t) => {
          const due = dueState(t);
          return (
            <article key={t.id} className={`${s.card} ${t.type ? `${s.typed} pal-${t.type.color}` : ''}`}>
              <span className={s.cardTitle}>{t.title}</span>
              <div className={s.cardMeta}>
                <span className={s.points}>
                  {t.points} {plural(t.points, ['бал', 'бали', 'балів'])}
                </span>
                <span className={`${s.due} ${s[`due_${due.tone}`] ?? ''}`}>{due.label}</span>
                {t.type && <DictChip title={t.type.title} color={t.type.color} />}
              </div>
              <div className={s.people}>
                <span className={s.faces}>
                  {t.assignees.slice(0, MAX_FACES).map((a) => (
                    <span key={a.id} title={a.name ?? ''}>
                      <Avatar name={a.name} url={a.avatarUrl} color={a.color} size={32} />
                    </span>
                  ))}
                </span>
                <span className={s.slots}>
                  {t.assignees.length} з {t.maxAssignees}
                </span>
              </div>
            </article>
          );
        }}
      />
    </>
  );
}
