import { h } from '../dom.js';
import { currentPath } from '../router.js';
import { emptyState } from '../ui.js';

const TITLES = { '/inventory': 'Склад', '/documents': 'Документи', '/projects': 'Проєкти', '/tasks': 'Завдання', '/team': 'Команда', '/smart': 'Розумна майстерня' };

export default async function soon() {
  const title = TITLES[currentPath()] || 'Розділ';
  return { title, node: emptyState(`${title} з’явиться найближчим часом`, 'Серверна частина вже працює, інтерфейс цього розділу ще у розробці.', h('a', { class: 'btn', href: '#/' }, 'На дошку')) };
}
