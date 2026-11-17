import { INestApplication } from '@nestjs/common';
import { existsSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AuditLog } from '../src/audit/audit-log.entity';
import { PaperImageUse } from '../src/paperwork/paper-image.entity';
import { PaperImagesService } from '../src/paperwork/paper-images.service';
import { Role } from '../src/users/user.entity';
import {
  as,
  createTestApp,
  makeUser,
  PNG_1PX,
  resetDb,
  TestUser,
  SIGNED,
} from './helpers';

// Зображення в документах (6.7а): файл у сховищі, у документі — лише id.
// Бачить той, хто завантажив, або хто бачить документ чи шаблон, де воно є;
// невикористані сервер прибирає через добу.

type Paper = { id: string; revision: number; status: string };

/** A PNG's header of the given size (the API reads no further). */
function png(width: number, height: number) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

const doc = (...content: unknown[]) => ({ type: 'doc', content });
const para = (text: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});
const image = (id: string, attrs: object = {}) => ({
  type: 'image',
  attrs: { id, ...attrs },
});

describe('Зображення в документах (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let admin: TestUser;
  let mod: TestUser;
  let member: TestUser;
  let member2: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    admin = await makeUser(app, Role.Admin);
    mod = await makeUser(app, Role.Moderator);
    member = await makeUser(app, Role.Member);
    member2 = await makeUser(app, Role.Member);
  });

  const upload = (u: TestUser, file: Buffer = PNG_1PX, name = 'a.png') =>
    as(app, u).post('/api/paper-images').attach('file', file, name);
  const uploaded = async (u: TestUser) =>
    ((await upload(u).expect(201)).body as { id: string }).id;
  const see = (u: TestUser, id: string) =>
    as(app, u).get(`/api/paper-images/${id}`);
  const code = (
    res: { status: number; body: { errorCode?: string } },
    status: number,
    errorCode: string,
  ) => {
    expect(res.status).toBe(status);
    expect(res.body.errorCode).toBe(errorCode);
  };
  const draft = async (u: TestUser, content: unknown) =>
    (
      await as(app, u)
        .post('/api/papers')
        .send({ title: 'Звіт', content })
        .expect(201)
    ).body as Paper;
  const get = async (u: TestUser, id: string) =>
    (await as(app, u).get(`/api/papers/${id}`).expect(200)).body as Paper;
  const save = async (u: TestUser, id: string, content: unknown) => {
    const { revision } = await get(u, id);
    return as(app, u).patch(`/api/papers/${id}`).send({ revision, content });
  };
  /** Published and visible to all. */
  const share = async (u: TestUser, id: string) => {
    await as(app, u).post(`/api/papers/${id}/publish`).send(SIGNED).expect(200);
    const { revision } = await get(admin, id);
    await as(app, admin)
      .patch(`/api/papers/${id}`)
      .send({ revision, visibility: 'members' })
      .expect(200);
  };
  const uses = (imageId: string) =>
    ds.getRepository(PaperImageUse).findBy({ imageId });
  const fileOf = (id: string) =>
    join(process.env.STORAGE_DIR!, 'paper-images', `${id}.png`);

  describe('завантаження', () => {
    it('PNG: id і розмір, файл у сховищі, аудит; віддається з nosniff і назавжди в кеші', async () => {
      const res = await upload(member).expect(201);
      expect(res.body).toEqual({
        id: expect.any(String) as string,
        width: 1,
        height: 1,
      });
      const id = (res.body as { id: string }).id;
      expect(existsSync(fileOf(id))).toBe(true);
      const log = await ds
        .getRepository(AuditLog)
        .findBy({ action: 'paper.image_uploaded', entityId: id });
      expect(log).toHaveLength(1);
      expect(log[0]!.actorId).toBe(member.id);

      const img = await see(member, id).expect(200);
      expect(img.headers['content-type']).toBe('image/png');
      expect(img.headers['x-content-type-options']).toBe('nosniff');
      expect(img.headers['cache-control']).toBe(
        'private, max-age=31536000, immutable',
      );
      expect(Buffer.compare(img.body as Buffer, PNG_1PX)).toBe(0);
    });

    it('тип — за вмістом, не за назвою; без файлу; понад 2000 px; понад 5 МБ', async () => {
      code(
        await upload(member, Buffer.from('%PDF-1.7 x'), 'a.png'),
        400,
        'FILE_TYPE_NOT_ALLOWED',
      );
      code(
        await upload(
          member,
          Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'),
          'a.webp',
        ),
        400,
        'FILE_TYPE_NOT_ALLOWED',
      );
      expect((await upload(member, PNG_1PX, 'scan.pdf')).status).toBe(201);
      code(
        await as(app, member).post('/api/paper-images'),
        400,
        'FILE_REQUIRED',
      );
      code(await upload(member, png(2001, 10)), 400, 'IMAGE_TOO_LARGE');
      expect((await upload(member, png(2000, 2000))).status).toBe(201);
      const big = Buffer.concat([png(10, 10), Buffer.alloc(5 * 1024 * 1024)]);
      code(await upload(member, big), 413, 'FILE_TOO_LARGE');
    });

    it('без входу — 401', async () => {
      const id = await uploaded(member);
      await request(app.getHttpServer())
        .get(`/api/paper-images/${id}`)
        .expect(401);
    });
  });

  describe('хто бачить', () => {
    it('чуже, ніде не вжите, — нікому, і модератору (404); своє — так', async () => {
      const id = await uploaded(member);
      code(await see(member2, id), 404, 'PAPER_IMAGE_NOT_FOUND');
      code(await see(mod, id), 404, 'PAPER_IMAGE_NOT_FOUND');
      await see(member, id).expect(200);
      code(
        await see(member, '0b8f1c2e-3d4a-4b5c-8d6e-7f8091a2b3c4'),
        404,
        'PAPER_IMAGE_NOT_FOUND',
      );
    });

    it('у чернетці — автор і staff; опубліковане для всіх — усі', async () => {
      const id = await uploaded(member);
      const p = await draft(member, doc(para('Фото'), image(id)));
      code(await see(member2, id), 404, 'PAPER_IMAGE_NOT_FOUND');
      await see(mod, id).expect(200);
      await see(admin, id).expect(200);
      await share(member, p.id);
      await see(member2, id).expect(200);
    });

    it('шаблон: модератор бачить у чернетці; учасник — лише в опублікованому для всіх; документ із шаблону тримає зображення', async () => {
      const id = await uploaded(mod);
      const T = '/api/papers/templates';
      const t = (
        await as(app, mod)
          .post(T)
          .send({ title: 'Бланк', kind: 'free', creators: 'all' })
          .expect(201)
      ).body as { id: string };
      await as(app, mod)
        .patch(`${T}/${t.id}/versions/1`)
        .send({ revision: 1, body: doc(image(id, { width: 25 }), para('x')) })
        .expect(200);
      await see(admin, id).expect(200);
      code(await see(member, id), 404, 'PAPER_IMAGE_NOT_FOUND');
      await as(app, mod).post(`${T}/${t.id}/versions/1/publish`).expect(201);
      await see(member, id).expect(200);

      const p = (
        await as(app, member)
          .post('/api/papers')
          .send({ templateId: t.id })
          .expect(201)
      ).body as Paper;
      expect(
        (await uses(id)).map((u) => u.paperId ?? u.templateVersionId),
      ).toContain(p.id);
      // Нова чернетка версії бере зображення поточної.
      await as(app, mod).post(`${T}/${t.id}/versions`).expect(201);
      const [v2] = await ds.query<{ id: string }[]>(
        `SELECT id FROM paper_template_versions WHERE template_id = $1 AND number = 2`,
        [t.id],
      );
      expect((await uses(id)).map((u) => u.templateVersionId)).toContain(
        v2!.id,
      );
    });
  });

  describe('збереження', () => {
    it('чуже зображення, якого людина не бачить, або неіснуюче — PAPER_IMAGE_NOT_FOUND; побачене в документі — можна', async () => {
      const id = await uploaded(member);
      const p = await draft(member2, doc(para('x')));
      code(
        await save(member2, p.id, doc(image(id))),
        404,
        'PAPER_IMAGE_NOT_FOUND',
      );
      code(
        await as(app, member2)
          .post('/api/papers')
          .send({ title: 'x', content: doc(image(id)) }),
        404,
        'PAPER_IMAGE_NOT_FOUND',
      );
      code(
        await save(
          member2,
          p.id,
          doc(image('0b8f1c2e-3d4a-4b5c-8d6e-7f8091a2b3c4')),
        ),
        404,
        'PAPER_IMAGE_NOT_FOUND',
      );
      const shared = await draft(member, doc(image(id)));
      await share(member, shared.id);
      expect((await save(member2, p.id, doc(image(id)))).status).toBe(200);
    });

    it('чернетка: використання йдуть за вмістом; копія тримає свої; зафіксований — свої', async () => {
      const a = await uploaded(member);
      const b = await uploaded(member);
      const p = await draft(member, doc(image(a)));
      expect((await uses(a)).map((u) => u.paperId)).toEqual([p.id]);
      expect((await save(member, p.id, doc(image(b)))).status).toBe(200);
      expect(await uses(a)).toEqual([]);
      expect((await uses(b)).map((u) => u.paperId)).toEqual([p.id]);

      const copy = (
        await as(app, member)
          .post(`/api/papers/${p.id}/copy`)
          .send({ content: doc(image(b), image(a)) })
          .expect(201)
      ).body as Paper;
      expect((await uses(a)).map((u) => u.paperId)).toEqual([copy.id]);

      await as(app, member)
        .post(`/api/papers/${p.id}/freeze`)
        .send(SIGNED)
        .expect(409);
      await as(app, member)
        .post(`/api/papers/${p.id}/publish`)
        .send(SIGNED)
        .expect(200);
      await as(app, member)
        .post(`/api/papers/${p.id}/freeze`)
        .send(SIGNED)
        .expect(200);
      const holders = (await uses(b)).map((u) => u.paperId);
      expect(holders).toHaveLength(2);
      expect(holders).toEqual(expect.arrayContaining([p.id, copy.id]));
    });

    it('опублікований документ: зміна зони «можна змінити» додає нове зображення, старе лишається за ним', async () => {
      const a = await uploaded(member);
      const b = await uploaded(member);
      const T = '/api/papers/templates';
      const goal = {
        key: 'goal',
        label: 'Мета',
        type: 'richtext',
        required: false,
        fill: 'author',
        editable: true,
        print: true,
      };
      const zone = (...content: unknown[]) =>
        doc({ type: 'fieldZone', attrs: { key: 'goal' }, content });
      const t = (
        await as(app, mod)
          .post(T)
          .send({ title: 'Заява', kind: 'free', creators: 'all' })
          .expect(201)
      ).body as { id: string };
      await as(app, mod)
        .patch(`${T}/${t.id}/versions/1`)
        .send({
          revision: 1,
          fields: [goal],
          body: zone({ type: 'paragraph' }),
        })
        .expect(200);
      await as(app, mod).post(`${T}/${t.id}/versions/1/publish`).expect(201);
      const p = (
        await as(app, member)
          .post('/api/papers')
          .send({ templateId: t.id })
          .expect(201)
      ).body as Paper;
      expect((await save(member, p.id, zone(image(a)))).status).toBe(200);
      await as(app, member)
        .post(`/api/papers/${p.id}/publish`)
        .send(SIGNED)
        .expect(200);
      expect((await save(member, p.id, zone(image(b)))).status).toBe(200);
      expect((await uses(a)).map((u) => u.paperId)).toEqual([p.id]);
      expect((await uses(b)).map((u) => u.paperId)).toEqual([p.id]);
      // Чуже, якого автор не бачить, — ні й тут.
      const c = await uploaded(member2);
      code(
        await save(member, p.id, zone(image(b), image(c))),
        404,
        'PAPER_IMAGE_NOT_FOUND',
      );
    });

    it('видалена чернетка звільняє зображення', async () => {
      const a = await uploaded(member);
      const p = await draft(member, doc(image(a)));
      await as(app, member).delete(`/api/papers/${p.id}`).expect(200);
      expect(await uses(a)).toEqual([]);
    });
  });

  describe('друк і DOCX', () => {
    it('аркуш показує зображення класами; CSP дозволяє лише свої; DOCX вкладає файл', async () => {
      const id = await uploaded(member);
      const p = await draft(
        member,
        doc(image(id, { width: 50, align: 'right', alt: 'Схема' })),
      );
      const print = await as(app, member)
        .get(`/api/papers/${p.id}/print`)
        .expect(200);
      expect(print.text).toContain(
        `<figure class="paper-image img-w-50 img-right"><img src="/api/paper-images/${id}" alt="Схема"></figure>`,
      );
      expect(print.headers['content-security-policy']).toContain(
        "img-src 'self'",
      );
      const docx = await as(app, member)
        .get(`/api/papers/${p.id}/docx`)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect((docx.body as Buffer).includes(Buffer.from('word/media/'))).toBe(
        true,
      );
    });
  });

  describe('прибирання', () => {
    it('невикористані старші за добу — геть разом з файлом, один запис аудиту; вжиті й свіжі лишаються', async () => {
      const old = await uploaded(member);
      const fresh = await uploaded(member);
      const used = await uploaded(member);
      await draft(member, doc(image(used)));
      await ds.query(
        `UPDATE paper_images SET created_at = now() - interval '2 days' WHERE id = ANY($1)`,
        [[old, used]],
      );
      expect(await app.get(PaperImagesService).purgeUnused()).toBe(1);
      expect(existsSync(fileOf(old))).toBe(false);
      expect(existsSync(fileOf(fresh))).toBe(true);
      expect(existsSync(fileOf(used))).toBe(true);
      code(await see(member, old), 404, 'PAPER_IMAGE_NOT_FOUND');
      const log = await ds
        .getRepository(AuditLog)
        .findBy({ action: 'paper.images_purged' });
      expect(log).toHaveLength(1);
      expect(log[0]!.actorId).toBeNull();
      expect(log[0]!.meta).toEqual({ count: 1 });
      expect(await app.get(PaperImagesService).purgeUnused()).toBe(0);
      expect(
        await ds
          .getRepository(AuditLog)
          .countBy({ action: 'paper.images_purged' }),
      ).toBe(1);
    });
  });
});
