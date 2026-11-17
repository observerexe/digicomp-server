/**
 * Keeps the app on the version the server has, without anyone clearing caches.
 *
 * The service worker (vite-plugin-pwa, `autoUpdate`: skipWaiting + clientsClaim) takes over as soon as a new build is
 * installed, but an open page still runs the old code. So the page reloads when that bothers no one: the app is hidden
 * (switched away, phone locked) or the person goes to another page. Never in the middle of work on a visible page.
 * A page that asks for a code chunk the server no longer has (an old build) reloads once.
 */

/** How often an open app asks the server whether there is a new build. */
export const CHECK_EVERY_MS = 30 * 60_000;
/** A reload for a missing chunk is not repeated sooner than this: a broken build must not loop. */
export const RELOAD_GUARD_MS = 10_000;
const GUARD_KEY = 'app.reloadedAt';

export type UpdaterEnv = {
  hidden: () => boolean;
  reload: () => void;
  now: () => number;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
};

export function createUpdater(env: UpdaterEnv) {
  let pending = false;
  const apply = () => {
    pending = false;
    env.reload();
  };
  return {
    /** A new build has taken over this page. */
    ready() {
      pending = true;
      if (env.hidden()) apply();
    },
    hidden() {
      if (pending) apply();
    },
    navigated() {
      if (pending) apply();
    },
    get pending() {
      return pending;
    },
    /** A chunk failed to load; true — the page reloads (once per RELOAD_GUARD_MS). */
    chunkFailed(): boolean {
      const last = env.storage?.getItem(GUARD_KEY);
      if (last && env.now() - Number(last) < RELOAD_GUARD_MS) return false;
      env.storage?.setItem(GUARD_KEY, String(env.now()));
      apply();
      return true;
    },
  };
}

type Updater = ReturnType<typeof createUpdater>;
let updater: Updater | null = null;

/** Registers the service worker and keeps the page up to date. Call once at start. */
export function startAppUpdates() {
  const u = createUpdater({
    hidden: () => document.visibilityState === 'hidden',
    reload: () => window.location.reload(),
    now: () => Date.now(),
    storage: (() => {
      try {
        return window.sessionStorage;
      } catch {
        return null;
      }
    })(),
  });
  updater = u;
  window.addEventListener('vite:preloadError', (e) => {
    if (u.chunkFailed()) e.preventDefault();
  });

  const sw = navigator.serviceWorker as ServiceWorkerContainer | undefined;
  if (!sw) return;
  // The first install (a page that had no worker) is not a new version: the page already runs the latest code.
  let controlled = !!sw.controller;
  sw.addEventListener('controllerchange', () => {
    if (controlled) u.ready();
    controlled = true;
  });
  window.addEventListener('load', () => {
    sw.register('/sw.js', { scope: '/' }).then(
      (reg) => {
        const check = () => {
          if (navigator.onLine) reg.update().catch(() => undefined);
        };
        setInterval(check, CHECK_EVERY_MS);
        window.addEventListener('online', check);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') check();
          else u.hidden();
        });
      },
      () => undefined,
    );
  });
}

/** The router went to another page: a pending new version is applied now. */
export function appNavigated() {
  updater?.navigated();
}
