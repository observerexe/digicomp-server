import createClient from 'openapi-fetch';
import type { paths } from './schema';

/**
 * Typed client for the DigiComp API (types from api/openapi.json:
 * npm run api:types). Same origin, HttpOnly cookies, and the X-DC-Client
 * header that the CSRF guard requires for cookie sessions.
 */
export const CLIENT_HEADER = { 'X-DC-Client': 'web' } as const;

/** Error with the stable errorCode from the API. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'ApiError';
  }
}

const AUTH_PATHS = ['/api/auth/login', '/api/auth/refresh', '/api/auth/logout', '/api/auth/2fa/verify'];

let refreshing: Promise<boolean> | null = null;
const loggedOutListeners = new Set<() => void>();

/** Called when the session cannot be refreshed (show the login screen). */
export function onLoggedOut(fn: () => void) {
  loggedOutListeners.add(fn);
  return () => {
    loggedOutListeners.delete(fn);
  };
}

/** One refresh for all requests that got 401 at the same time. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { ...CLIENT_HEADER, 'Content-Type': 'application/json' },
    body: '{}',
  })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/**
 * fetch with automatic session refresh: on 401 (except the auth endpoints
 * themselves) refresh once and retry the original request.
 */
export async function authFetch(input: Request): Promise<Response> {
  const retry = input.clone();
  const res = await fetch(input);
  const path = new URL(input.url).pathname;
  if (res.status !== 401 || AUTH_PATHS.includes(path)) return res;
  if (await refreshSession()) return fetch(retry);
  for (const fn of loggedOutListeners) fn();
  return res;
}

export const api = createClient<paths>({
  baseUrl: globalThis.location?.origin ?? '',
  credentials: 'same-origin',
  headers: CLIENT_HEADER,
  fetch: authFetch,
});

/** Unwraps an openapi-fetch result or throws ApiError with the errorCode. */
export async function unwrap<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  let result: Awaited<typeof call>;
  try {
    result = await call;
  } catch {
    throw new ApiError(0, 'NETWORK');
  }
  if (result.error !== undefined || !result.response.ok) {
    const body = (result.error ?? {}) as { errorCode?: string; message?: unknown };
    const msg = typeof body.message === 'string' ? body.message : undefined;
    throw new ApiError(result.response.status, body.errorCode ?? 'ERROR', msg);
  }
  return result.data as T;
}
