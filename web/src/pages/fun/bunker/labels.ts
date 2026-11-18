import type { BunkerCardKind, BunkerEffect, BunkerGame, BunkerLog, BunkerPersonalKind, PaletteColor, UserRef } from '../../../api/types';

/** Personal cards in the order a character is shown. */
export const PERSONAL_KINDS: BunkerPersonalKind[] = ['profession', 'biology', 'health', 'hobby', 'phobia', 'character', 'baggage', 'fact'];

export const CARD_KINDS: BunkerCardKind[] = ['catastrophe', 'bunker', 'threat', ...PERSONAL_KINDS, 'special'];

export const KIND_LABEL: Record<BunkerCardKind, string> = {
  catastrophe: 'Катастрофа',
  bunker: 'Бункер',
  threat: 'Загроза',
  profession: 'Професія',
  biology: 'Біологія',
  health: 'Здоров’я',
  hobby: 'Хобі',
  phobia: 'Фобія',
  character: 'Характер',
  baggage: 'Багаж',
  fact: 'Факт',
  special: 'Особлива умова',
};

/** A kind of card is a dictionary item: its colour from the palette. */
export const KIND_COLOR: Record<BunkerCardKind, PaletteColor> = {
  catastrophe: 'red',
  bunker: 'gray',
  threat: 'yellow',
  profession: 'blue',
  biology: 'teal',
  health: 'red',
  hobby: 'green',
  phobia: 'purple',
  character: 'orange',
  baggage: 'yellow',
  fact: 'gray',
  special: 'blue',
};

export const TITLED: BunkerCardKind[] = ['catastrophe', 'threat'];

export const textMax = (kind: BunkerCardKind) => (TITLED.includes(kind) ? 400 : 140);

export const EFFECTS: BunkerEffect[] = ['none', 'swap', 'replace', 'reveal_other', 'double_vote', 'immunity', 'cancel_vote'];

export const EFFECT_LABEL: Record<BunkerEffect, string> = {
  none: 'Без автоматики: домовтеся вголос',
  swap: 'Обмін картою з гравцем',
  replace: 'Нова карта з колоди',
  reveal_other: 'Відкрити чужу карту',
  double_vote: 'Подвійний голос',
  immunity: 'Захист від голосів на раунд',
  cancel_vote: 'Скасувати голосування',
};

/** Effects that name a kind of personal card. */
export const EFFECTS_WITH_KIND: BunkerEffect[] = ['swap', 'replace', 'reveal_other'];
/** Effects that need another player. */
export const EFFECTS_WITH_TARGET: BunkerEffect[] = ['swap', 'reveal_other'];

/** Whether a special card can be used now (the server checks again). */
export function specialUsable(effect: BunkerEffect, g: BunkerGame): boolean {
  const p = g.phase;
  switch (effect) {
    case 'swap':
    case 'replace':
    case 'immunity':
      return p === 'turns' || p === 'discussion';
    case 'none':
    case 'reveal_other':
      return p === 'turns' || p === 'discussion' || p === 'voting';
    case 'double_vote':
      return p === 'voting';
    case 'cancel_vote':
      return p === 'voting' && g.round < 5;
  }
}

/** When a special card works, for its hint. */
export const EFFECT_WHEN: Record<BunkerEffect, string> = {
  none: 'будь-коли',
  swap: 'до голосування',
  replace: 'до голосування',
  reveal_other: 'будь-коли',
  double_vote: 'під час голосування',
  immunity: 'до голосування',
  cancel_vote: 'під час голосування, крім останнього раунду',
};

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export const votes = (n: number) => `${n} ${plural(n, 'голос', 'голоси', 'голосів')}`;
export const players = (n: number) => `${n} ${plural(n, 'гравець', 'гравці', 'гравців')}`;
export const places = (n: number) => `${n} ${plural(n, 'місце', 'місця', 'місць')}`;

/** How long to stay in the bunker. */
export function stayText(months: number) {
  if (months < 12) return 'пів року';
  const years = Math.round(months / 12);
  return years === 1 ? 'рік' : `${years} ${plural(years, 'рік', 'роки', 'років')}`;
}

export const timerText = (seconds: number | null) => (seconds === null ? 'без таймера' : seconds < 60 ? `хід ${seconds} с` : `хід ${seconds / 60} хв`);

/** One line of the game's chronicle. */
export function logText(e: BunkerLog, name: (id: string | undefined) => string): string {
  const who = name(e.userId);
  switch (e.type) {
    case 'round':
      return e.text ? `Раунд ${e.round}. Відкрито бункер: ${e.text}` : `Раунд ${e.round}`;
    case 'reveal':
      return `${who} відкриває «${KIND_LABEL[e.kind!]}»: ${e.text}`;
    case 'timeout':
      return `${who}: час ходу вийшов`;
    case 'skip':
      return `${who}: ведучий пропустив хід`;
    case 'vote':
      return 'Голосування почалося';
    case 'tie':
      return `Нічия: ${(e.tally ?? [])
        .filter((t) => t.votes === Math.max(...(e.tally ?? []).map((x) => x.votes)))
        .map((t) => name(t.userId))
        .join(', ')} — переголосування`;
    case 'out': {
      const t = e.tally?.find((x) => x.userId === e.userId);
      return `${who} вибуває${t ? ` — ${votes(t.votes)}` : ''}`;
    }
    case 'lot':
      return `${who} вибуває за жеребом`;
    case 'special':
      return `${who} використовує умову «${e.text}»${e.targetId ? ` → ${name(e.targetId)}` : ''}`;
    case 'left':
      return `${who} виходить із гри`;
    case 'removed':
      return `${who}: ведучий прибрав із гри`;
    case 'finished':
      return 'Бункер зачинено';
  }
}

/** Name of a user the room names; «Ви» for the reader. */
export function namer(users: UserRef[], meId: string | undefined) {
  return (id: string | undefined) => {
    if (!id) return '';
    if (id === meId) return 'Ви';
    return users.find((u) => u.id === id)?.name ?? 'Колишній учасник';
  };
}
