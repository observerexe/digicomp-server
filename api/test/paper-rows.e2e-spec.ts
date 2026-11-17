import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { RecordLink } from '../src/links/record-link.entity';
import { Role } from '../src/users/user.entity';
import {
  as,
  createTestApp,
  makeUser,
  resetDb,
  TestUser,
  SIGNED,
} from './helpers';

// «Повторювані рядки» (3.3а): шаблон з блоком рядків, документ — рядки в
// значеннях, публікація прибирає порожні рядки й вимагає обов'язкові клітинки,
// друк — рядок на кожне значення, посилання з клітинок — у record_links.

type Node = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
  text?: string;
};
type PaperField = {
  key: string;
  type: string;
  columns: PaperField[] | null;
  canFill: boolean;
};
type Paper = {
  id: string;
  revision: number;
  status: string;
  values: Record<string, unknown>;
  template: { fields: PaperField[] } | null;
};

const field = (key: string, over: Record<string, unknown> = {}) => ({
  key,
  label: key,
  type: 'text',
  required: false,
  fill: 'author',
  editable: false,
  print: true,
  ...over,
});
const p = (...content: Node[]): Node => ({ type: 'paragraph', content });
const text = (t: string): Node => ({ type: 'text', text: t });
const cell = (type: string, ...content: Node[]): Node => ({
  type,
  content: [p(...content)],
});
const fieldNode = (key: string): Node => ({ type: 'field', attrs: { key } });

/** «Відомість»: № | Учасник | Бали | За що — the last row repeats. */
const body: Node = {
  type: 'doc',
  content: [
    p(text('Відомість')),
    {
      type: 'repeat',
      attrs: { key: 'entries' },
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                cell('tableHeader', text('№')),
                cell('tableHeader', text('Учасник')),
                cell('tableHeader', text('Бали')),
                cell('tableHeader', text('За що')),
              ],
            },
            {
              type: 'tableRow',
              content: [
                cell('tableCell', { type: 'rowNumber' }),
                cell('tableCell', fieldNode('member')),
                cell('tableCell', fieldNode('points')),
                cell('tableCell', fieldNode('reason')),
              ],
            },
          ],
        },
      ],
    },
  ],
};
const fields = [
  field('entries', { type: 'rows', label: 'Нарахування', required: true }),
  field('member', { type: 'ref:user', label: 'Учасник', required: true }),
  field('points', { type: 'int', label: 'Бали', min: 1, max: 100 }),
  field('reason', { label: 'За що' }),
];

describe('Повторювані рядки (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let mod: TestUser;
  let member: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    mod = await makeUser(app, Role.Moderator, { name: 'Олена Коваль' });
    member = await makeUser(app, Role.Member, { name: 'Іван Петренко' });
  });

  const T = '/api/papers/templates';
  const template = async (f = fields, b = body) => {
    const t = (
      await as(app, mod)
        .post(T)
        .send({ title: 'Відомість', kind: 'free', creators: 'all' })
        .expect(201)
    ).body as { id: string };
    await as(app, mod)
      .patch(`${T}/${t.id}/versions/1`)
      .send({ revision: 1, fields: f, body: b })
      .expect(200);
    return t.id;
  };
  const published = async () => {
    const id = await template();
    await as(app, mod).post(`${T}/${id}/versions/1/publish`).expect(201);
    return id;
  };
  const newPaper = async (templateId: string) =>
    (await as(app, member).post('/api/papers').send({ templateId }).expect(201))
      .body as Paper;
  const save = (pp: Paper, values: Record<string, unknown>) =>
    as(app, member)
      .patch(`/api/papers/${pp.id}`)
      .send({ revision: pp.revision, values });
  const get = async (id: string) =>
    (await as(app, member).get(`/api/papers/${id}`).expect(200)).body as Paper;

  it('шаблон з блоком рядків публікується; стовпець поза блоком — TEMPLATE_FIELD_INVALID', async () => {
    await published();
    const id = await template(fields, {
      ...body,
      content: [...body.content!, p(fieldNode('points'))],
    });
    const res = await as(app, mod)
      .post(`${T}/${id}/versions/1/publish`)
      .expect(400);
    expect(res.body).toMatchObject({
      errorCode: 'TEMPLATE_FIELD_INVALID',
      field: 'points',
    });
  });

  it('документ: стовпці — усередині поля рядків; рядки зберігаються з порожнім, що щойно додали', async () => {
    const pp = await newPaper(await published());
    const rows = pp.template!.fields.find((f) => f.key === 'entries')!;
    expect(pp.template!.fields.map((f) => f.key)).toEqual(['entries']);
    expect(rows.columns!.map((c) => [c.key, c.canFill])).toEqual([
      ['member', true],
      ['points', true],
      ['reason', true],
    ]);
    await save(pp, {
      entries: [{ member: mod.id, points: 5, reason: 'Монтаж' }, {}],
    }).expect(200);
    expect((await get(pp.id)).values).toEqual({
      entries: [{ member: mod.id, points: 5, reason: 'Монтаж' }, {}],
    });
  });

  it('недійсна клітинка — PAPER_FIELD_INVALID з полем і рядком; невідомий запис — теж', async () => {
    const pp = await newPaper(await published());
    const bad = await save(pp, {
      entries: [{ member: mod.id }, { points: 0 }],
    }).expect(400);
    expect(bad.body).toMatchObject({
      errorCode: 'PAPER_FIELD_INVALID',
      field: 'entries',
      row: 1,
    });
    const lost = await save(pp, {
      entries: [
        { member: mod.id },
        { member: '99999999-9999-4999-8999-999999999999' },
      ],
    }).expect(400);
    expect(lost.body).toMatchObject({
      errorCode: 'PAPER_FIELD_INVALID',
      field: 'entries',
      row: 1,
    });
  });

  it('публікація: порожні рядки йдуть; обов’язкова клітинка — з рядком; без рядків — обов’язкове поле', async () => {
    const id = await published();
    const empty = await newPaper(id);
    await save(empty, { entries: [{}] }).expect(200);
    const none = await as(app, member)
      .post(`/api/papers/${empty.id}/publish`)
      .send(SIGNED)
      .expect(400);
    expect(none.body).toMatchObject({
      errorCode: 'PAPER_REQUIRED_MISSING',
      field: 'entries',
    });
    expect(none.body.row).toBeUndefined();

    const pp = await newPaper(id);
    await save(pp, {
      entries: [{}, { points: 3 }, { member: member.id, points: 4 }],
    }).expect(200);
    const cell = await as(app, member)
      .post(`/api/papers/${pp.id}/publish`)
      .send(SIGNED)
      .expect(400);
    expect(cell.body).toMatchObject({
      errorCode: 'PAPER_REQUIRED_MISSING',
      field: 'entries',
      row: 1,
    });

    const now = await get(pp.id);
    await save(now, {
      entries: [{}, { member: mod.id, points: 3 }, {}, { member: member.id }],
    }).expect(200);
    await as(app, member)
      .post(`/api/papers/${pp.id}/publish`)
      .send(SIGNED)
      .expect(200);
    const done = await get(pp.id);
    expect(done.status).toBe('published');
    expect(done.values).toEqual({
      entries: [{ member: mod.id, points: 3 }, { member: member.id }],
    });
  });

  it('друк: шапка, рядок на кожне значення з номером; посилання з клітинок — зв’язки з роллю стовпця', async () => {
    const pp = await newPaper(await published());
    await save(pp, {
      entries: [
        { member: mod.id, points: 5, reason: 'Монтаж' },
        { member: member.id, points: 2 },
        { member: mod.id, points: 1 },
      ],
    }).expect(200);
    const html = (
      await as(app, member).get(`/api/papers/${pp.id}/print`).expect(200)
    ).text;
    expect(html).toContain('<th><p>Учасник</p></th>');
    expect(html).toContain(
      '<tr><td><p>1</p></td><td><p><span class="paper-field">Олена Коваль</span></p></td><td><p><span class="paper-field">5</span></p></td><td><p><span class="paper-field">Монтаж</span></p></td></tr>',
    );
    expect(html).toContain(
      '<tr><td><p>2</p></td><td><p><span class="paper-field">Іван Петренко</span></p></td><td><p><span class="paper-field">2</span></p></td><td><p><span class="paper-field-blank"></span></p></td></tr>',
    );
    expect(html).toContain('<td><p>3</p></td>');
    const links = (
      await ds.getRepository(RecordLink).findBy({ fromType: 'paper' })
    )
      .map((l) => `${l.toType}:${l.toId}:${l.role}`)
      .sort();
    expect(links).toEqual(
      [`user:${mod.id}:member`, `user:${member.id}:member`].sort(),
    );
  });

  it('вільний документ з блоком рядків — PAPER_CONTENT_LOCKED', async () => {
    const res = await as(app, member)
      .post('/api/papers')
      .send({ title: 'Вільний', content: body })
      .expect(400);
    expect(res.body.errorCode).toBe('PAPER_CONTENT_LOCKED');
  });
});
