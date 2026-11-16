import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { createTestApp, resetDb } from './helpers';

// Міграція 6.5а: знімок пам'ятає, кого чекають його лінії підпису
// (`signers`), підписи — окрема таблиця. Наявні знімки нічого не втрачають
// і лишаються без ліній (лише скан); відкат прибирає колонку й таблицю.

const MIGRATION = 'PaperSignatures1828000000000';

describe('Міграція графічних підписів (e2e)', () => {
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

  const exists = async () => {
    const [{ column, table }] = await ds.query<
      { column: number; table: number }[]
    >(
      `SELECT
         (SELECT count(*)::int FROM information_schema.columns
           WHERE table_name = 'paper_snapshots' AND column_name = 'signers') AS "column",
         (SELECT count(*)::int FROM information_schema.tables
           WHERE table_name = 'paper_signatures') AS "table"`,
    );
    return column + table;
  };

  it('наявні знімки лишаються як були, без ліній; відкат прибирає колонку й таблицю', async () => {
    await resetDb(app);
    const [{ id: userId }] = await ds.query<{ id: string }[]>(
      `INSERT INTO users (email, name, password_hash) VALUES ('m@t', 'Автор', 'x') RETURNING id`,
    );
    const [{ id: paperId }] = await ds.query<{ id: string }[]>(
      `INSERT INTO papers (title, content, author_id, status) VALUES ('Лист', '{"type":"doc","content":[]}', $1, 'frozen') RETURNING id`,
      [userId],
    );
    await undoThrough(MIGRATION);
    expect(await exists()).toBe(0);
    await ds.query(
      `INSERT INTO paper_snapshots (paper_id, n, html, sha256, resolved_values, created_by_id)
       VALUES ($1, 1, '<main></main>', repeat('a', 64), '{}', $2)`,
      [paperId, userId],
    );

    await ds.runMigrations({ transaction: 'all' });
    expect(await exists()).toBe(2);
    expect(
      await ds.query(
        `SELECT paper_id, n, html, sha256, signers FROM paper_snapshots`,
      ),
    ).toEqual([
      {
        paper_id: paperId,
        n: 1,
        html: '<main></main>',
        sha256: 'a'.repeat(64),
        signers: null,
      },
    ]);

    await undoThrough(MIGRATION);
    expect(await exists()).toBe(0);
    expect(
      await ds.query(`SELECT paper_id, n, html FROM paper_snapshots`),
    ).toEqual([{ paper_id: paperId, n: 1, html: '<main></main>' }]);
  });
});
