import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, unwrap } from '../../api/client';
import type { FieldDef, TaskDetail } from '../../api/types';
import { ExtraInputs } from '../../components/ExtraFields';
import { Icon } from '../../components/Icon';
import { Card, ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { extraBody, fieldProblem, toForm, useFieldDefs, type FormValue } from '../../lib/fields';
import { kyivParts, kyivToDate } from '../../lib/kyiv';
import { DUE_TIME } from './logic';
import { taskKey } from './queries';
import s from './tasks.module.css';

type Form = { title: string; description: string; points: string; maxAssignees: string; due: string };

const fromTask = (t: TaskDetail): Form => ({
  title: t.title,
  description: t.description ?? '',
  points: String(t.points),
  maxAssignees: String(t.maxAssignees),
  due: t.dueDate ? kyivParts(t.dueDate).date : '',
});

/** /tasks/new and /tasks/:id/edit (staff). */
export function TaskFormPage() {
  const { id } = useParams();
  const q = useQuery({
    queryKey: taskKey(id ?? ''),
    enabled: !!id,
    queryFn: () => unwrap(api.GET('/api/tasks/{id}', { params: { path: { id: id! } } })),
  });
  const defs = useFieldDefs('task');
  if ((id && q.isPending) || defs.isPending) return <Skeleton height={320} />;
  if (id && q.isError) return <ErrorMessage text={errorOf(q.error)} />;
  if (defs.isError) return <ErrorMessage text={errorOf(defs.error)} />;
  return <TaskForm task={q.data} defs={defs.data} />;
}

function TaskForm({ task, defs }: { task?: TaskDetail; defs: FieldDef[] }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(
    task ? fromTask(task) : { title: '', description: '', points: '10', maxAssignees: '1', due: '' },
  );
  const [extra, setExtra] = useState<Record<string, FormValue>>(() =>
    Object.fromEntries(defs.filter((d) => !d.archived).map((d) => [d.key, toForm(d, task?.extra[d.key])])),
  );
  const today = kyivParts(new Date()).date;

  const points = Number(f.points);
  const max = Number(f.maxAssignees);
  const invalid = !f.title.trim()
    ? 'Вкажіть назву.'
    : !Number.isInteger(points) || points < 0 || points > 1000
      ? 'Бали — ціле число від 0 до 1000.'
      : !Number.isInteger(max) || max < 1 || max > 20
        ? 'Виконавців — від 1 до 20.'
        : task && max < task.assignees.length
          ? `ТЗ уже взяли ${task.assignees.length}: ліміт не може бути меншим.`
          : (defs.map((d) => (d.archived ? null : fieldProblem(d, extra[d.key] ?? ''))).find(Boolean) ?? null);

  const save = useMutation({
    mutationFn: () => {
      const dueDate = f.due ? kyivToDate(f.due, DUE_TIME).toISOString() : null;
      const body = { title: f.title.trim(), description: f.description, points, maxAssignees: max };
      const ex = extraBody(defs, extra, task?.extra);
      const withExtra = Object.keys(ex).length ? { extra: ex } : {};
      if (!task) {
        return unwrap(api.POST('/api/tasks', { body: { ...body, ...(dueDate ? { dueDate } : {}), ...withExtra } }));
      }
      return unwrap(api.PATCH('/api/tasks/{id}', { params: { path: { id: task.id } }, body: { ...body, dueDate, ...withExtra } }));
    },
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void navigate(`/tasks/${t.id}`);
    },
  });

  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF((v) => ({ ...v, [k]: e.target.value }));
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!invalid) save.mutate();
  };

  return (
    <>
      <Link to={task ? `/tasks/${task.id}` : '/tasks'} className="btn btn-ghost">
        <Icon name="back" size={20} />
        {task ? 'ТЗ' : 'Дошка'}
      </Link>
      <PageHeader title={task ? 'Редагувати ТЗ' : 'Нове ТЗ'} />
      <Card>
        <form className={s.form} onSubmit={onSubmit} noValidate>
          <div className="field">
            <label htmlFor="t-title">Назва</label>
            <input id="t-title" maxLength={200} value={f.title} onChange={set('title')} />
          </div>
          <div className="field">
            <label htmlFor="t-desc">Опис</label>
            <textarea id="t-desc" maxLength={5000} value={f.description} onChange={set('description')} />
          </div>
          <div className={s.formRow}>
            <div className="field">
              <label htmlFor="t-points">Бали</label>
              <input id="t-points" type="number" inputMode="numeric" min={0} max={1000} value={f.points} onChange={set('points')} />
            </div>
            <div className="field">
              <label htmlFor="t-max">Максимум виконавців</label>
              <input id="t-max" type="number" inputMode="numeric" min={1} max={20} value={f.maxAssignees} onChange={set('maxAssignees')} />
            </div>
            <div className="field">
              <label htmlFor="t-due">Дедлайн</label>
              <input id="t-due" type="date" min={task ? undefined : today} value={f.due} onChange={set('due')} />
            </div>
          </div>
          <p className="hint">Бали діляться порівну між виконавцями після прийняття. Дедлайн — до кінця вибраного дня.</p>
          <ExtraInputs idPrefix="t-extra" defs={defs} values={extra} onChange={(k, v) => setExtra((e) => ({ ...e, [k]: v }))} />
          <ErrorMessage text={invalid && f.title ? invalid : save.isError ? errorOf(save.error) : null} />
          <div className={s.cardActions}>
            <button type="submit" className="btn btn-primary" disabled={!!invalid || save.isPending}>
              {save.isPending ? 'Зберігаємо…' : task ? 'Зберегти' : 'Створити'}
            </button>
            <Link to={task ? `/tasks/${task.id}` : '/tasks'} className="btn btn-ghost">
              Скасувати
            </Link>
          </div>
        </form>
      </Card>
    </>
  );
}
