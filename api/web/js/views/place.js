import { h, clear } from '../dom.js';
import { api, query } from '../api.js';
import { icon } from '../icons.js';
import { qrSvg, qrPng } from '../qr.js';
import { state, isSupervisor } from '../store.js';
import { led, avatar, fmtDateTime, fmtDate, fmtSpan, fmtTime, emptyState, sheet, field, toast, errorText, withBusy, confirmSheet } from '../ui.js';
import { refreshActiveSession } from '../app.js';
import { openStartSession, openEndSession } from './session-ui.js';
import { placeForm } from './place-form.js';

const STATUS_TEXT = { active: 'Працює', maintenance: 'На обслуговуванні', archived: 'В архіві' };

function sessionRow(s, showUser) {
  return h('div', { class: 'row' },
    h('div', { class: 'grow' },
      h('b', null, showUser ? s.user.name : s.place.title),
      h('small', null, s.endedAt ? `${fmtDateTime(s.startedAt)} — ${fmtTime(s.endedAt)}` : `З ${fmtDateTime(s.startedAt)}`, s.note ? ` · ${s.note}` : '')),
    s.endedAt ? h('span', { class: 'dur' }, fmtSpan(s.startedAt, s.endedAt)) : h('span', { class: 'badge warn' }, 'триває'));
}

export default async function place({ params, rerender }) {
  const p = await api.get(`/places/${encodeURIComponent(params.code)}`);
  const supervisor = isSupervisor();
  const [sessionsR, authsR] = await Promise.allSettled([
    api.get(`/work-sessions${query({ placeId: p.id, limit: 10 })}`),
    supervisor ? api.get(`/place-authorizations${query({ placeId: p.id })}`) : Promise.resolve(null),
  ]);

  /* стан і головна дія */
  const active = p.activeSessions?.[0];
  const mine = state.activeSession && state.activeSession.place.id === p.id ? state.activeSession : null;
  let ledKind = 'free', statusText = 'Вільно';
  if (p.status === 'maintenance') { ledKind = 'fault'; statusText = 'На обслуговуванні'; }
  else if (p.status === 'archived') { ledKind = 'idle'; statusText = 'В архіві'; }
  else if (p.inUse) { ledKind = 'busy'; statusText = `Працює ${active.user.name} з ${fmtTime(active.startedAt)}`; }

  const cta = h('div', { class: 'cta' });
  const after = async () => { await refreshActiveSession(); rerender(); };
  if (mine) cta.append(h('button', { class: 'btn', type: 'button', onclick: () => openEndSession(mine, after) }, 'Завершити сеанс'), h('p', { class: 'note' }, 'Це ваш активний сеанс.'));
  else if (state.activeSession) cta.append(h('p', { class: 'note' }, 'У вас уже триває сеанс на «', h('a', { href: `#/places/${encodeURIComponent(state.activeSession.place.code || state.activeSession.place.id)}` }, state.activeSession.place.title), '». Спершу завершіть його.'));
  else if (p.status !== 'active') cta.append(h('p', { class: 'note' }, 'Це місце зараз недоступне.'));
  else if (p.exclusive && p.inUse) cta.append(h('p', { class: 'note' }, `Зараз працює ${active.user.name}. Місце звільниться після завершення сеансу.`));
  else if (p.needsAuthorization && !p.myAuthorization && !supervisor) cta.append(h('p', { class: 'note' }, 'Для цього місця потрібен допуск. Зверніться до координатора.'));
  else cta.append(h('button', { class: 'btn', type: 'button', onclick: () => openStartSession(p, after) }, 'Почати роботу'));

  /* інформація */
  const authText = !p.needsAuthorization ? 'Не потрібен'
    : p.myAuthorization ? (p.myAuthorization.expiresAt ? `У вас є допуск до ${fmtDate(p.myAuthorization.expiresAt)}` : 'У вас є допуск')
      : supervisor ? 'Потрібен (для вас не обов’язковий)' : 'Потрібен, у вас його немає';
  const info = h('dl', { class: 'kv' },
    h('dt', null, 'Категорія'), h('dd', null, p.category),
    p.location ? [h('dt', null, 'Розташування'), h('dd', null, p.location)] : null,
    h('dt', null, 'Допуск'), h('dd', null, authText),
    h('dt', null, 'Режим'), h('dd', null, p.exclusive ? 'Одночасно одна людина' : 'Можуть працювати кілька людей'));

  /* QR */
  const url = `${state.publicOrigin || location.origin}/#/places/${encodeURIComponent(p.code)}`;
  const qr = h('div', { class: 'qr' }, qrSvg(url));
  const qrCard = h('section', { class: 'card qr-card no-print' },
    qr, h('div', { class: 'code' }, p.code),
    h('p', { class: 'muted' }, 'Наклейте на робоче місце: за цим кодом відкривається ця сторінка.'),
    h('div', { class: 'sheet-actions' },
      h('button', { class: 'btn secondary small', type: 'button', onclick: async () => {
        const blob = await qrPng(url, 800);
        const a = h('a', { href: URL.createObjectURL(blob), download: `${p.code}.png` });
        document.body.append(a); a.click(); a.remove();
      } }, icon('download'), 'PNG'),
      h('button', { class: 'btn secondary small', type: 'button', onclick: () => window.print() }, icon('print'), 'Друк')));
  const label = h('div', { class: 'print-label only-print' }, h('div', { class: 'qr' }, qrSvg(url)), h('h1', null, p.title), h('div', { class: 'code' }, p.code));

  /* вкладки */
  const tabs = [{ id: 'log', label: 'Журнал' }];
  if (supervisor) tabs.push({ id: 'auth', label: 'Допуски' });
  let tab = 'log';
  const panel = h('div');
  const tabBar = h('div', { class: 'tabs', role: 'tablist' });
  const paintTab = () => {
    tabBar.replaceChildren(...tabs.map((t) => h('button', { role: 'tab', type: 'button', 'aria-selected': String(tab === t.id), onclick: () => { tab = t.id; paintTab(); } }, t.label)));
    clear(panel);
    if (tab === 'log') {
      const items = sessionsR.status === 'fulfilled' ? sessionsR.value.items : null;
      panel.append(items === null ? h('p', { class: 'muted' }, 'Не вдалося завантажити журнал.')
        : items.length === 0 ? emptyState('Сеансів ще не було', 'Тут з’являтимуться записи про роботу на цьому місці.')
          : h('div', { class: 'list' }, items.map((s) => sessionRow(s, true))));
    } else panel.append(authPanel());
  };

  function authPanel() {
    const rows = authsR.status === 'fulfilled' ? authsR.value : null;
    const box = h('div', { class: 'stack' });
    box.append(h('div', null, h('button', { class: 'btn small', type: 'button', onclick: () => grantSheet() }, icon('plus'), 'Видати допуск')));
    if (rows === null) box.append(h('p', { class: 'muted' }, 'Не вдалося завантажити допуски.'));
    else if (!rows.length) box.append(emptyState('Допусків ще немає', 'Видайте допуск учасникам, яким дозволено працювати тут.'));
    else box.append(h('div', { class: 'list' }, rows.map((a) => h('div', { class: 'row' },
      h('div', { class: 'grow' }, h('b', null, a.user.name), h('small', null, a.expiresAt ? `До ${fmtDate(a.expiresAt)}` : 'Безстроково', a.expired ? ' · термін минув' : '')),
      a.expired ? h('span', { class: 'badge danger' }, 'не діє') : null,
      h('button', { class: 'btn ghost small', type: 'button', onclick: async () => {
        if (!(await confirmSheet({ title: 'Забрати допуск?', text: `${a.user.name} більше не зможе починати роботу на цьому місці.`, confirmLabel: 'Забрати', danger: true }))) return;
        try { await api.del(`/place-authorizations/${a.id}`); toast('Допуск знято'); rerender(); } catch (ex) { toast(errorText(ex), 'error'); }
      } }, icon('trash'), 'Забрати')))));
    return box;
  }

  function grantSheet() {
    sheet({
      title: 'Видати допуск',
      build(body, close) {
        const select = h('select', { class: 'input', id: 'guser' }, h('option', { value: '' }, 'Завантаження…'));
        api.get('/users?limit=100').then((r) => {
          select.replaceChildren(h('option', { value: '' }, 'Оберіть учасника'), ...r.items.filter((u) => u.role !== 'guest').map((u) => h('option', { value: u.id }, u.name)));
        }).catch(() => { select.replaceChildren(h('option', { value: '' }, 'Не вдалося завантажити список')); });
        const exp = h('input', { class: 'input', id: 'gexp', type: 'date' });
        const err = h('div', { class: 'form-error', hidden: true, role: 'alert' });
        const submit = h('button', { class: 'btn', type: 'submit' }, 'Видати');
        const form = h('form', null,
          field({ id: 'guser', label: 'Учасник', control: select }),
          field({ id: 'gexp', label: 'Діє до', hint: 'Залиште порожнім для безстрокового допуску.', control: exp }),
          err,
          h('div', { class: 'sheet-actions' }, h('button', { class: 'btn secondary', type: 'button', onclick: close }, 'Скасувати'), submit));
        form.addEventListener('submit', async (e) => {
          e.preventDefault(); err.hidden = true;
          if (!select.value) { err.textContent = 'Оберіть учасника.'; err.hidden = false; return; }
          await withBusy(submit, async () => {
            try {
              await api.post('/place-authorizations', { userId: select.value, placeId: p.id, expiresAt: exp.value ? new Date(exp.value + 'T23:59:59').toISOString() : undefined });
              close(); toast('Допуск видано'); rerender();
            } catch (ex) { err.textContent = errorText(ex); err.hidden = false; }
          });
        });
        body.append(form);
      },
    });
  }
  paintTab();

  const hero = h('section', { class: 'place-hero' },
    h('div', null,
      h('div', { class: 'id' }, led(ledKind, true, true), h('span', { class: 'code mono muted' }, p.code)),
      h('h1', null, p.title),
      h('div', { class: 'status-line' }, h('b', null, statusText), p.status !== 'active' ? h('span', { class: 'badge' }, STATUS_TEXT[p.status]) : null),
      cta,
      p.description ? h('p', { class: 'muted' }, p.description) : null));

  const node = h('div', { class: 'stack' },
    h('div', { class: 'toolbar no-print' },
      h('a', { class: 'btn ghost small', href: '#/places' }, icon('back'), 'Усі місця'),
      supervisor ? h('button', { class: 'btn secondary small', type: 'button', onclick: () => placeForm(p, () => rerender()) }, icon('edit'), 'Змінити') : null),
    h('div', { class: 'place-layout' },
      h('div', { class: 'stack' },
        hero,
        h('section', { class: 'card no-print' }, h('h2', { class: 'card-head' }, 'Про місце'), info),
        h('section', { class: 'no-print' }, tabBar, panel)),
      h('aside', { class: 'no-print' }, qrCard)),
    label);

  return { title: p.title, mobileTitle: p.code, bare: true, node };
}
