// Маршрутизатор на хешах: #/places/SOLDER-01. Маршрути API не конфліктують з маршрутами інтерфейсу.
const routes = [];
let current = { cleanup: null };

export function route(pattern, loader) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([A-Za-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ re, keys, loader });
}
export const navigate = (path) => { if (location.hash === '#' + path) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = path; };
export const currentPath = () => (location.hash.replace(/^#/, '') || '/').split('?')[0];

export function startRouter(render) {
  const run = async () => {
    const path = currentPath();
    if (current.cleanup) { try { current.cleanup(); } catch { /* ігноруємо */ } current.cleanup = null; }
    for (const r of routes) {
      const m = path.match(r.re);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        await render(r.loader, params, path);
        return;
      }
    }
    await render(routes.find((r) => r.re.test('/'))?.loader, {}, '/');
  };
  window.addEventListener('hashchange', run);
  return run;
}
export function setCleanup(fn) { current.cleanup = fn; }
