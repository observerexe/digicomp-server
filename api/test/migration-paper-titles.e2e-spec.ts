import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { Role } from '../src/users/user.entity';
import {
  createTestApp,
  makeUser,
  publishTaskPaper,
  resetDb,
  taskTemplates,
} from './helpers';

// Міграція 6.6в: документи ТЗ і проєктів, зроблені раніше з назвою шаблону
// («Коротке ТЗ»), беруть назву свого запису. Перейменовані людьми — ні.
// Відкат повертає назву шаблону тим, що досі звуться як запис.

const MIGRATION = 'PaperTitlesFromRecords1831000000000';

describe('Міграція назв документів (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
  });

  afterAll(async () => {
    await ds.runMigrations({ transaction: 'all' });
    await app.close();
  });

  async function undoThrough(name: string) {
    for (;;) {
      const [last] = await ds.query<{ name: string }[]>(
        `SELECT name FROM migrations ORDER BY id DESC LIMIT 1`,
      );
      if (!last) throw new Error(`Migration ${name} is not applied`);
      await ds.undoLastMigration({ transaction: 'all' });
      if (last.name === name) return;
    }
  }

  const titles = async () =>
    (
      await ds.query<{ title: string }[]>(
        `SELECT title FROM papers ORDER BY created_at, title`,
      )
    ).map((r) => r.title);

  it('up: назва шаблону → назва ТЗ, перейменований лишається; down — назад', async () => {
    await resetDb(app);
    const admin = await makeUser(app, Role.Admin);
    const { short } = await taskTemplates(app);
    const ids: string[] = [];
    for (const title of ['Афіша', 'Стенд']) {
      const res = await publishTaskPaper(app, admin, short, {
        title,
        points: 1,
      });
      ids.push((res.body as { id: string }).id);
    }
    await undoThrough(MIGRATION);
    // As before the rule: the template's title; one renamed by hand.
    await ds.query(`UPDATE papers SET title = 'Коротке ТЗ' WHERE id = $1`, [
      ids[0],
    ]);
    await ds.query(`UPDATE papers SET title = 'Моя назва' WHERE id = $1`, [
      ids[1],
    ]);

    await ds.runMigrations({ transaction: 'all' });
    expect(await titles()).toEqual(['Афіша', 'Моя назва']);

    await undoThrough(MIGRATION);
    expect(await titles()).toEqual(['Коротке ТЗ', 'Моя назва']);
  });
});
