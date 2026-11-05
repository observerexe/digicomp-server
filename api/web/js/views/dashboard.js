import { h, clear } from '../dom.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { traces } from '../decor.js';
import { state } from '../store.js';
import { led, fmtTime, fmtDate, fmtDuration, greeting, emptyState } from '../ui.js';

function ago(from) {
  const min = Math.floor((Date.now() - new Date(from).getTime()) / 60000);
  if (min < 1) return 'щойно';
  if (min < 60) return `${min} хв`;
  return `${Math.floor(min / 60)} год ${min % 60} хв`;
}

function tile(place, index, myId) {
  const active = place.activeSessions?.[0];
  const mine = active && active.user.id === myId;
  let kind = 'free', text;
  if (place.status === 'maintenance') { kind = 'fault'; text = h('span', null, 'На обслуговуванні'); }
  else if (place.inUse) {
    kind = 'busy';
    text = mine ? h('span', null, h('b', null, 'Це ваш сеанс'), ' ', ago(active.startedAt))
      : h('span', null, 'Працює ', h('b', null, active.user.name), ', ', ago(active.startedAt));
  } else text = h('span', null, 'Вільно');
  const el = h('a', { class: `tile${mine ? ' mine' : ''}`, href: `#/places/${encodeURIComponent(place.code)}` },
    h('div', { class: 'top' }, h('span', { class: 'code' }, place.code), led(kind, true)),
    h('h3', null, place.title),
    h('p', { class: 'state' }, text));
  el.style.setProperty('--i', String(index));
  return el;
}

export default async function dashboard() {
  const me = state.me;
  const [placesR, tasksR, stockR, pointsR] = await Promise.allSettled([
    api.get('/places'), api.get('/tasks'), api.get('/inventory/items?lowStock=true&limit=5'), api.get('/points/me'),
  ]);

  const tiles = h('div', { class: 'tiles' });
  const meta = h('span', null);
  const board = h('section', { class: 'board boot', 'aria-label': 'Станції лабораторії' });
  const paintBoard = (places) => {
    clear(tiles);
    const visible = places.filter((p) => p.status !== 'archived');
    if (!visible.length) tiles.append(h('p', { class: 'state' }, 'Місць ще немає. Додайте перше у розділі «Місця».'));
    visible.forEach((p, i) => tiles.append(tile(p, i, me.id)));
    meta.textContent = `Оновлено ${fmtTime(new Date())}`;
  };
  const refreshBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Оновити', onclick: async () => {
    try { paintBoard(await api.get('/places')); } catch { /* залишаємо попередній стан */ }
  } }, icon('refresh'));
  board.append(traces(),
    h('div', { class: 'board-head' }, h('h2', null, 'Дошка станцій'), h('div', { class: 'meta' }, meta, refreshBtn)),
    tiles);
  if (placesR.status === 'fulfilled') paintBoard(placesR.value);
  else tiles.append(h('p', { class: 'state' }, 'Не вдалося завантажити станції.'));
  setTimeout(() => board.classList.remove('boot'), 2500);

  const poll = setInterval(async () => {
    if (document.hidden) return;
    try { paintBoard(await api.get('/places')); } catch { /* наступна спроба */ }
  }, 20000);

  /* мої завдання */
  const tasks = tasksR.status === 'fulfilled'
    ? tasksR.value.filter((t) => t.status !== 'done' && t.assignees.some((a) => a.id === me.id))
      .sort((a, b) => (a.dueDate ? new Date(a.dueDate).getTime() : Infinity) - (b.dueDate ? new Date(b.dueDate).getTime() : Infinity)).slice(0, 5)
    : null;
  const taskCard = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, 'Мої завдання'), h('a', { class: 'link', href: '#/tasks' }, 'Усі')),
    tasks === null ? h('p', { class: 'muted' }, 'Не вдалося завантажити завдання.')
      : tasks.length === 0 ? emptyState('Завдань немає', 'Коли координатор призначить завдання, воно з’явиться тут.')
        : h('div', { class: 'list' }, tasks.map((t) => {
          const late = t.dueDate && new Date(t.dueDate) < new Date();
          return h('a', { class: 'row', href: '#/tasks' }, h('div', { class: 'grow' }, h('b', null, t.title), h('small', null, t.dueDate ? `До ${fmtDate(t.dueDate)}` : 'Без терміну')),
            late ? h('span', { class: 'badge danger' }, 'Прострочено') : null,
            h('span', { class: 'badge gold' }, `${t.points} б.`));
        })));

  /* склад */
  const stock = stockR.status === 'fulfilled' ? stockR.value : null;
  const stockCard = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, 'Закінчується на складі'), h('a', { class: 'link', href: '#/inventory' }, 'Склад')),
    stock === null ? h('p', { class: 'muted' }, 'Не вдалося завантажити склад.')
      : stock.items.length === 0 ? emptyState('Усього достатньо', 'Позицій із низьким залишком немає.')
        : h('div', { class: 'list' }, stock.items.map((i) => h('a', { class: 'row', href: '#/inventory' },
          h('div', { class: 'grow' }, h('b', null, i.title), h('small', null, i.code)),
          h('span', { class: 'badge warn num' }, `${i.quantity} ${i.unit}`)))));

  /* бали */
  const pts = pointsR.status === 'fulfilled' ? pointsR.value : null;
  const pointsCard = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, 'Ваші бали')),
    pts === null ? h('p', { class: 'muted' }, 'Не вдалося завантажити бали.')
      : h('div', { class: 'kpi' }, h('span', { class: 'v num' }, String(pts.balance)), h('span', { class: 'l' }, 'зароблено за завдання')));

  const node = h('div', { class: 'stack' }, board, h('div', { class: 'grid-2' }, taskCard, stockCard), pointsCard);
  const now = new Date();
  const weekday = new Intl.DateTimeFormat('uk-UA', { weekday: 'long' }).format(now);
  const dayMonth = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long' }).format(now);
  return {
    title: greeting(),
    mobileTitle: 'Дошка',
    sub: `${weekday[0].toUpperCase()}${weekday.slice(1)}, ${dayMonth}`,
    node,
    cleanup: () => clearInterval(poll),
  };
}
