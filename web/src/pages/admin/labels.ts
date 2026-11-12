import type { components } from '../../api/schema';

type S = components['schemas'];
export type PanelOverview = S['PanelOverviewDto'];
export type PanelJob = S['PanelJobDto'];
export type PanelAction = S['PanelAction'];
export type Container = S['ContainerDto'];
export type AuditEntry = S['AuditEntryDto'];

/** Disks up to terabytes: the panel shows server volumes, not files. */
export function formatBytes(bytes: number): string {
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString('uk-UA', { maximumFractionDigits: i >= 3 ? 1 : 0 })} ${units[i]}`;
}

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d} д ${h} год`;
  if (h) return `${h} год ${m} хв`;
  return `${m} хв`;
}

/** «Скільки тому» for the last backup. */
export function formatAgo(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (min < 60) return `${min} хв тому`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} год тому`;
  return `${Math.round(h / 24)} д тому`;
}

/** A daily backup older than this is a warning. */
export const BACKUP_STALE_HOURS = 36;

export const CONTAINER_LABEL: Record<string, string> = {
  api: 'API',
  db: 'База даних',
  homeassistant: 'Home Assistant',
};

export type Tone = 'ok' | 'warn' | 'bad';

/** running + healthy (or no healthcheck) is fine; starting is a warning; the rest is bad. */
export function containerTone(c: Pick<Container, 'state' | 'health'>): Tone {
  if (c.state !== 'running') return c.state === 'restarting' ? 'warn' : 'bad';
  if (c.health === 'unhealthy') return 'bad';
  if (c.health === 'starting') return 'warn';
  return 'ok';
}

export function containerText(c: Pick<Container, 'state' | 'health'>): string {
  if (c.state === 'missing') return 'не знайдено';
  if (c.state === 'restarting') return 'перезапускається';
  if (c.state !== 'running') return `зупинено (${c.state})`;
  if (c.health === 'unhealthy') return 'працює, але несправний';
  if (c.health === 'starting') return 'запускається';
  return 'працює';
}

/** Share of a resource: above 90% is bad, above 75% a warning. */
export function usageTone(percent: number): Tone {
  return percent > 90 ? 'bad' : percent > 75 ? 'warn' : 'ok';
}

export const ACTION_LABEL: Record<PanelAction, string> = {
  backup: 'Бекап',
  'restore-check': 'Перевірка відновлення',
  'restart-api': 'Перезапуск API',
  'restart-ha': 'Перезапуск Home Assistant',
};

/** Groups for the audit filter: `?action=<prefix>.` on the server. */
export const AUDIT_GROUPS: { value: string; label: string }[] = [
  { value: 'user.', label: 'Учасники' },
  { value: 'auth.', label: 'Вхід' },
  { value: 'authorization.', label: 'Допуски' },
  { value: 'points.', label: 'Бали' },
  { value: 'discipline.', label: 'Дисципліна' },
  { value: 'task.', label: 'ТЗ' },
  { value: 'project.', label: 'Проєкти' },
  { value: 'place.', label: 'Обладнання' },
  { value: 'session.', label: 'Сеанси' },
  { value: 'booking.', label: 'Бронювання' },
  { value: 'fault.', label: 'Несправності' },
  { value: 'inventory.', label: 'Склад' },
  { value: 'document.', label: 'Документи' },
  { value: 'smart.', label: 'Розумна лабораторія' },
  { value: 'panel.', label: 'Розширена панель' },
];

/** Human text for each audit action; an unknown one is shown as is. */
export const AUDIT_ACTION: Record<string, string> = {
  'auth.2fa_login': 'Вхід із кодом 2FA',
  'user.created': 'Створив учасника',
  'user.updated': 'Змінив дані учасника',
  'user.profile_updated': 'Змінив свій профіль',
  'user.password_changed': 'Змінив свій пароль',
  'user.password_reset': 'Скинув пароль',
  'user.avatar_changed': 'Змінив аватар',
  'user.avatar_removed': 'Прибрав аватар',
  'user.2fa_enabled': 'Увімкнув 2FA',
  'user.2fa_disabled': 'Вимкнув 2FA',
  'user.2fa_reset': 'Скинув 2FA',
  'user.2fa_recovery_regenerated': 'Оновив запасні коди 2FA',
  'user.guest_converted': 'Гостя переведено в учасники',
  'authorization.granted': 'Видав допуск',
  'authorization.revoked': 'Відкликав допуск',
  'points.awarded': 'Нарахував бали',
  'points.revoked': 'Зняв нарахування',
  'discipline.issued': 'Видав запис дисципліни',
  'discipline.revoked': 'Зняв запис дисципліни',
  'task.created': 'Створив ТЗ',
  'task.updated': 'Змінив ТЗ',
  'task.deleted': 'Видалив ТЗ',
  'task.taken': 'Взяв ТЗ',
  'task.left': 'Відмовився від ТЗ',
  'task.started': 'Почав ТЗ',
  'task.submitted': 'Здав ТЗ на перевірку',
  'task.returned': 'Повернув ТЗ на допрацювання',
  'task.accepted': 'Прийняв ТЗ',
  'task.file_added': 'Додав файл до ТЗ',
  'task.file_removed': 'Видалив файл ТЗ',
  'project.created': 'Створив проєкт',
  'project.updated': 'Змінив проєкт',
  'project.archived': 'Архівував проєкт',
  'project.file_added': 'Додав файл до проєкту',
  'project.file_removed': 'Видалив файл проєкту',
  'place.created': 'Додав обладнання',
  'place.updated': 'Змінив обладнання',
  'session.started': 'Почав сеанс',
  'session.ended': 'Завершив сеанс',
  'session.auto_closed': 'Сеанс закрито автоматично',
  'booking.created': 'Забронював',
  'booking.cancelled': 'Скасував бронювання',
  'fault.created': 'Повідомив про несправність',
  'fault.photo_added': 'Додав фото несправності',
  'fault.in_progress': 'Взяв несправність у роботу',
  'fault.maintenance': 'Поставив на обслуговування',
  'fault.closed': 'Закрив несправність',
  'inventory.item_created': 'Додав позицію складу',
  'inventory.item_updated': 'Змінив позицію складу',
  'inventory.movement': 'Рух на складі',
  'document.created': 'Додав документ',
  'document.updated': 'Змінив документ',
  'document.version_added': 'Додав версію документа',
  'document.archived': 'Архівував документ',
  'smart.light_set': 'Керував світлом',
  'smart.scene_activated': 'Увімкнув сцену',
  'smart.entity_added': 'Додав пристрій до дозволених',
  'smart.entity_updated': 'Змінив дозволений пристрій',
  'smart.entity_removed': 'Прибрав пристрій із дозволених',
  'panel.action': 'Дія розширеної панелі',
};

/** Where an audit object opens in the app (null — nowhere to go). */
export function entityLink(entity: string, id: string | null): string | null {
  if (!id) return null;
  const base: Record<string, string> = {
    user: '/panel/users/',
    task: '/tasks/',
    project: '/projects/',
    place: '/lab/',
    document: '/docs/',
    inventory_item: '/inventory/',
  };
  return base[entity] ? base[entity] + id : null;
}

/** meta as short «key: value» lines; nested values as compact JSON. */
export function metaLines(meta: Record<string, unknown> | null): string[] {
  if (!meta) return [];
  return Object.entries(meta).map(([k, v]) => {
    const text = typeof v === 'string' ? v : JSON.stringify(v);
    return `${k}: ${text.length > 200 ? `${text.slice(0, 200)}…` : text}`;
  });
}
