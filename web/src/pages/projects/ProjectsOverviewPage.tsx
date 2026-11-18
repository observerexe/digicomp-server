import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../../api/client';
import { Avatar } from '../../components/Avatar';
import { Board } from '../../components/Board';
import { ErrorMessage, PageHeader } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { formatDate } from '../../lib/format';
import { kyivParts } from '../../lib/kyiv';
import { STAGES } from './queries';
import s from './projects.module.css';

/**
 * Projects for a guest (`projects.overview`, no `projects.read`): which there
 * are, at what stage and who is in them. Cards do not open.
 */
export function ProjectsOverviewPage() {
  const q = useQuery({ queryKey: ['projects', 'overview'], queryFn: () => unwrap(api.GET('/api/projects/overview')) });
  const today = kyivParts(new Date()).date;
  return (
    <>
      <PageHeader title="Проєкти" />
      <ErrorMessage text={q.isError ? errorOf(q.error) : null} />
      <Board
        columns={STAGES}
        items={q.data}
        columnOf={(p) => p.stage}
        canDrop={() => false}
        onDrop={() => undefined}
        hint={{ phone: 'Огляд: які проєкти є, на якому вони етапі й хто в них.', desk: 'Огляд: які проєкти є, на якому вони етапі й хто в них.' }}
        empty={() => 'Проєктів немає.'}
        renderCard={(p) => {
          const late = p.deadline && p.stage !== 'done' && p.deadline < today;
          return (
            <article key={p.id} className={s.card}>
              <span className={s.cardTitle}>{p.title}</span>
              {p.deadline && <span className={`${s.due} ${late ? s.late : ''}`}>{late ? `прострочено · ${formatDate(p.deadline)}` : `до ${formatDate(p.deadline)}`}</span>}
              <progress className={s.progress} value={p.progress} max={100} aria-label="Прогрес" />
              <div className={s.people}>
                <span className={s.faces}>
                  {p.members.slice(0, 5).map((m) => (
                    <span key={m.id} title={m.name}>
                      <Avatar name={m.name} url={m.avatarUrl} color={m.color} size={32} />
                    </span>
                  ))}
                </span>
                <span className={s.sub}>{p.progress}%</span>
              </div>
            </article>
          );
        }}
      />
    </>
  );
}
