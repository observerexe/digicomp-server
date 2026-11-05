import type { Request, Response } from 'express';

export const AT_COOKIE = 'dc_at';
export const RT_COOKIE = 'dc_rt';

const HOUR_MS = 60 * 60 * 1000;
const REFRESH_MS = 30 * 24 * HOUR_MS;

type HeaderBag = { headers: Record<string, unknown> };

export function readCookie(req: HeaderBag, name: string): string | undefined {
  const raw = req.headers['cookie'];
  if (typeof raw !== 'string') return undefined;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function isWebClient(req: HeaderBag) {
  return req.headers['x-dc-client'] === 'web';
}

function isSecure(req: Request) {
  const env = process.env.COOKIE_SECURE;
  if (env === 'true') return true;
  if (env === 'false') return false;
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

export function setAuthCookies(
  req: Request,
  res: Response,
  access: string,
  refresh: string,
) {
  const base = {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: isSecure(req),
  };
  res.cookie(AT_COOKIE, access, { ...base, path: '/', maxAge: HOUR_MS });
  res.cookie(RT_COOKIE, refresh, {
    ...base,
    path: '/auth',
    maxAge: REFRESH_MS,
  });
}

export function clearAuthCookies(req: Request, res: Response) {
  const base = {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: isSecure(req),
  };
  res.clearCookie(AT_COOKIE, { ...base, path: '/' });
  res.clearCookie(RT_COOKIE, { ...base, path: '/auth' });
}
