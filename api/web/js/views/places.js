import { h } from '../dom.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { navigate } from '../router.js';
import { isSupervisor } from '../store.js';
import { led, emptyState, sheet, field, toast, errorText, withBusy } from '../ui.js';
import { placeForm } from './place-form.js';

function statusOf(p) {
  if (p.status === 'maintenance') return { kind: 'fault', text: 'На обслуговуванні' };
  if (p.status === 'archived') return { kind: 'idle', text: 'В архіві' };
  if (p.inUse) return { kind: 'busy', text: `Працює ${p.activeSessions[0].user.name}` };
  return { kind: 'free', text: 'Вільно' };
}

export default async function places() {
  const all = await api.get('/places');
  let filter = 'all', category = '', text = '';
  const grid = h('div', { class: 'place-grid' });
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Пошук за назвою, кодом чи місцем', 'aria-label': 'Пошук' });
  const chipsHost = h('div', { class: 'chips', role: 'group', 'aria-label': 'Фільтри' });

  const categories = [...new Set(all.map((p) => p.category))].sort();
  const chips = [
    { id: 'all', label: 'Усі' }, { id: 'free', label: 'Вільні' }, { id: 'busy', label: 'Зайняті' },
    ...categories.map((c) => ({ id: 'cat:' + c, label: c })),
  ];
  const paint = () => {
    const q = text.trim().toLowerCase();
    const list = all.filter((p) => {
      if (filter === 'free' && !(p.status === 'active' && !p.inUse)) return false;
      if (filter === 'busy' && !p.inUse) return false;
      if (category && p.category !== category) return false;
      if (q && ![p.title, p.code, p.location, p.category].some((v) => (v || '').toLowerCase().includes(q))) return false;
      return true;
    });
    grid.replaceChildren(...(list.length ? list.map((p) => {
      const s = statusOf(p);
      return h('a', { class: 'place-card', href: `#/places/${encodeURIComponent(p.code)}` },
        h('div', { class: 'top' }, h('span', { class: 'code' }, p.code), h('span', { class: 'badge' }, led(s.kind, true), s.text)),
        h('h3', null, p.title),
        h('p', { class: 'where' }, p.location || p.category));
    }) : [emptyState('Нічого не знайдено', 'Змініть фільтр або пошуковий запит.')]));
    chipsHost.replaceChildren(...chips.map((c) => h('button', {
      class: 'chip', type: 'button',
      'aria-pressed': String(c.id.startsWith('cat:') ? category === c.id.slice(4) : (!category && filter === c.id)),
      onclick: () => {
        if (c.id.startsWith('cat:')) { category = category === c.id.slice(4) ? '' : c.id.slice(4); filter = 'all'; }
        else { filter = c.id; category = ''; }
        paint();
      },
    }, c.label)));
  };
  search.addEventListener('input', () => { text = search.value; paint(); });
  paint();

  const actions = isSupervisor()
    ? [h('button', { class: 'btn', type: 'button', onclick: () => placeForm(null, (p) => navigate(`/places/${encodeURIComponent(p.code)}`)) }, icon('plus'), 'Нове місце')]
    : [];
  const node = all.length === 0
    ? emptyState('Місць ще немає', isSupervisor() ? 'Додайте першу станцію, і вона з’явиться тут.' : 'Координатор ще не додав жодного місця.')
    : h('div', { class: 'stack' }, h('div', { class: 'search' }, icon('search'), search), chipsHost, grid);
  return { title: 'Місця', sub: 'Робочі місця лабораторії та їхній стан', actions, node };
}
