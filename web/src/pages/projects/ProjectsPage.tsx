import { useState } from 'react';
import { Link } from 'react-router';
import type { ProjectListItem } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { Avatar } from '../../components/Avatar';
import { Board, type DragProps } from '../../components/Board';
import { ErrorMessage, PageHeader } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { formatDate } from '../../lib/format';
import { kyivParts } from '../../lib/kyiv';
import { canEditProject, STAGES, useMoveProject, useProjects } from './queries';
import s from './projects.module.css';

/** Projects board by stage (docs/PLAN.md «Проєкти»). */
export function ProjectsPage() {
  const { user, can } = useAuth();
  const [mine, setMine] = useState(false);
  const projects = useProjects(mine && user ? user.id : null);
  const move = useMoveProject();
  if (!user) return null;

  return (
    <>
      <PageHeader title="Проєкти">
        <div className={s.headerTools}>
          <div className={s.segmented} role="group" aria-label="Які проєкти показати">
            <button type="button" aria-pressed={!mine} onClick={() => setMine(false)}>
              Усі
            </button>
            <button type="button" aria-pressed={mine} onClick={() => setMine(true)}>
              Мої
            </button>
          </div>
          {can('projects.create') && (
            <Link to="/projects/new" className="btn btn-primary">
              Новий проєкт
            </Link>
          )}
        </div>
      </PageHeader>
      <ErrorMessage text={move.isError ? errorOf(move.error) : projects.isError ? errorOf(projects.error) : null} />
      <Board
        columns={STAGES}
        items={projects.data?.items}
        columnOf={(p) => p.stage}
        canDrop={(p, to) => p.stage !== to && canEditProject(p, user, can)}
        onDrop={(p, to) => move.mutate({ id: p.id, stage: to })}
        hint={{
          phone: 'Етап проєкту змінюють його учасники й модератори на сторінці проєкту.',
          desk: 'Перетягніть картку, щоб змінити етап. Можна лише в проєктах, де ви учасник (модератори — у будь-яких).',
        }}
        empty={() => 'Проєктів немає.'}
        renderCard={(p, drag) => <ProjectCard key={p.id} project={p} drag={drag} />}
      />
    </>
  );
}

function ProjectCard({ project: p, drag }: { project: ProjectListItem; drag: DragProps }) {
  const late = p.deadline && p.stage !== 'done' && p.deadline < kyivParts(new Date()).date;
  return (
    <article className={s.card} {...drag}>
      <Link to={`/projects/${p.id}`} className={s.cardTitle}>
        {p.title}
      </Link>
      {p.deadline && <span className={`${s.due} ${late ? s.late : ''}`}>{late ? `прострочено · ${formatDate(p.deadline)}` : `до ${formatDate(p.deadline)}`}</span>}
      <progress className={s.progress} value={p.progress} max={100} aria-label="Прогрес" />
      <div className={s.people}>
        <span className={s.faces}>
          {p.members.slice(0, 5).map((m) => (
            <span key={m.id} title={m.name}>
              <Avatar name={m.name} url={m.avatarUrl} size={32} />
            </span>
          ))}
        </span>
        <span className={s.sub}>{p.progress}%</span>
      </div>
    </article>
  );
}
