import type { NextFunction, Request, Response } from 'express';
import { AT_COOKIE, RT_COOKIE, readCookie } from '../auth/cookies';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self'",
  "script-src 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export function securityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), geolocation=()');
  next();
}

export function csrfGuard(req: Request, res: Response, next: NextFunction) {
  if (SAFE.has(req.method)) return next();
  const usesCookie =
    !!readCookie(req, AT_COOKIE) || !!readCookie(req, RT_COOKIE);
  const hasBearer = typeof req.headers.authorization === 'string';
  if (!usesCookie || hasBearer) return next();

  const deny = (message: string) =>
    res.status(403).json({ statusCode: 403, errorCode: 'CSRF', message });

  if (req.headers['x-dc-client'] !== 'web')
    return deny('Missing client header');
  const origin = req.headers.origin;
  if (typeof origin === 'string') {
    let host = '';
    try {
      host = new URL(origin).host;
    } catch {
      return deny('Bad origin');
    }
    const allowed = [req.headers.host, req.headers['x-forwarded-host']];
    if (!allowed.includes(host)) return deny('Bad origin');
  }
  next();
}

export function apiNoStore(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store');
  next();
}
