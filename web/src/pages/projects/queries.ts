import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '../../api/client';
import type { Me, ProjectListItem, ProjectStage } from '../../api/types';

export const STAGES: { key: ProjectStage; title: string }[] = [
  { key: 'idea', title: 'Ідея' },
  { key: 'planning', title: 'Планування' },
  { key: 'execution', title: 'Виконання' },
  { key: 'review', title: 'Перевірка' },
  { key: 'done', title: 'Завершено' },
];

/** Staff edit any project, a member only the ones they are in (API: ProjectsUpdate). */
export function canEditProject(p: Pick<ProjectListItem, 'members'>, me: Me, can: (a: string) => boolean): boolean {
  return can('projects.manage') || p.members.some((m) => m.id === me.id);
}

export const projectKey = (id: string) => ['projects', 'one', id] as const;
type BoardData = { items: ProjectListItem[]; total: number; page: number; limit: number };

export function useProjects(memberId: string | null) {
  return useQuery({
    queryKey: ['projects', 'board', memberId],
    queryFn: () =>
      unwrap(api.GET('/api/projects', { params: { query: { limit: '100', ...(memberId ? { memberId } : {}) } } })),
  });
}

/** Stage change from the board: the card moves at once, rolls back on an error. */
export function useMoveProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: ProjectStage }) =>
      unwrap(api.PATCH('/api/projects/{id}', { params: { path: { id } }, body: { stage } })),
    onMutate: async ({ id, stage }) => {
      await qc.cancelQueries({ queryKey: ['projects', 'board'] });
      const before = qc.getQueriesData<BoardData>({ queryKey: ['projects', 'board'] });
      for (const [key, data] of before) {
        if (data) qc.setQueryData(key, { ...data, items: data.items.map((p) => (p.id === id ? { ...p, stage } : p)) });
      }
      return { before };
    },
    onError: (_e, _v, ctx) => {
      for (const [key, data] of ctx?.before ?? []) qc.setQueryData(key, data);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['projects'] }),
  });
}
