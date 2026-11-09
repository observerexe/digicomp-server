import { INestApplication, RequestMethod } from '@nestjs/common';

/**
 * All API routes live under /api, so the web app owns every other path
 * (/tasks, /lab/CNC-1...) and a page reload never hits a JSON endpoint.
 * /health stays at the root for Docker, the agent and monitoring.
 */
export const API_PREFIX = '/api';

export function applyGlobalPrefix(app: INestApplication) {
  app.setGlobalPrefix(API_PREFIX.slice(1), {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });
}

/** Request path without the /api prefix (for rules keyed by route). */
export function apiPath(path: string) {
  return path === API_PREFIX || path.startsWith(API_PREFIX + '/')
    ? path.slice(API_PREFIX.length) || '/'
    : path;
}
