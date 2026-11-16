import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import {
  PROJECT_INVENTORY_TEMPLATES,
  ProjectInventoryTemplates1823000000000,
} from '../src/migrations/1823000000000-ProjectInventoryTemplates';
import { Task, TaskStatus } from '../src/tasks/task.entities';
import { Role } from '../src/users/user.entity';
import {
  as,
  category,
  createTestApp,
  makeUser,
  resetDb,
  TestUser,
} from './helpers';

// Проєкти й склад (5.4): «Акт списання» — рядок = списання (рух складу з
// мінусом, що посилається на акт); скасування повертає списане новими рухами.
// «Паспорт проєкту» й «Підсумковий звіт» — звіти про проєкт з авто-таблицями
// «ТЗ проєкту» й «Матеріали проєкту». Шаблони — з міграції.

type Res = { status: number; body: Record<string, any> };
type Table = { columns: string[]; rows: string[][] | null };

const YEAR = new Intl.DateTimeFormat('en', {
  timeZone: 'Europe/Kyiv',
  year: 'numeric',
}).format(new Date());

const [PASSPORT, SUMMARY, ACT] = PROJECT_INVENTORY_TEMPLATES.map(
  (t) => t.id,
) as [string, string, string];

function code(res: Res, status: number, errorCode: string) {
  expect(res.status).toBe(status);
  expect(res.body.errorCode).toBe(errorCode);
}

type Row = { item?: string; quantity?: number; reason?: string };

describe('Проєкти й склад через документи (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let admin: TestUser;
  let mod: TestUser;
  let member: TestUser;
  let wire: string;
  let glue: string;

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  const item = async (
    code: string,
    title: string,
    quantity: number,
    unit = 'шт',
  ) =>
    (
      await as(app, admin)
        .post('/api/inventory/items')
        .send({
          code,
          title,
          category: await category(app, 'inventory_category', 'Матеріали'),
          quantity,
          unit,
        })
        .expect(201)
    ).body.id as string;

  beforeEach(async () => {
    await resetDb(app);
    admin = await makeUser(app, Role.Admin, { name: 'Адмін Перший' });
    mod = await makeUser(app, Role.Moderator, { name: 'Марта Модер' });
    member = await makeUser(app, Role.Member, { name: 'Олена Перша' });
    const runner = ds.createQueryRunner();
    await new ProjectInventoryTemplates1823000000000().up(runner);
    await runner.release();
    wire = await item('WIRE-1', 'Дріт', 10);
    glue = await item('GLUE-1', 'Клей', 2.5, 'кг');
  });

  const quantity = async (id: string) =>
    (await as(app, member).get(`/api/inventory/items/${id}`).expect(200)).body
      .quantity as number;

  /** «Акт списання» by `who` with these rows; the response of the first request that failed, or of publish. */
  async function publishAct(who: TestUser, rows: Row[]): Promise<Res> {
    const p = await as(app, who).post('/api/papers').send({ templateId: ACT });
    if (p.status !== 201) return p;
    const saved = await as(app, who)
      .patch(`/api/papers/${p.body.id}`)
      .send({ revision: p.body.revision, values: { items: rows } });
    if (saved.status !== 200) return saved;
    return as(app, who).post(`/api/papers/${p.body.id}/publish`);
  }

  describe('«Акт списання»', () => {
    it('кожен рядок — рух з мінусом, що посилається на акт; акт фіксується сам', async () => {
      const res = await publishAct(mod, [
        { item: wire, quantity: 3, reason: 'обірвався' },
        {},
        { item: glue, quantity: 0.5, reason: 'засох' },
      ]);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'frozen',
        number: `АС-${YEAR}-001`,
        targetType: 'inventory_writeoff',
        targetId: null,
      });
      expect(await quantity(wire)).toBe(7);
      expect(await quantity(glue)).toBe(2);

      const moves = await as(app, member)
        .get('/api/inventory/movements')
        .query({ itemId: wire })
        .expect(200);
      expect(moves.body.items[0]).toMatchObject({
        delta: -3,
        quantityAfter: 7,
        note: 'обірвався',
        actor: { id: mod.id },
        paper: { id: res.body.id, number: res.body.number },
      });
      // Made before: no act.
      expect(moves.body.items[1]).toMatchObject({ delta: 10, paper: null });

      const links = await ds.query<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM record_links WHERE from_type = 'paper' AND from_id = $1 AND role = '@target' AND to_type = 'inventory_writeoff'`,
        [res.body.id],
      );
      expect(links[0]!.n).toBe(2);
      // Stock is seen by everyone: so is the act.
      await as(app, member).get(`/api/papers/${res.body.id}`).expect(200);
    });

    it('на складі менше — INSUFFICIENT_STOCK з рядком; нічого не списано й номер не витрачено', async () => {
      const res = await publishAct(mod, [
        { item: wire, quantity: 3, reason: 'r' },
        { item: glue, quantity: 3, reason: 'r' },
      ]);
      code(res, 409, 'INSUFFICIENT_STOCK');
      expect(res.body).toMatchObject({ field: 'items', row: 1 });
      expect(await quantity(wire)).toBe(10);
      const ok = await publishAct(mod, [
        { item: wire, quantity: 1, reason: 'r' },
      ]);
      expect(ok.body.number).toBe(`АС-${YEAR}-001`);
    });

    it('дробове для «шт» — INTEGER_REQUIRED з рядком', async () => {
      const res = await publishAct(mod, [
        { item: wire, quantity: 1.5, reason: 'r' },
      ]);
      code(res, 400, 'INTEGER_REQUIRED');
      expect(res.body).toMatchObject({ field: 'items', row: 0 });
    });

    it('скасування повертає списане новими рухами; журнал не змінюється', async () => {
      const act = await publishAct(mod, [
        { item: wire, quantity: 4, reason: 'обірвався' },
      ]);
      expect(await quantity(wire)).toBe(6);
      const cancelled = await as(app, mod)
        .post(`/api/papers/${act.body.id}/cancel`)
        .send({ reason: 'знайшли на полиці' })
        .expect(200);
      expect(cancelled.body.status).toBe('cancelled');
      expect(await quantity(wire)).toBe(10);
      const moves = await as(app, member)
        .get('/api/inventory/movements')
        .query({ itemId: wire })
        .expect(200);
      expect(
        moves.body.items.map((m: { delta: number; note: string }) => [
          m.delta,
          m.note,
        ]),
      ).toEqual([
        [4, 'Скасовано списання: знайшли на полиці'],
        [-4, 'обірвався'],
        [10, 'Початковий залишок'],
      ]);
      expect(moves.body.items[0].paper).toEqual({
        id: act.body.id,
        number: act.body.number,
      });
    });

    it('учасник акт не створює', async () => {
      code(
        await as(app, member).post('/api/papers').send({ templateId: ACT }),
        404,
        'TEMPLATE_NOT_FOUND',
      );
    });

    it('з позиції — новий акт з нею в першому рядку', async () => {
      const p = await as(app, mod)
        .post('/api/papers')
        .send({ templateId: ACT, about: { type: 'inventory_item', id: glue } })
        .expect(201);
      expect(p.body.values.items).toEqual([{ item: glue }]);
    });
  });

  describe('звіти про проєкт', () => {
    let project: string;

    beforeEach(async () => {
      project = (
        await as(app, mod)
          .post('/api/projects')
          .send({
            title: 'Метеостанція',
            stage: 'execution',
            progress: 40,
            memberIds: [member.id],
          })
          .expect(201)
      ).body.id;
      const task = await ds.getRepository(Task).save({
        title: 'Зібрати корпус',
        points: 15,
        status: TaskStatus.Todo,
        createdById: mod.id,
      });
      await ds.query(
        `INSERT INTO record_links (from_type, from_id, to_type, to_id, role, created_by_id) VALUES ('task', $1, 'project', $2, '', $3)`,
        [task.id, project, mod.id],
      );
      await as(app, member)
        .post(`/api/inventory/items/${wire}/movements`)
        .send({ delta: -2, note: 'на корпус', projectId: project })
        .expect(201);
    });

    const report = async (templateId: string) =>
      (
        await as(app, mod)
          .post('/api/papers')
          .send({ templateId, about: { type: 'project', id: project } })
          .expect(201)
      ).body as {
        id: string;
        values: Record<string, unknown>;
        tables: Record<string, Table>;
      };

    it('«Паспорт проєкту»: поля проєкту й «ТЗ проєкту» вже в чернетці', async () => {
      const p = await report(PASSPORT);
      expect(p.values).toMatchObject({
        project,
        title: 'Метеостанція',
        stage: 'execution',
        progress: 40,
        members: [member.id],
        author: mod.id,
      });
      expect(p.tables['project_tasks:project']).toEqual({
        columns: ['Назва', 'Документ', 'Стан', 'Виконавці', 'Бали', 'Виконано'],
        caption: null,
        rows: [['Зібрати корпус', '', 'Вільне', '', '15', '']],
        more: 0,
      });
    });

    it('«Підсумковий звіт»: матеріали проєкту; після фіксації таблиці збережені', async () => {
      const p = await report(SUMMARY);
      const materials = p.tables['project_materials:project']!;
      expect(materials.columns).toEqual([
        'Дата',
        'Позиція',
        'Кількість',
        'Хто',
        'Для чого',
      ]);
      expect(materials.rows!.map((r) => r.slice(1))).toEqual([
        ['Дріт', '−2 шт', 'Олена Перша', 'на корпус'],
      ]);
      await as(app, mod).post(`/api/papers/${p.id}/publish`).expect(200);
      const frozen = await as(app, mod)
        .post(`/api/papers/${p.id}/freeze`)
        .expect(200);
      expect(frozen.body.status).toBe('frozen');
      expect(frozen.body.number).toBe(`ЗП-${YEAR}-001`);
      // Taken after the freeze: the frozen report keeps what it showed.
      await as(app, member)
        .post(`/api/inventory/items/${wire}/movements`)
        .send({ delta: -1, note: 'ще', projectId: project })
        .expect(201);
      const again = await as(app, member)
        .get(`/api/papers/${p.id}`)
        .expect(200);
      expect(again.body.tables['project_materials:project'].rows).toHaveLength(
        1,
      );
    });
  });
});
