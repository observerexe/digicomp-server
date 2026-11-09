import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, unwrap } from '../../api/client';
import type { ProjectDetail, ProjectStage } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { Icon } from '../../components/Icon';
import { Card, ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { projectKey, STAGES } from './queries';
import s from './projects.module.css';

export function ProjectFormPage() {
  const { id } = useParams();
  const q = useQuery({
    queryKey: projectKey(id ?? ''),
    enabled: !!id,
    queryFn: () => unwrap(api.GET('/api/projects/{id}', { params: { path: { id: id! } } })),
  });
  if (id && q.isPending) return <Skeleton height={320} />;
  if (id && q.isError) return <ErrorMessage text={errorOf(q.error)} />;
  if (q.data && !q.data.canEdit) {
    return (
      <>
        <PageHeader title="Немає доступу" />
        <p className="hint">Редагувати проєкт можуть лише його учасники й модератори.</p>
      </>
    );
  }
  return <ProjectForm project={q.data} />;
}

/** Fields of a project; the member list is for staff only (API: memberIds). */
function ProjectForm({ project }: { project?: ProjectDetail }) {
  const { can } = useAuth();
  const staff = can('projects.manage');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [f, setF] = useState({
    title: project?.title ?? '',
    description: project?.description ?? '',
    stage: (project?.stage ?? 'planning') as ProjectStage,
    startDate: project?.startDate ?? '',
    deadline: project?.deadline ?? '',
    progress: String(project?.progress ?? 0),
    accomplishments: project?.accomplishments ?? '',
    sources: (project?.sources ?? []).join('\n'),
    memberIds: project?.members.map((m) => m.id) ?? [],
  });
  const team = useQuery({
    queryKey: ['users', 'staff-list'],
    enabled: staff,
    queryFn: () => unwrap(api.GET('/api/users', { params: { query: { limit: '100', active: 'true' } } })),
  });

  const progress = Number(f.progress);
  const sources = f.sources.split('\n').map((x) => x.trim()).filter(Boolean);
  const invalid = !f.title.trim()
    ? 'Вкажіть назву.'
    : f.startDate && f.deadline && f.deadline < f.startDate
      ? 'Дедлайн не може бути раніше дати початку.'
      : !Number.isInteger(progress) || progress < 0 || progress > 100
        ? 'Прогрес — від 0 до 100.'
        : sources.length > 30
          ? 'Не більше 30 джерел.'
          : null;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: f.title.trim(),
        description: f.description,
        stage: f.stage,
        startDate: f.startDate || null,
        deadline: f.deadline || null,
        progress,
        accomplishments: f.accomplishments,
        sources,
        ...(staff ? { memberIds: f.memberIds } : {}),
      };
      return project
        ? unwrap(api.PATCH('/api/projects/{id}', { params: { path: { id: project.id } }, body }))
        : unwrap(api.POST('/api/projects', { body }));
    },
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
      void navigate(`/projects/${p.id}`);
    },
  });

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((v) => ({ ...v, [k]: e.target.value }));
  const toggle = (id: string) =>
    setF((v) => ({ ...v, memberIds: v.memberIds.includes(id) ? v.memberIds.filter((x) => x !== id) : [...v.memberIds, id] }));

  return (
    <>
      <Link to={project ? `/projects/${project.id}` : '/projects'} className="btn btn-ghost">
        <Icon name="back" size={20} />
        {project ? 'Проєкт' : 'Проєкти'}
      </Link>
      <PageHeader title={project ? 'Редагувати проєкт' : 'Новий проєкт'} />
      <Card>
        <form
          className={s.form}
          noValidate
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (!invalid) save.mutate();
          }}
        >
          <div className="field">
            <label htmlFor="pf-title">Назва</label>
            <input id="pf-title" maxLength={160} value={f.title} onChange={set('title')} />
          </div>
          <div className="field">
            <label htmlFor="pf-desc">Опис</label>
            <textarea id="pf-desc" maxLength={5000} value={f.description} onChange={set('description')} />
          </div>
          <div className={s.row}>
            <div className="field">
              <label htmlFor="pf-stage">Етап</label>
              <select id="pf-stage" value={f.stage} onChange={set('stage')}>
                {STAGES.map((st) => (
                  <option key={st.key} value={st.key}>
                    {st.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="pf-start">Початок</label>
              <input id="pf-start" type="date" value={f.startDate} onChange={set('startDate')} />
            </div>
            <div className="field">
              <label htmlFor="pf-deadline">Дедлайн</label>
              <input id="pf-deadline" type="date" min={f.startDate || undefined} value={f.deadline} onChange={set('deadline')} />
            </div>
            <div className="field">
              <label htmlFor="pf-progress">Прогрес, %</label>
              <input id="pf-progress" type="number" inputMode="numeric" min={0} max={100} value={f.progress} onChange={set('progress')} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="pf-acc">Досягнення</label>
            <textarea id="pf-acc" maxLength={5000} value={f.accomplishments} onChange={set('accomplishments')} />
          </div>
          <div className="field">
            <label htmlFor="pf-sources">Джерела (по одному в рядку)</label>
            <textarea id="pf-sources" value={f.sources} onChange={set('sources')} />
          </div>
          {staff && (
            <fieldset className={s.membersPick}>
              <legend>Учасники</legend>
              {team.data?.items.map((u) => (
                <label key={u.id} className={s.check}>
                  <input type="checkbox" checked={f.memberIds.includes(u.id)} onChange={() => toggle(u.id)} />
                  {u.name}
                </label>
              ))}
            </fieldset>
          )}
          {!staff && <p className="hint">Склад учасників змінюють модератори.</p>}
          <ErrorMessage text={invalid && f.title ? invalid : save.isError ? errorOf(save.error) : null} />
          <div className={s.actions}>
            <button type="submit" className="btn btn-primary" disabled={!!invalid || save.isPending}>
              {save.isPending ? 'Зберігаємо…' : project ? 'Зберегти' : 'Створити'}
            </button>
            <Link to={project ? `/projects/${project.id}` : '/projects'} className="btn btn-ghost">
              Скасувати
            </Link>
          </div>
        </form>
      </Card>
    </>
  );
}
