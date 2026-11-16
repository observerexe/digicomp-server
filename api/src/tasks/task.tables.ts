import { dayText } from '../paperwork/content';
import { TABLE_MAX_ROWS, type TableSource } from '../paperwork/tables';
import { Task } from './task.entities';
import { TASK_SCHEMA } from './task.schema';

const STATUS = new Map(
  TASK_SCHEMA.fields
    .find((f) => f.key === 'status')!
    .options!.map((o) => [o.key, o.label]),
);

/**
 * «Технічні завдання проєкту»: tasks linked with a project (either way), as the board
 * shows them — everyone sees tasks. Oldest first.
 */
export const PROJECT_TASKS: TableSource = {
  label: 'Технічні завдання проєкту',
  input: 'ref:project',
  columns: ['Назва', 'Документ', 'Стан', 'Виконавці', 'Бали', 'Виконано'],
  async rows(projectId, _reader, m) {
    const [list, total] = await m
      .getRepository(Task)
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.assignees', 'a')
      .leftJoinAndSelect('a.user', 'u')
      .where(
        `t.id IN (SELECT l.to_id FROM record_links l
                   WHERE l.from_type = 'project' AND l.from_id = :projectId AND l.to_type = 'task'
                  UNION
                  SELECT l.from_id FROM record_links l
                   WHERE l.to_type = 'project' AND l.to_id = :projectId AND l.from_type = 'task')`,
        { projectId },
      )
      .orderBy('t.createdAt', 'DESC')
      .addOrderBy('t.id', 'DESC')
      .addOrderBy('a.takenAt', 'ASC')
      .take(TABLE_MAX_ROWS)
      .getManyAndCount();
    const numbers = new Map<string, string>();
    if (list.length) {
      const papers = await m.query<{ id: string; number: string }[]>(
        `SELECT "target_id" AS "id", "number" FROM "papers"
          WHERE "target_type" = 'task' AND "target_id" = ANY($1) AND "number" IS NOT NULL`,
        [list.map((t) => t.id)],
      );
      for (const p of papers) numbers.set(p.id, p.number);
    }
    return {
      rows: list
        .reverse()
        .map((t) => [
          t.title,
          numbers.get(t.id) ?? '',
          STATUS.get(t.status) ?? t.status,
          t.assignees.map((a) => a.user.name).join(', '),
          String(t.points),
          t.completedAt ? dayText(t.completedAt) : '',
        ]),
      more: total - list.length,
    };
  },
};
