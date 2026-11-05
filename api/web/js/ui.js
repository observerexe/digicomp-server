import { h, clear } from './dom.js';
import { icon } from './icons.js';

/* ---------- українські повідомлення про помилки ---------- */
const ERRORS = {
  NETWORK: 'Немає зв’язку із сервером. Перевірте інтернет і спробуйте ще раз.',
  INVALID_CREDENTIALS: 'Невірна пошта або пароль, або обліковий запис вимкнено.',
  RATE_LIMITED: 'Забагато спроб. Зачекайте хвилину і повторіть.',
  UNAUTHORIZED: 'Сеанс завершився. Увійдіть знову.',
  FORBIDDEN: 'У вас немає прав для цієї дії.',
  CSRF: 'Запит відхилено з міркувань безпеки. Оновіть сторінку.',
  VALIDATION_ERROR: 'Перевірте введені дані.',
  PLACE_IN_USE: 'Місце зараз зайняте.',
  PLACE_UNAVAILABLE: 'Місце недоступне: воно на обслуговуванні або в архіві.',
  NOT_AUTHORIZED_FOR_PLACE: 'Для цього місця потрібен допуск. Зверніться до координатора.',
  ACTIVE_SESSION_EXISTS: 'У вас уже є активний сеанс. Спершу завершіть його.',
  SAFETY_CONFIRMATION_REQUIRED: 'Підтвердьте, що ви ознайомилися з правилами безпеки.',
  SESSION_ALREADY_ENDED: 'Сеанс уже завершено.',
  REASON_REQUIRED: 'Вкажіть причину.',
  PLACE_CODE_TAKEN: 'Місце з таким кодом уже існує.',
  EMAIL_TAKEN: 'Ця пошта вже використовується.',
  INVALID_CURRENT_PASSWORD: 'Поточний пароль неправильний.',
  LAST_ADMIN: 'Не можна прибрати останнього активного адміністратора.',
  FILE_TYPE_NOT_ALLOWED: 'Цей тип файлу не дозволений.',
  FILE_CONTENT_MISMATCH: 'Вміст файлу не відповідає його типу.',
  FILE_TOO_LARGE: 'Файл завеликий.',
  FILE_REQUIRED: 'Оберіть файл.',
  INSUFFICIENT_STOCK: 'На складі недостатньо.',
  SMART_UNAVAILABLE: 'Розумна майстерня зараз не відповідає.',
  SMART_NOT_CONFIGURED: 'Розумна майстерня ще не налаштована.',
  DEVICE_UNAVAILABLE: 'Пристрій недоступний.',
};
export function errorText(err) {
  if (!err) return 'Щось пішло не так.';
  return ERRORS[err.errorCode] || err.message || 'Щось пішло не так.';
}

/* ---------- форматування ---------- */
const dtf = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const df = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
const tf = new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit' });
export const fmtDateTime = (v) => (v ? dtf.format(new Date(v)) : '');
export const fmtDate = (v) => (v ? df.format(new Date(v)) : '');
export const fmtTime = (v) => (v ? tf.format(new Date(v)) : '');
export function fmtDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(total / 3600), mm = Math.floor((total % 3600) / 60), ss = total % 60;
  const p = (n) => String(n).padStart(2, '0');
  return hh > 0 ? `${hh}:${p(mm)}:${p(ss)}` : `${p(mm)}:${p(ss)}`;
}
export function fmtSpan(from, to) {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return 'менше хвилини';
  if (min < 60) return `${min} хв`;
  return `${Math.floor(min / 60)} год ${min % 60} хв`;
}
export function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return 'Доброї ночі';
  if (hour < 12) return 'Доброго ранку';
  if (hour < 18) return 'Добрий день';
  return 'Добрий вечір';
}
export function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}
export const ROLE_NAMES = { admin: 'Адміністратор', coordinator: 'Координатор', member: 'Учасник', guest: 'Гість' };

/* ---------- компоненти ---------- */
export function avatar(user, size = '') {
  const box = h('span', { class: `avatar ${size}`, role: 'img', 'aria-label': user?.name || 'Користувач' });
  if (user?.avatarUrl) {
    const img = h('img', { src: user.avatarUrl, alt: '', loading: 'lazy' });
    img.addEventListener('error', () => { img.remove(); box.textContent = initials(user.name); });
    box.append(img);
  } else box.textContent = initials(user?.name);
  return box;
}

export function led(kind, on = true, big = false) {
  return h('span', { class: `led ${kind}${on ? ' on' : ''}${big ? ' big' : ''}`, 'aria-hidden': 'true' });
}

export function skeleton(rows = 3) {
  return h('div', { class: 'stack', 'aria-busy': 'true', 'aria-label': 'Завантаження' },
    h('div', { class: 'skel block' }),
    ...Array.from({ length: rows }, () => h('div', { class: 'skel line' })));
}

export function emptyState(title, text, action) {
  return h('div', { class: 'empty' }, h('h3', null, title), text ? h('p', null, text) : null, action || null);
}

export function errorState(err, retry) {
  return h('div', { class: 'empty' },
    h('h3', null, 'Не вдалося завантажити'),
    h('p', null, errorText(err)),
    retry ? h('button', { class: 'btn secondary', type: 'button', onclick: retry }, icon('refresh'), 'Спробувати ще раз') : null);
}

/* ---------- toast ---------- */
let toastHost;
export function toast(message, kind = '') {
  if (!toastHost) { toastHost = h('div', { class: 'toasts', role: 'status' }); document.body.append(toastHost); }
  const el = h('div', { class: `toast ${kind}` }, message);
  toastHost.append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3200);
}

/* ---------- sheet (нативний dialog) ---------- */
export function sheet({ title, build }) {
  const dialog = h('dialog', { class: 'sheet', 'aria-label': title });
  const close = () => { dialog.close(); };
  const body = h('div', { class: 'sheet-body' },
    h('div', { class: 'sheet-head' }, h('h2', null, title), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Закрити', onclick: close }, icon('close'))));
  body.prepend(h('div', { class: 'sheet-grip' }));
  dialog.append(body);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  document.body.append(dialog);
  build(body, close);
  dialog.showModal();
  return { close, body };
}

export function confirmSheet({ title, text, confirmLabel = 'Підтвердити', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const s = sheet({
      title,
      build(body, close) {
        body.append(h('p', { class: 'muted' }, text),
          h('div', { class: 'sheet-actions' },
            h('button', { class: 'btn secondary', type: 'button', onclick: () => { answered = true; resolve(false); close(); } }, 'Скасувати'),
            h('button', { class: `btn ${danger ? 'danger' : ''}`, type: 'button', onclick: () => { answered = true; resolve(true); close(); } }, confirmLabel)));
      },
    });
    s.body.parentElement.addEventListener('close', () => { if (!answered) resolve(false); });
  });
}

/* ---------- форми ---------- */
export function field({ id, label, hint, control }) {
  return h('div', { class: 'field' }, h('label', { for: id }, label), control, hint ? h('div', { class: 'hint' }, hint) : null);
}
export async function withBusy(button, task) {
  button.setAttribute('aria-busy', 'true');
  try { return await task(); } finally { button.removeAttribute('aria-busy'); }
}
export function setBody(container, node) { clear(container); container.append(node); }
