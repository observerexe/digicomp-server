import type { components } from '../../api/schema';
import { TASK_STATUS_LABEL } from '../../lib/labels';

type S = components['schemas'];
export type PanelOverview = S['PanelOverviewDto'];
export type PanelJob = S['PanelJobDto'];
export type PanelAction = S['PanelAction'];
export type Container = S['ContainerDto'];
export type AuditEntry = S['AuditEntryDto'];
export type AuditAction = S['AuditAction'];

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
  { value: 'task.', label: 'Технічні завдання' },
  { value: 'project.', label: 'Проєкти' },
  { value: 'place.', label: 'Обладнання' },
  { value: 'session.', label: 'Сеанси' },
  { value: 'booking.', label: 'Бронювання' },
  { value: 'fault.', label: 'Несправності' },
  { value: 'inventory.', label: 'Склад' },
  { value: 'document.', label: 'Архів' },
  { value: 'paper.', label: 'Документи редактора' },
  { value: 'paper_template.', label: 'Шаблони документів' },
  { value: 'record_field.', label: 'Налаштування полів' },
  { value: 'org_settings.', label: 'Реквізити' },
  { value: 'trash.', label: 'Кошик' },
  { value: 'smart.', label: 'Розумна лабораторія' },
  { value: 'dictionary.', label: 'Довідники' },
  { value: 'link.', label: 'Зв’язки' },
  { value: 'panel.', label: 'Розширена панель' },
];

/** Human text for each audit action (the type makes a new action from the server need its text). */
export const AUDIT_ACTION: Record<AuditAction, string> = {
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
  'task.created': 'Створив технічне завдання',
  'task.updated': 'Змінив технічне завдання',
  'task.deleted': 'Видалив технічне завдання',
  'task.taken': 'Взяв технічне завдання',
  'task.left': 'Відмовився від технічного завдання',
  'task.started': 'Почав технічне завдання',
  'task.submitted': 'Здав технічне завдання на перевірку',
  'task.returned': 'Повернув технічне завдання на допрацювання',
  'task.accepted': 'Прийняв технічне завдання',
  'task.archived': 'Переніс технічне завдання в архів',
  'task.unarchived': 'Повернув технічне завдання з архіву',
  'task.file_added': 'Додав файл до технічного завдання',
  'task.file_removed': 'Видалив файл технічного завдання',
  'project.created': 'Створив проєкт',
  'project.updated': 'Змінив проєкт',
  'project.archived': 'Архівував проєкт',
  'project.stage_migrated': 'Етап проєкту перенесено зі старого статусу',
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
  'document.unarchived': 'Повернув документ з архіву',
  'paper.created': 'Створив документ у редакторі',
  'paper.updated': 'Змінив документ у редакторі',
  'paper.published': 'Опублікував документ',
  'paper.frozen': 'Зафіксував документ',
  'paper.signature_added': 'Підписав документ',
  'paper.signed': 'Додав підписаний скан документа',
  'paper.cancelled': 'Скасував документ',
  'paper.deleted': 'Видалив чернетку документа',
  'paper.image_uploaded': 'Завантажив зображення в документ',
  'paper.images_purged': 'Прибрав невикористані зображення документів',
  'paper_template.created': 'Створив шаблон',
  'paper_template.updated': 'Змінив шаблон',
  'paper_template.published': 'Опублікував версію шаблону',
  'paper_template.draft_discarded': 'Скасував чернетку шаблону',
  'paper_template.deleted': 'Видалив шаблон',
  'record_field.created': 'Додав поле',
  'record_field.updated': 'Змінив поле',
  'record_field.reordered': 'Змінив порядок полів',
  'record_field.deleted': 'Видалив поле',
  'org_settings.updated': 'Змінив реквізити',
  'trash.deleted': 'Видалив у кошик',
  'trash.restored': 'Відновив із кошика',
  'trash.purged': 'Видалив назавжди',
  'smart.light_set': 'Керував світлом',
  'smart.scene_activated': 'Увімкнув сцену',
  'smart.entity_added': 'Додав пристрій до дозволених',
  'smart.entity_updated': 'Змінив дозволений пристрій',
  'smart.entity_removed': 'Прибрав пристрій із дозволених',
  'dictionary.created': 'Створив довідник',
  'dictionary.updated': 'Перейменував довідник',
  'dictionary.deleted': 'Видалив довідник',
  'dictionary.item_created': 'Додав пункт довідника',
  'dictionary.item_updated': 'Змінив пункт довідника',
  'dictionary.items_reordered': 'Змінив порядок пунктів довідника',
  'dictionary.item_deleted': 'Видалив пункт довідника',
  'link.created': 'Пов’язав записи',
  'link.removed': 'Прибрав зв’язок',
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
    paper: '/editor/',
    paper_template: '/editor/templates/',
  };
  return base[entity] ? base[entity] + id : null;
}

/** Task statuses in the audit, with the old «У черзі» of earlier entries. */
const AUDIT_TASK_STATUS: Record<string, string> = { ...TASK_STATUS_LABEL, queued: 'У черзі' };

/** «key: value» lines; a task's `from` / `to` — status names; ids of people (`authorId`, `userId`…) — their names. */
export function metaLines(meta: Record<string, unknown> | null, entity?: string, people?: ReadonlyMap<string, string>): string[] {
  if (!meta) return [];
  const person = (v: unknown) => (typeof v === 'string' ? people?.get(v) : undefined);
  return Object.entries(meta).map(([k, v]) => {
    const status = entity === 'task' && (k === 'from' || k === 'to') && typeof v === 'string' ? AUDIT_TASK_STATUS[v] : undefined;
    const names = Array.isArray(v) && v.length && v.every((x) => person(x)) ? v.map((x) => person(x)!).join(', ') : undefined;
    // Nested (`changes: { signerId: { to } }`): people by name too.
    const text = status ?? person(v) ?? names ?? (typeof v === 'string' ? v : JSON.stringify(v, (_, x: unknown) => person(x) ?? x));
    return `${k}: ${text.length > 200 ? `${text.slice(0, 200)}…` : text}`;
  });
}
