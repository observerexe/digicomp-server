import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '../../api/client';
import type { Me, Task, TaskStatus } from '../../api/types';
import { predict, type ActionKind } from './logic';

export const DONE_PAGE = 30;
export const boardKey = (mine: boolean, doneLimit: number) => ['tasks', 'board', { mine, doneLimit }] as const;
export const taskKey = (id: string) => ['tasks', 'one', id] as const;

const ACTIVE: TaskStatus[] = ['todo', 'queued', 'in_progress', 'review'];

/** Active tasks in full, done ones — the last `doneLimit` completed. */
export function useBoard(mine: boolean, doneLimit: number) {
  return useQuery({
    queryKey: boardKey(mine, doneLimit),
    queryFn: async () => {
      const m = mine ? ({ mine: 'true' } as const) : {};
      const parts = await Promise.all([
        ...ACTIVE.map((status) => unwrap(api.GET('/api/tasks', { params: { query: { status, ...m } } }))),
        unwrap(api.GET('/api/tasks', { params: { query: { status: 'done', limit: String(doneLimit + 1), ...m } } })),
      ]);
      const done = parts.pop()!;
      return { tasks: [...parts.flat(), ...done.slice(0, doneLimit)], moreDone: done.length > doneLimit };
    },
  });
}

type Vars = { task: Task; kind: ActionKind; body?: string };

/**
 * A move on the board: the card moves at once (optimistic), the API decides;
 * on an error the board goes back to what it was.
 */
export function useTaskAction(me: Me | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ task, kind, body }: Vars) => {
      const path = { params: { path: { id: task.id } } };
      switch (kind) {
        case 'take':
          return unwrap(api.POST('/api/tasks/{id}/take', path));
        case 'leave':
          return unwrap(api.POST('/api/tasks/{id}/leave', path));
        case 'start':
          return unwrap(api.POST('/api/tasks/{id}/start', path));
        case 'submit':
          return unwrap(api.POST('/api/tasks/{id}/submit', path));
        case 'accept':
          return unwrap(api.POST('/api/tasks/{id}/accept', path));
        case 'return':
          return unwrap(api.POST('/api/tasks/{id}/return', { ...path, body: { body: body ?? '' } }));
      }
    },
    onMutate: async ({ task, kind }) => {
      await qc.cancelQueries({ queryKey: ['tasks', 'board'] });
      const before = qc.getQueriesData<{ tasks: Task[]; moreDone: boolean }>({ queryKey: ['tasks', 'board'] });
      if (me) {
        const next = predict(task, kind, me);
        for (const [key, data] of before) {
          if (data) qc.setQueryData(key, { ...data, tasks: data.tasks.map((t) => (t.id === task.id ? next : t)) });
        }
      }
      return { before };
    },
    onError: (_e, _v, ctx) => {
      for (const [key, data] of ctx?.before ?? []) qc.setQueryData(key, data);
    },
    onSettled: (_d, _e, { task }) => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: taskKey(task.id) });
      // Accepting gives points.
      void qc.invalidateQueries({ queryKey: ['points'] });
    },
  });
}
