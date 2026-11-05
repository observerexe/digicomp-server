import { h } from '../dom.js';
import { api, query } from '../api.js';
import { isSupervisor, state } from '../store.js';
import { fmtDateTime, fmtTime, fmtSpan, emptyState, errorText, avatar } from '../ui.js';

const PAGE = 20;

export default async function journal() {
  const supervisor = isSupervisor();
  let scope = supervisor ? 'all' : 'mine';
  let activeOnly = false;
  let page = 1;
  const list = h('div', { class: 'list' });
  const more = h('button', { class: 'btn secondary', type: 'button' }, 'Показати ще');
  const holder = h('div', { class: 'stack' });
  const chipsHost = h('div', { class: 'chips', role: 'group', 'aria-label': 'Фільтри журналу' });

  const row = (s) => h('div', { class: 'row' },
    supervisor && scope === 'all' ? avatar(s.user, 'sm') : null,
    h('div', { class: 'grow' },
      h('b', null, s.place.title),
      h('small', null, supervisor && scope === 'all' ? `${s.user.name}. ` : '', s.endedAt ? `${fmtDateTime(s.startedAt)} — ${fmtTime(s.endedAt)}` : `З ${fmtDateTime(s.startedAt)}`,
        s.endReason ? ` Завершено координатором: ${s.endReason}` : '', s.note ? ` ${s.note}` : '')),
    s.endedAt ? h('span', { class: 'dur' }, fmtSpan(s.startedAt, s.endedAt)) : h('span', { class: 'badge warn' }, 'триває'));

  async function load(reset) {
    if (reset) { page = 1; list.replaceChildren(); }
    try {
      const r = await api.get(`/work-sessions${query({ page, limit: PAGE, userId: scope === 'mine' ? state.me.id : undefined, active: activeOnly ? 'true' : undefined })}`);
      r.items.forEach((s) => list.append(row(s)));
      if (!list.children.length) holder.replaceChildren(emptyState('Записів немає', 'Тут з’являтимуться сеанси роботи на місцях.'));
      else holder.replaceChildren(list, ...(page * PAGE < r.total ? [more] : []));
    } catch (ex) { holder.replaceChildren(h('p', { class: 'form-error' }, errorText(ex))); }
  }
  more.addEventListener('click', () => { page += 1; load(false); });

  const paintChips = () => {
    const chips = [];
    if (supervisor) chips.push({ label: 'Усі', on: scope === 'all', go: () => { scope = 'all'; } }, { label: 'Мої', on: scope === 'mine', go: () => { scope = 'mine'; } });
    chips.push({ label: 'Лише активні', on: activeOnly, go: () => { activeOnly = !activeOnly; } });
    chipsHost.replaceChildren(...chips.map((c) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(c.on), onclick: () => { c.go(); paintChips(); load(true); } }, c.label)));
  };
  paintChips();
  await load(true);
  return { title: 'Журнал', sub: 'Хто і коли працював на місцях', node: h('div', { class: 'stack' }, chipsHost, holder) };
}
