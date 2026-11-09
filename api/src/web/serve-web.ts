import { INestApplication, Logger } from '@nestjs/common';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { API_PREFIX } from '../common/api-prefix';

/**
 * Serves the web app (web/dist) from the same origin as the API, so cookie
 * auth, the CSRF header and the CSP work as they are. Every GET outside
 * /api and /health gets index.html (client-side routes like /tasks).
 */
export function webDir(): string | null {
  const dir = resolve(
    process.env.WEB_DIST ?? join(process.cwd(), '..', 'web', 'dist'),
  );
  return existsSync(join(dir, 'index.html')) ? dir : null;
}

const NO_CACHE = new Set([
  '/index.html',
  '/sw.js',
  '/registerSW.js',
  '/manifest.webmanifest',
]);

function cacheControl(urlPath: string) {
  if (NO_CACHE.has(urlPath) || urlPath.startsWith('/workbox-'))
    return 'no-cache';
  // Vite puts a content hash into every file name under /assets.
  if (urlPath.startsWith('/assets/'))
    return 'public, max-age=31536000, immutable';
  return 'public, max-age=604800';
}

export function isApiPath(path: string) {
  return (
    path === API_PREFIX ||
    path.startsWith(API_PREFIX + '/') ||
    path === '/health'
  );
}

export function serveWeb(app: INestApplication) {
  const dir = webDir();
  if (!dir) {
    new Logger('Web').warn(
      'web/dist not found: the web app is not served (API only)',
    );
    return;
  }
  const files = express.static(dir, {
    index: false,
    dotfiles: 'deny',
    fallthrough: true,
    setHeaders: (res, filePath) => {
      const urlPath =
        '/' +
        filePath
          .slice(dir.length + 1)
          .split('\\')
          .join('/');
      res.setHeader('Cache-Control', cacheControl(urlPath));
    },
  });
  const indexFile = join(dir, 'index.html');
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (isApiPath(req.path)) return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      // Outside /api only pages exist: same JSON 404 as the API gives.
      res.status(404).json({
        statusCode: 404,
        errorCode: 'NOT_FOUND',
        message: `Cannot ${req.method} ${req.path}`,
      });
      return;
    }
    files(req, res, () => {
      // Not a file: a client-side route.
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexFile);
    });
  });
}
