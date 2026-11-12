import type { components } from '../../api/schema';

type S = components['schemas'];
export type SmartState = S['SmartEntityStateDto'];
export type SmartKind = S['SmartKind'];
export type SmartAllowed = S['SmartAllowedDto'];
export type SmartDiscovered = S['SmartDiscoveredDto'];

export const KIND_LABEL: Record<SmartKind, string> = {
  light: 'Світло',
  scene: 'Сцена',
  sensor: 'Датчик',
  binary_sensor: 'Датчик «так/ні»',
};

export const NO_ROOM = 'Без кімнати';

/** Devices by room, in the order the API gives (room, then label). */
export function byRoom<T extends { room: string }>(items: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const e of items) {
    const room = e.room.trim() || NO_ROOM;
    groups.set(room, [...(groups.get(room) ?? []), e]);
  }
  return [...groups.entries()];
}

/** Text for an on/off sensor by its HA device class. */
const BINARY_TEXT: Record<string, [on: string, off: string]> = {
  motion: ['Є рух', 'Руху немає'],
  occupancy: ['Хтось є', 'Нікого'],
  presence: ['Хтось є', 'Нікого'],
  moisture: ['Протікання!', 'Сухо'],
  door: ['Відчинено', 'Зачинено'],
  window: ['Відчинено', 'Зачинено'],
  opening: ['Відчинено', 'Зачинено'],
  garage_door: ['Відчинено', 'Зачинено'],
  smoke: ['Дим!', 'Диму немає'],
  gas: ['Газ!', 'Газу немає'],
  carbon_monoxide: ['Чадний газ!', 'Норма'],
  problem: ['Проблема', 'Норма'],
  safety: ['Небезпека', 'Безпечно'],
  heat: ['Перегрів', 'Норма'],
  cold: ['Холодно', 'Норма'],
  battery: ['Батарея сідає', 'Батарея в нормі'],
  connectivity: ['На зв’язку', 'Без зв’язку'],
  plug: ['Під’єднано', 'Від’єднано'],
  power: ['Є живлення', 'Немає живлення'],
  running: ['Працює', 'Не працює'],
  light: ['Світло є', 'Темно'],
  sound: ['Є звук', 'Тихо'],
  vibration: ['Вібрація', 'Спокійно'],
  tamper: ['Втручання!', 'Норма'],
};

/** Classes where «on» means something is wrong: shown as a warning. */
const ALARM_CLASSES = new Set(['moisture', 'smoke', 'gas', 'carbon_monoxide', 'problem', 'safety', 'heat', 'tamper', 'battery']);

export function binaryText(e: Pick<SmartState, 'value' | 'deviceClass'>): string {
  const on = e.value === 'on';
  const pair = (e.deviceClass && BINARY_TEXT[e.deviceClass]) || ['Увімкнено', 'Вимкнено'];
  return on ? pair[0] : pair[1];
}

export function binaryAlarm(e: Pick<SmartState, 'value' | 'deviceClass'>): boolean {
  return e.value === 'on' && !!e.deviceClass && ALARM_CLASSES.has(e.deviceClass);
}

/** «21,5 °C»: numbers in the Ukrainian format, anything else as is. */
export function sensorText(e: Pick<SmartState, 'value' | 'unit'>): string {
  const raw = e.value ?? '';
  const n = Number(raw);
  const value = raw !== '' && Number.isFinite(n) ? n.toLocaleString('uk-UA', { maximumFractionDigits: 1 }) : raw;
  return e.unit ? `${value} ${e.unit}` : value;
}
