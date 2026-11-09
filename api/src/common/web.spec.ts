import type { NextFunction, Request, Response } from 'express';
import { CSP, csrfGuard, securityHeaders } from './web';

function run(method: string, headers: Record<string, string>) {
  const req = { method, headers } as unknown as Request;
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  const next = jest.fn() as unknown as NextFunction;
  csrfGuard(req, res as unknown as Response, next);
  return { res, next: next as unknown as jest.Mock };
}

const COOKIE = { cookie: 'dc_at=token', host: 'hub.local' };

describe('csrfGuard', () => {
  it('пропускає безпечні методи навіть з cookie', () => {
    expect(run('GET', COOKIE).next).toHaveBeenCalled();
  });

  it('пропускає запити без cookie (звичайні API-клієнти)', () => {
    expect(run('POST', { host: 'hub.local' }).next).toHaveBeenCalled();
  });

  it('пропускає запити з Bearer-токеном', () => {
    const { next } = run('POST', { ...COOKIE, authorization: 'Bearer x' });
    expect(next).toHaveBeenCalled();
  });

  it('відхиляє cookie-запит без заголовка X-DC-Client', () => {
    const { res, next } = run('POST', COOKIE);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ errorCode: 'CSRF' });
  });

  it('відхиляє refresh-cookie без заголовка X-DC-Client', () => {
    const { res } = run('POST', { cookie: 'dc_rt=r', host: 'hub.local' });
    expect(res.statusCode).toBe(403);
  });

  it('пропускає cookie-запит із заголовком і без Origin', () => {
    const { next } = run('PATCH', { ...COOKIE, 'x-dc-client': 'web' });
    expect(next).toHaveBeenCalled();
  });

  it('пропускає cookie-запит зі своїм Origin', () => {
    const { next } = run('DELETE', {
      ...COOKIE,
      'x-dc-client': 'web',
      origin: 'https://hub.local',
    });
    expect(next).toHaveBeenCalled();
  });

  it('пропускає Origin, що збігається з X-Forwarded-Host', () => {
    const { next } = run('POST', {
      ...COOKIE,
      'x-dc-client': 'web',
      'x-forwarded-host': 'public.example',
      origin: 'https://public.example',
    });
    expect(next).toHaveBeenCalled();
  });

  it('відхиляє чужий Origin', () => {
    const { res, next } = run('POST', {
      ...COOKIE,
      'x-dc-client': 'web',
      origin: 'https://evil.example',
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ errorCode: 'CSRF' });
  });

  it('відхиляє некоректний Origin', () => {
    const { res } = run('POST', {
      ...COOKIE,
      'x-dc-client': 'web',
      origin: 'not a url',
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('securityHeaders', () => {
  it('ставить CSP і заборону вбудовування у фрейми', () => {
    const headers: Record<string, string> = {};
    const res = {
      setHeader: (k: string, v: string) => (headers[k] = v),
    } as unknown as Response;
    const next = jest.fn();
    securityHeaders({} as Request, res, next);
    expect(headers['Content-Security-Policy']).toBe(CSP);
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(next).toHaveBeenCalled();
  });
});
