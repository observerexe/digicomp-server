import type { IconName } from '../components/Icon';

export type NavItem = {
  to: string;
  label: string;
  /** Shorter label for the phone's bottom bar, when `label` does not fit. */
  short?: string;
  icon: IconName;
  /** Action from /auth/me permissions needed to see the item. */
  permission?: string;
};

/** Bottom bar on a phone (the QR button sits in the middle). */
export const TABS: NavItem[] = [
  { to: '/', label: 'Головна', icon: 'home' },
  { to: '/tasks', label: 'Технічні завдання', short: 'Завдання', icon: 'board' },
  { to: '/lab', label: 'Лабораторія', icon: 'lab' },
  { to: '/profile', label: 'Профіль', icon: 'user' },
];

/** Everything else: the «Ще» menu on a phone, the sidebar on a computer. */
export const MORE: NavItem[] = [
  { to: '/team', label: 'Команда', icon: 'users' },
  { to: '/projects', label: 'Проєкти', icon: 'folder' },
  { to: '/inventory', label: 'Склад', icon: 'box' },
  { to: '/smart', label: 'Розумна лабораторія', icon: 'bulb', permission: 'smart.read' },
  { to: '/docs', label: 'Архів', icon: 'file' },
  { to: '/editor', label: 'Редактор', icon: 'pen', permission: 'papers.read' },
  { to: '/rating', label: 'Рейтинг', icon: 'star' },
  { to: '/fun', label: 'Розваги', icon: 'dice', permission: 'bunker.play' },
];

/** «Керування»: moderators and admins only. */
export const STAFF: NavItem[] = [
  { to: '/panel', label: 'Панель керування', icon: 'shield', permission: 'users.manage' },
  { to: '/points', label: 'Бали', icon: 'star', permission: 'points.award' },
  { to: '/discipline', label: 'Дисципліна', icon: 'file', permission: 'discipline.issue' },
  { to: '/admin', label: 'Розширена панель', icon: 'server', permission: 'admin.panel' },
];

export const SIDEBAR: NavItem[] = [...TABS.slice(0, 3), ...MORE, TABS[3]!];

export function visible(items: NavItem[], can: (a: string) => boolean) {
  return items.filter((i) => !i.permission || can(i.permission));
}
