import type { DisciplineRecord, PointsHistoryEntry, ProjectStage, Role, TaskStatus } from '../api/types';

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Адміністратор',
  moderator: 'Модератор',
  member: 'Учасник',
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'Вільне',
  queued: 'У черзі',
  in_progress: 'В роботі',
  review: 'На перевірці',
  done: 'Виконано',
};

export const PROJECT_STAGE_LABEL: Record<ProjectStage, string> = {
  idea: 'Ідея',
  planning: 'Планування',
  execution: 'Виконання',
  review: 'Перевірка',
  done: 'Завершено',
};

export function disciplineTitle(r: Pick<DisciplineRecord, 'type' | 'amount'>): string {
  if (r.type === 'fine') return `Штраф −${r.amount ?? 0}`;
  return r.type === 'warning' ? 'Попередження' : 'Догана';
}

/** "За що" in the points history. */
export function pointsReason(e: PointsHistoryEntry): string {
  if (e.kind === 'task' && e.taskTitle) return `ТЗ «${e.taskTitle}»`;
  return e.reason || (e.kind === 'reversal' ? 'Скасування нарахування' : '—');
}
