import { h } from '../dom.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { state, update } from '../store.js';
import { avatar, field, toast, errorText, withBusy, ROLE_NAMES, confirmSheet } from '../ui.js';
import { applyTheme, logout } from '../app.js';

export default async function profile({ rerender }) {
  const me = state.me;

  /* аватар */
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, id: 'avatar-file' });
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { toast('Фото завелике: найбільше 2 МБ.', 'error'); return; }
    const form = new FormData();
    form.append('file', f);
    try {
      const r = await api.upload(`/users/${me.id}/avatar`, form);
      update({ me: { ...state.me, avatarUrl: `${r.avatarUrl}?v=${Date.now()}` } });
      toast('Фото оновлено');
      rerender();
    } catch (ex) { toast(errorText(ex), 'error'); }
  });
  const head = h('div', { class: 'profile-head' }, avatar(me, 'lg'),
    h('div', null, h('h2', null, me.name), h('p', { class: 'muted' }, me.email), h('span', { class: 'badge' }, ROLE_NAMES[me.role] || me.role)),
    h('div', { class: 'grow' }),
    h('label', { class: 'btn secondary small', for: 'avatar-file' }, icon('camera'), 'Змінити фото'), file);

  /* дані */
  const name = h('input', { class: 'input', id: 'pname', value: me.name, maxlength: '100', required: true });
  const position = h('input', { class: 'input', id: 'ppos', value: me.position || '', maxlength: '100' });
  const specialty = h('input', { class: 'input', id: 'pspec', value: me.specialty || '', maxlength: '200' });
  const bio = h('textarea', { class: 'input', id: 'pbio', maxlength: '2000' }, me.bio || '');
  const perr = h('div', { class: 'form-error', hidden: true, role: 'alert' });
  const psubmit = h('button', { class: 'btn', type: 'submit' }, 'Зберегти');
  const dataForm = h('form', null,
    field({ id: 'pname', label: 'Ім’я', control: name }),
    field({ id: 'ppos', label: 'Посада чи роль у команді', control: position }),
    field({ id: 'pspec', label: 'Спеціалізація', control: specialty }),
    field({ id: 'pbio', label: 'Про себе', control: bio }),
    perr, psubmit);
  dataForm.addEventListener('submit', async (e) => {
    e.preventDefault(); perr.hidden = true;
    await withBusy(psubmit, async () => {
      try {
        const r = await api.patch('/users/me', { name: name.value.trim(), position: position.value.trim(), specialty: specialty.value.trim(), bio: bio.value.trim() });
        update({ me: { ...state.me, ...r } });
        toast('Збережено');
        rerender();
      } catch (ex) { perr.textContent = errorText(ex); perr.hidden = false; }
    });
  });

  /* пароль */
  const cur = h('input', { class: 'input', id: 'cur', type: 'password', autocomplete: 'current-password', required: true });
  const nw = h('input', { class: 'input', id: 'new', type: 'password', autocomplete: 'new-password', minlength: '8', required: true });
  const rep = h('input', { class: 'input', id: 'rep', type: 'password', autocomplete: 'new-password', minlength: '8', required: true });
  const wrr = h('div', { class: 'form-error', hidden: true, role: 'alert' });
  const wsubmit = h('button', { class: 'btn', type: 'submit' }, 'Змінити пароль');
  const pwForm = h('form', null,
    field({ id: 'cur', label: 'Поточний пароль', control: cur }),
    field({ id: 'new', label: 'Новий пароль', hint: 'Щонайменше 8 символів.', control: nw }),
    field({ id: 'rep', label: 'Повторіть новий пароль', control: rep }),
    wrr, wsubmit);
  pwForm.addEventListener('submit', async (e) => {
    e.preventDefault(); wrr.hidden = true;
    if (nw.value.length < 8) { wrr.textContent = 'Новий пароль має містити щонайменше 8 символів.'; wrr.hidden = false; return; }
    if (nw.value !== rep.value) { wrr.textContent = 'Паролі не збігаються.'; wrr.hidden = false; return; }
    await withBusy(wsubmit, async () => {
      try {
        await api.patch('/users/me/password', { currentPassword: cur.value, newPassword: nw.value });
        toast('Пароль змінено. Увійдіть знову.');
        await logout();
      } catch (ex) { wrr.textContent = errorText(ex); wrr.hidden = false; }
    });
  });

  /* вигляд */
  const mode = localStorage.getItem('dc-theme') || 'auto';
  const themes = [['auto', 'Як у системі'], ['light', 'Світла'], ['dark', 'Темна']];
  const themeHost = h('div', { class: 'chips', role: 'group', 'aria-label': 'Тема' });
  const paintThemes = () => themeHost.replaceChildren(...themes.map(([id, label]) => h('button', {
    class: 'chip', type: 'button', 'aria-pressed': String((localStorage.getItem('dc-theme') || 'auto') === id),
    onclick: () => { if (id === 'auto') localStorage.removeItem('dc-theme'); else localStorage.setItem('dc-theme', id); applyTheme(id === 'auto' ? null : id); paintThemes(); },
  }, label)));
  paintThemes();

  const security = h('div', { class: 'stack' },
    h('button', { class: 'btn secondary', type: 'button', onclick: logout }, icon('logout'), 'Вийти'),
    h('button', { class: 'btn ghost', type: 'button', onclick: async () => {
      if (!(await confirmSheet({ title: 'Вийти на всіх пристроях?', text: 'Усі ваші сеанси, зокрема на інших пристроях, буде закрито.', confirmLabel: 'Вийти всюди' }))) return;
      try { await api.post('/auth/logout-all', {}); } catch { /* вихід нижче */ }
      await logout();
    } }, 'Вийти на всіх пристроях'));

  const node = h('div', { class: 'stack' },
    h('section', { class: 'card' }, head, dataForm),
    h('div', { class: 'grid-2' },
      h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Пароль')), pwForm),
      h('div', { class: 'stack' },
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Вигляд')), themeHost),
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Сеанс')), security))));
  return { title: 'Профіль', node };
}
