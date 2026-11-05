import { h } from '../dom.js';
import { icon } from '../icons.js';
import { logout } from '../app.js';

const ITEMS = [
  ['/journal', 'clock', 'Журнал', 'Хто й коли працював'],
  ['/documents', 'file', 'Документи', 'Інструкції та правила'],
  ['/tasks', 'tasks', 'Завдання', 'Бали за виконане'],
  ['/team', 'users', 'Команда', 'Учасники лабораторії'],
  ['/smart', 'bolt', 'Розумна майстерня', 'Світло й датчики'],
  ['/profile', 'user', 'Профіль', 'Ваші дані та безпека'],
];

export default async function more() {
  const node = h('div', { class: 'stack' },
    h('div', { class: 'more-grid' }, ITEMS.map(([path, ic, title, text]) => h('a', { href: '#' + path }, icon(ic), h('span', null, title), h('small', null, text)))),
    h('button', { class: 'btn secondary', type: 'button', onclick: logout }, icon('logout'), 'Вийти'));
  return { title: 'Ще', node };
}
