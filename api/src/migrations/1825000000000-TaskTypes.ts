import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Editor 6.3: task types with colours. The dictionary «Тип технічного
 * завдання» with six items, and the task field «Тип» (`type`) — a choice
 * from it, required in new tasks. Every task there is gets «Інше».
 * The card shows the type as a colour stripe and a label; staff add types
 * in «Довідники». The templates that create tasks get the field in
 * TaskTypeTemplates.
 *
 * Keys are made from the titles (as the server makes them) and written out
 * here. An installation that already has such a dictionary or field stops
 * the migration and changes nothing. Revert: the field, the tasks' types
 * and the dictionary go.
 */

export const TASK_TYPE_DICTIONARY = {
  key: 'task_type',
  title: 'Тип технічного завдання',
};

export const TASK_TYPES = [
  { key: 'prohramuvannia', title: 'Програмування', color: 'blue' },
  { key: 'dyzain', title: 'Дизайн', color: 'purple' },
  { key: 'smm', title: 'SMM', color: 'orange' },
  { key: 'video', title: 'Відео', color: 'teal' },
  { key: 'k_3d_druk', title: '3D-друк', color: 'green' },
  { key: 'inshe', title: 'Інше', color: 'gray' },
] as const;

/** What existing tasks get. */
export const TASK_TYPE_OTHER = 'inshe';

export const TASK_TYPE_FIELD = { key: 'type', label: 'Тип' };

export class TaskTypes1825000000000 implements MigrationInterface {
  name = 'TaskTypes1825000000000';

  public async up(q: QueryRunner): Promise<void> {
    const taken = (await q.query(
      `SELECT 1 FROM "dictionaries" WHERE "key" = $1 OR lower("title") = lower($2)
       UNION ALL
       SELECT 1 FROM "record_field_defs" WHERE "record_type" = 'task' AND ("key" = $3 OR lower("label") = lower($4))`,
      [
        TASK_TYPE_DICTIONARY.key,
        TASK_TYPE_DICTIONARY.title,
        TASK_TYPE_FIELD.key,
        TASK_TYPE_FIELD.label,
      ],
    )) as unknown[];
    if (taken.length) {
      throw new Error(
        `TaskTypes: the dictionary «${TASK_TYPE_DICTIONARY.title}» (${TASK_TYPE_DICTIONARY.key}) or the task field «${TASK_TYPE_FIELD.label}» (${TASK_TYPE_FIELD.key}) exists already; rename or remove it and run the migration again`,
      );
    }
    const [dict] = (await q.query(
      `INSERT INTO "dictionaries" ("key", "title") VALUES ($1, $2) RETURNING "id"`,
      [TASK_TYPE_DICTIONARY.key, TASK_TYPE_DICTIONARY.title],
    )) as { id: string }[];
    for (const [position, t] of TASK_TYPES.entries()) {
      await q.query(
        `INSERT INTO "dictionary_items" ("dictionary_id", "key", "title", "color", "position") VALUES ($1, $2, $3, $4, $5)`,
        [dict.id, t.key, t.title, t.color, position],
      );
    }
    await q.query(
      `INSERT INTO "record_field_defs" ("record_type", "key", "label", "type", "required", "dictionary", "position")
       SELECT 'task', $1, $2, 'enum', true, $3, COALESCE(max("position") + 1, 0)
         FROM "record_field_defs" WHERE "record_type" = 'task'`,
      [TASK_TYPE_FIELD.key, TASK_TYPE_FIELD.label, TASK_TYPE_DICTIONARY.key],
    );
    await q.query(
      `UPDATE "tasks" SET "extra" = jsonb_set("extra", ARRAY[$1], to_jsonb($2::text))`,
      [TASK_TYPE_FIELD.key, TASK_TYPE_OTHER],
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`UPDATE "tasks" SET "extra" = "extra" - $1::text`, [
      TASK_TYPE_FIELD.key,
    ]);
    await q.query(
      `DELETE FROM "record_field_defs" WHERE "record_type" = 'task' AND "key" = $1`,
      [TASK_TYPE_FIELD.key],
    );
    await q.query(
      `DELETE FROM "dictionary_items" WHERE "dictionary_id" IN (SELECT "id" FROM "dictionaries" WHERE "key" = $1)`,
      [TASK_TYPE_DICTIONARY.key],
    );
    await q.query(`DELETE FROM "dictionaries" WHERE "key" = $1`, [
      TASK_TYPE_DICTIONARY.key,
    ]);
  }
}
