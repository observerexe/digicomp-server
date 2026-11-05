import { h } from '../dom.js';
import { api } from '../api.js';
import { brandMark } from '../icons.js';
import { traces } from '../decor.js';
import { errorText, withBusy, led } from '../ui.js';

export default async function login({ onLoggedIn }) {
  const email = h('input', { class: 'input', id: 'email', type: 'email', autocomplete: 'username', required: true, inputmode: 'email', placeholder: 'name@example.com' });
  const pass = h('input', { class: 'input', id: 'password', type: 'password', autocomplete: 'current-password', required: true, minlength: '8' });
  const err = h('div', { class: 'form-error', hidden: true, role: 'alert' });
  const submit = h('button', { class: 'btn block', type: 'submit' }, 'Увійти');

  const form = h('form', { novalidate: true },
    h('div', { class: 'field' }, h('label', { for: 'email' }, 'Електронна пошта'), email),
    h('div', { class: 'field' }, h('label', { for: 'password' }, 'Пароль'), pass),
    err, submit);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    if (!email.value.trim() || pass.value.length < 8) {
      err.textContent = 'Введіть пошту та пароль (щонайменше 8 символів).';
      err.hidden = false;
      return;
    }
    await withBusy(submit, async () => {
      try {
        const r = await api.post('/auth/login', { email: email.value.trim(), password: pass.value });
        pass.value = '';
        await onLoggedIn(r.user);
      } catch (ex) { err.textContent = errorText(ex); err.hidden = false; }
    });
  });

  const art = h('section', { class: 'login-art', 'aria-hidden': 'true' },
    traces(),
    h('h2', null, 'Усе, що потрібно лабораторії, в одному місці'),
    h('p', null, 'Станції, склад, документи й проєкти команди. Відскануйте QR на робочому місці й починайте.'),
    h('div', { class: 'leds' }, led('free'), led('free'), led('busy'), led('free'), led('idle', false)));

  const card = h('main', { class: 'login-card' },
    brandMark(),
    h('h1', null, 'Вхід у DigiComp HUB'),
    h('p', { class: 'lead' }, 'Увійдіть обліковим записом, який видав координатор.'),
    form);

  return { node: h('div', { class: 'login' }, art, card) };
}
