import { h, clear } from './dom.js';
import { api, setSessionLostHandler } from './api.js';
import { icon, brandMark } from './icons.js';
import { route, startRouter, navigate, currentPath, setCleanup } from './router.js';
import { state, update, subscribe, isSupervisor } from './store.js';
import { avatar, fmtDuration, sheet, toast, errorText, ROLE_NAMES, skeleton, errorState } from './ui.js';
import { openEndSession } from './views/session-ui.js';

const root = document.getElementById('app');

/* ---------- тема ---------- */
export function applyTheme(mode) {
  if (mode === 'light' || mode === 'dark') document.documentElement.dataset.theme = mode;
  else delete document.documentElement.dataset.theme;
}
applyTheme(localStorage.getItem('dc-theme'));

/* ---------- маршрути ---------- */
const view = (file) => () => import(`./views/${file}.js`).then((m) => m.default);
route('/login', view('login'));
route('/', view('dashboard'));
route('/places', view('places'));
route('/places/:code', view('place'));
route('/journal', view('journal'));
route('/profile', view('profile'));
route('/more', view('more'));
route('/inventory', view('soon'));
route('/documents', view('soon'));
route('/projects', view('soon'));
route('/tasks', view('soon'));
route('/team', view('soon'));
route('/smart', view('soon'));

const NAV = [
  { path: '/', label: 'Дошка', icon: 'board' },
  { path: '/places', label: 'Місця', icon: 'places' },
  { path: '/journal', label: 'Журнал', icon: 'clock' },
  { path: '/inventory', label: 'Склад', icon: 'box' },
  { path: '/documents', label: 'Документи', icon: 'file' },
  { path: '/projects', label: 'Проєкти', icon: 'folder' },
  { path: '/tasks', label: 'Завдання', icon: 'tasks' },
  { path: '/team', label: 'Команда', icon: 'users' },
  { path: '/smart', label: 'Розумна майстерня', icon: 'bolt' },
];
const TABS = [
  { path: '/', label: 'Дошка', icon: 'board' },
  { path: '/places', label: 'Місця', icon: 'places' },
  { path: '/inventory', label: 'Склад', icon: 'box' },
  { path: '/projects', label: 'Проєкти', icon: 'folder' },
  { path: '/more', label: 'Ще', icon: 'more' },
];
const isActive = (itemPath, path) => (itemPath === '/' ? path === '/' : path === itemPath || path.startsWith(itemPath + '/'));

/* ---------- оболонка ---------- */
let shell = null;
function buildShell() {
  const rail = h('aside', { class: 'rail', 'aria-label': 'Головна навігація' },
    h('a', { class: 'brand', href: '#/' }, brandMark(), h('div', null, h('b', null, 'DigiComp'), h('span', null, 'HUB'))),
    h('nav', { id: 'rail-nav' }),
    h('div', { class: 'rail-foot', id: 'rail-foot' }));
  const topbar = h('header', { class: 'topbar' }, brandMark(), h('h1', { id: 'top-title' }, 'DigiComp'), h('a', { id: 'top-avatar', href: '#/profile', 'aria-label': 'Профіль' }));
  const main = h('main', { class: 'main', id: 'main', tabindex: '-1' });
  const tabbar = h('nav', { class: 'tabbar', id: 'tabbar', 'aria-label': 'Розділи' });
  const bar = h('div', { id: 'sessionbar-host' });
  const el = h('div', { class: 'shell' }, rail, topbar, main, tabbar, bar);
  return { el, main, rail, topbar, tabbar, bar };
}

function renderChrome(path) {
  const navHost = shell.rail.querySelector('#rail-nav');
  clear(navHost);
  for (const item of NAV) {
    navHost.append(h('a', { class: 'nav-link', href: '#' + item.path, 'aria-current': isActive(item.path, path) ? 'page' : null }, icon(item.icon), item.label));
  }
  const foot = shell.rail.querySelector('#rail-foot');
  clear(foot);
  foot.append(h('a', { class: 'me-card', href: '#/profile' }, avatar(state.me), h('div', null, h('b', null, state.me.name), h('small', null, ROLE_NAMES[state.me.role] || state.me.role))));
  const tabHost = shell.tabbar;
  clear(tabHost);
  for (const item of TABS) {
    const on = isActive(item.path, path) || (item.path === '/more' && ['/journal', '/documents', '/tasks', '/team', '/smart', '/profile'].some((p) => isActive(p, path)));
    tabHost.append(h('a', { class: 'tab', href: '#' + item.path, 'aria-current': on ? 'page' : null }, icon(item.icon), item.label));
  }
  const top = shell.topbar.querySelector('#top-avatar');
  clear(top);
  top.append(avatar(state.me, 'sm'));
}

/* ---------- панель активного сеансу ---------- */
let tickTimer = null;
function renderSessionBar() {
  if (!shell) return;
  const host = shell.bar;
  clearInterval(tickTimer);
  clear(host);
  const s = state.activeSession;
  document.body.classList.toggle('has-session', Boolean(s));
  if (!s) return;
  const timer = h('span', { class: 'timer num' }, fmtDuration(Date.now() - new Date(s.startedAt).getTime()));
  const tick = () => { timer.textContent = fmtDuration(Date.now() - new Date(s.startedAt).getTime()); };
  tickTimer = setInterval(tick, 1000);
  host.append(h('div', { class: 'sessionbar', role: 'region', 'aria-label': 'Активний сеанс' },
    h('span', { class: 'led busy on', 'aria-hidden': 'true' }),
    h('a', { class: 'grow', href: `#/places/${encodeURIComponent(s.place.code || s.place.id)}` }, h('b', null, s.place.title), h('small', null, 'Ваш сеанс триває ', timer)),
    h('button', { class: 'btn small', type: 'button', onclick: () => openEndSession(s, async () => { await refreshActiveSession(); navigate(currentPath()); }) }, 'Завершити')));
}

export async function refreshActiveSession() {
  try {
    const r = await api.get(`/work-sessions?active=true&userId=${state.me.id}&limit=1`);
    update({ activeSession: r.items?.[0] || null });
  } catch { /* панель не критична */ }
  renderSessionBar();
}

/* ---------- рендер сторінок ---------- */
async function render(loader, params, path) {
  if (!state.me && path !== '/login') { navigate('/login'); return; }
  if (state.me && path === '/login') { navigate('/'); return; }
  if (!loader) { navigate('/'); return; }

  if (path === '/login') {
    shell = null;
    clear(root);
    const login = await loader();
    const out = await login({ params, onLoggedIn });
    root.append(out.node);
    document.title = 'Вхід · DigiComp HUB';
    return;
  }
  if (!shell || !root.contains(shell.el)) {
    clear(root);
    shell = buildShell();
    root.append(shell.el);
  }
  renderChrome(path);
  clear(shell.main);
  shell.main.append(skeleton(4));

  let fn;
  try { fn = await loader(); } catch (e) { clear(shell.main); shell.main.append(errorState(e)); return; }
  const token = {};
  render.token = token;
  const rerender = () => navigate(currentPath());
  let result;
  try { result = await fn({ params, rerender }); }
  catch (e) { if (render.token === token) { clear(shell.main); shell.main.append(errorState(e, rerender)); } return; }
  if (render.token !== token) { result?.cleanup?.(); return; }
  if (result.cleanup) setCleanup(result.cleanup);

  clear(shell.main);
  const head = h('div', { class: 'page-head' },
    h('div', { class: 'titles' }, h('h1', null, result.title), result.sub ? h('p', { class: 'sub' }, result.sub) : null),
    result.actions?.length ? h('div', { class: 'actions' }, result.actions) : null);
  if (result.bare) shell.main.append(result.node); else shell.main.append(head, result.node);
  shell.topbar.querySelector('#top-title').textContent = result.mobileTitle || result.title;
  document.title = `${result.title} · DigiComp HUB`;
  window.scrollTo(0, 0);
  refreshActiveSession();
}

const HINT = 'dc-session';
async function onLoggedIn(user) {
  localStorage.setItem(HINT, '1');
  update({ me: user });
  await refreshActiveSession().catch(() => {});
  navigate('/');
}

export async function logout() {
  try { await api.post('/auth/logout', {}); } catch { /* сеанс і так закривається */ }
  clearInterval(tickTimer);
  localStorage.removeItem(HINT);
  update({ me: null, activeSession: null });
  shell = null;
  navigate('/login');
}

/* ---------- запуск ---------- */
setSessionLostHandler(() => {
  localStorage.removeItem(HINT);
  if (state.me) { update({ me: null, activeSession: null }); toast('Сеанс завершився. Увійдіть знову.', 'error'); navigate('/login'); }
});

(async function boot() {
  try { const cfg = await fetch('/app-config').then((r) => r.json()); update({ publicOrigin: cfg.publicOrigin }); } catch { /* використаємо адресу сторінки */ }
  if (localStorage.getItem(HINT)) {
    try { update({ me: (await api.get('/auth/me')) }); } catch { localStorage.removeItem(HINT); update({ me: null }); }
  }
  const run = startRouter(render);
  if (state.me) await refreshActiveSession();
  if (!location.hash) location.hash = state.me ? '/' : '/login';
  run();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
