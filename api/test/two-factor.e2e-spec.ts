import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { base32Decode, stepAt, totpAt } from '../src/auth/totp';
import { Role, User } from '../src/users/user.entity';
import {
  as,
  createTestApp,
  makeUser,
  PASSWORD,
  resetDb,
  TestUser,
} from './helpers';

// 2FA (TOTP): налаштування, вхід у два кроки, коди відновлення,
// одноразовість кодів, блокування після 10 помилок, вимкнення, скидання адміном.

type Res = { status: number; body: Record<string, any> };

function code(res: Res, status: number, errorCode: string) {
  expect(res.status).toBe(status);
  expect(res.body.errorCode).toBe(errorCode);
}

/** Code for the current step (+offset), as the authenticator app shows it. */
const totp = (secret: string, offset = 0) =>
  totpAt(base32Decode(secret), stepAt(Date.now()) + offset);

describe('2FA (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let admin: TestUser;
  let admin2: TestUser;
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
    admin = await makeUser(app, Role.Admin);
    admin2 = await makeUser(app, Role.Admin);
    member = await makeUser(app, Role.Member);
  });

  const login = (u: TestUser, web = false) => {
    const r = request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: u.email, password: PASSWORD });
    return web ? r.set('X-DC-Client', 'web') : r;
  };
  const verify = (body: Record<string, unknown>, web = false) => {
    const r = request(app.getHttpServer()).post('/auth/2fa/verify').send(body);
    return web ? r.set('X-DC-Client', 'web') : r;
  };

  /** Turns 2FA on, returns the secret and recovery codes. */
  async function enable(u: TestUser) {
    const setup = await as(app, u).post('/auth/2fa/setup');
    expect(setup.status).toBe(200);
    const secret = setup.body.secret as string;
    const en = await as(app, u)
      .post('/auth/2fa/enable')
      .send({ code: totp(secret) });
    expect(en.status).toBe(200);
    return { secret, recoveryCodes: en.body.recoveryCodes as string[] };
  }

  it('налаштування: секрет, otpauth, коди відновлення; секрет у базі зашифрований', async () => {
    const setup = await as(app, admin).post('/auth/2fa/setup');
    expect(setup.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.body.otpauthUri).toContain(`secret=${setup.body.secret}`);
    // До підтвердження 2FA ще не діє.
    expect((await login(admin)).body.accessToken).toBeTruthy();
    code(
      await as(app, admin).post('/auth/2fa/enable').send({ code: '000000' }),
      403,
      'TWO_FACTOR_INVALID_CODE',
    );
    const en = await as(app, admin)
      .post('/auth/2fa/enable')
      .send({ code: totp(setup.body.secret) });
    expect(en.body.recoveryCodes).toHaveLength(8);

    const row = await ds.getRepository(User).findOneByOrFail({ id: admin.id });
    expect(row.totpSecretEnc).not.toContain(setup.body.secret);
    expect(row.recoveryCodes).toHaveLength(8);
    expect(row.recoveryCodes.join()).not.toContain(en.body.recoveryCodes[0]);

    const me = await as(app, admin).get('/auth/me');
    expect(me.body.twoFactorEnabled).toBe(true);
    expect(JSON.stringify(me.body)).not.toMatch(/totp|recovery/i);
    code(
      await as(app, admin).post('/auth/2fa/setup'),
      409,
      'TWO_FACTOR_ALREADY_ENABLED',
    );
  });

  it('увімкнення закриває всі сесії', async () => {
    const before = await login(admin);
    await enable(admin);
    const r = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: before.body.refreshToken });
    code(r, 401, 'INVALID_REFRESH_TOKEN');
  });

  it('вхід у два кроки; той самий код двічі не проходить', async () => {
    const { secret } = await enable(admin);
    const first = await login(admin);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({
      twoFactorRequired: true,
      challengeToken: expect.any(String),
    });
    // Токен виклику не працює як токен доступу.
    expect(
      (
        await request(app.getHttpServer())
          .get('/auth/me')
          .set('Authorization', `Bearer ${first.body.challengeToken}`)
      ).status,
    ).toBe(401);

    code(
      await verify({ challengeToken: first.body.challengeToken }),
      400,
      'TWO_FACTOR_CODE_REQUIRED',
    );
    code(
      await verify({
        challengeToken: first.body.challengeToken,
        code: '123456',
      }),
      403,
      'TWO_FACTOR_INVALID_CODE',
    );
    const c = totp(secret, 1);
    const ok = await verify({
      challengeToken: first.body.challengeToken,
      code: c,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();

    // Повтор того самого коду.
    const second = await login(admin);
    code(
      await verify({ challengeToken: second.body.challengeToken, code: c }),
      403,
      'TWO_FACTOR_INVALID_CODE',
    );
    code(
      await verify({ challengeToken: 'garbage', code: c }),
      401,
      'TWO_FACTOR_CHALLENGE_INVALID',
    );
  });

  it('вебвхід: cookie ставляться лише після коду', async () => {
    const { secret } = await enable(admin);
    const first = await login(admin, true);
    expect(first.headers['set-cookie']).toBeUndefined();
    const ok = await verify(
      { challengeToken: first.body.challengeToken, code: totp(secret, 1) },
      true,
    );
    expect(ok.status).toBe(200);
    expect(ok.body.user.id).toBe(admin.id);
    expect(String(ok.headers['set-cookie'])).toContain('HttpOnly');
  });

  it('код відновлення працює один раз', async () => {
    const { recoveryCodes } = await enable(admin);
    const rc = recoveryCodes[0];
    const a = await login(admin);
    const ok = await verify({
      challengeToken: a.body.challengeToken,
      recoveryCode: rc.toLowerCase().replace('-', ''),
    });
    expect(ok.status).toBe(200);
    const b = await login(admin);
    code(
      await verify({ challengeToken: b.body.challengeToken, recoveryCode: rc }),
      403,
      'TWO_FACTOR_INVALID_CODE',
    );
    const row = await ds.getRepository(User).findOneByOrFail({ id: admin.id });
    expect(row.recoveryCodes).toHaveLength(7);
    const [log] = await ds.query<{ meta: { recoveryCode: boolean } }[]>(
      `SELECT meta FROM audit_log WHERE action = 'auth.2fa_login' AND entity_id = $1`,
      [admin.id],
    );
    expect(log.meta.recoveryCode).toBe(true);
  });

  it('після 10 помилок поспіль перевірка блокується на 15 хвилин', async () => {
    const { secret } = await enable(admin);
    await ds.query(`UPDATE users SET totp_failed_attempts = 9 WHERE id = $1`, [
      admin.id,
    ]);
    const a = await login(admin);
    code(
      await verify({ challengeToken: a.body.challengeToken, code: '000000' }),
      403,
      'TWO_FACTOR_INVALID_CODE',
    );
    const b = await login(admin);
    // Навіть правильний код під час блокування не проходить.
    code(
      await verify({
        challengeToken: b.body.challengeToken,
        code: totp(secret, 1),
      }),
      403,
      'TWO_FACTOR_LOCKED',
    );
    const [row] = await ds.query<{ until: string }[]>(
      `SELECT totp_locked_until AS until FROM users WHERE id = $1`,
      [admin.id],
    );
    const minutes = (new Date(row.until).getTime() - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);
  });

  it('вимкнення потребує коду; нові коди відновлення', async () => {
    const { secret } = await enable(admin);
    const a = await login(admin);
    const session = await verify({
      challengeToken: a.body.challengeToken,
      code: totp(secret, 1),
    });
    const me = { token: session.body.accessToken as string };

    // Новий код з'являється раз на 30 с: імітуємо, що минуло 90 секунд.
    await ds.query(
      `UPDATE users SET totp_last_step = totp_last_step - 3 WHERE id = $1`,
      [admin.id],
    );
    const regen = await as(app, me)
      .post('/auth/2fa/recovery-codes')
      .send({ code: totp(secret) });
    expect(regen.status).toBe(200);
    expect(regen.body.recoveryCodes).toHaveLength(8);

    code(
      await as(app, me).post('/auth/2fa/disable').send({ code: '000000' }),
      403,
      'TWO_FACTOR_INVALID_CODE',
    );
    // Код відновлення теж підходить.
    const off = await as(app, me)
      .post('/auth/2fa/disable')
      .send({ recoveryCode: regen.body.recoveryCodes[0] });
    expect(off.status).toBe(200);
    expect((await login(admin)).body.accessToken).toBeTruthy();
    code(
      await as(app, me).post('/auth/2fa/disable').send({ code: '123456' }),
      409,
      'TWO_FACTOR_NOT_ENABLED',
    );
  });

  it('member теж може увімкнути 2FA', async () => {
    await enable(member);
    expect((await login(member)).body.twoFactorRequired).toBe(true);
  });

  it('скидання чужої 2FA: лише admin, з аудитом', async () => {
    await enable(admin2);
    const mod = await makeUser(app, Role.Moderator);
    code(
      await as(app, mod).post(`/users/${admin2.id}/2fa/reset`),
      403,
      'FORBIDDEN',
    );
    const r = await as(app, admin).post(`/users/${admin2.id}/2fa/reset`);
    expect(r.status).toBe(200);
    expect((await login(admin2)).body.accessToken).toBeTruthy();
    const [log] = await ds.query<{ actor_id: string }[]>(
      `SELECT actor_id FROM audit_log WHERE action = 'user.2fa_reset' AND entity_id = $1`,
      [admin2.id],
    );
    expect(log.actor_id).toBe(admin.id);
    code(
      await as(app, admin).post(`/users/${admin2.id}/2fa/reset`),
      409,
      'TWO_FACTOR_NOT_ENABLED',
    );
  });

  it('без TOTP_KEY 2FA не вмикається', async () => {
    const saved = process.env.TOTP_KEY;
    delete process.env.TOTP_KEY;
    try {
      code(
        await as(app, admin).post('/auth/2fa/setup'),
        503,
        'TWO_FACTOR_NOT_CONFIGURED',
      );
    } finally {
      process.env.TOTP_KEY = saved;
    }
  });
});
