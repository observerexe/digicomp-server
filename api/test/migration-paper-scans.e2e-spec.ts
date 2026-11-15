import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { createTestApp, resetDb } from './helpers';

// Міграція 4.2а: знімок отримує посилання на архівний запис своїх сканів.
// Наявні знімки нічого не втрачають; відкат прибирає колонку.

const MIGRATION = 'PaperScans1817000000000';

describe('Міграція сканів знімків (e2e)', () => {
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

  const column = async () =>
    (
      await ds.query<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'paper_snapshots' AND column_name = 'archive_doc_id'`,
      )
    ).length;

  it('наявні знімки лишаються без скану; відкат прибирає колонку', async () => {
    await resetDb(app);
    const [{ id: userId }] = await ds.query<{ id: string }[]>(
      `INSERT INTO users (email, name, password_hash) VALUES ('m@t', 'Автор', 'x') RETURNING id`,
    );
    const [{ id: paperId }] = await ds.query<{ id: string }[]>(
      `INSERT INTO papers (title, content, author_id, status) VALUES ('Лист', '{"type":"doc","content":[]}', $1, 'frozen') RETURNING id`,
      [userId],
    );
    await undoThrough(MIGRATION);
    expect(await column()).toBe(0);
    await ds.query(
      `INSERT INTO paper_snapshots (paper_id, n, html, sha256, resolved_values, created_by_id)
       VALUES ($1, 1, '<main></main>', repeat('a', 64), '{}', $2)`,
      [paperId, userId],
    );

    await ds.runMigrations({ transaction: 'all' });
    expect(await column()).toBe(1);
    expect(
      await ds.query(
        `SELECT paper_id, n, html, archive_doc_id FROM paper_snapshots`,
      ),
    ).toEqual([
      { paper_id: paperId, n: 1, html: '<main></main>', archive_doc_id: null },
    ]);

    await undoThrough(MIGRATION);
    expect(await column()).toBe(0);
    expect(
      await ds.query(`SELECT paper_id, n, html FROM paper_snapshots`),
    ).toEqual([{ paper_id: paperId, n: 1, html: '<main></main>' }]);
  });
});
