/**
 * The cards of «Бункер» and the numbers the rules are built on
 * (docs/tech/ARCHITECTURE.md, «Розваги»). Texts of the cards live in the
 * database; the game knows only their kinds and the effects of special cards.
 */

/** A character's cards: one of each, closed until the player reveals it. */
export const PERSONAL_KINDS = [
  'profession',
  'biology',
  'health',
  'hobby',
  'phobia',
  'character',
  'baggage',
  'fact',
] as const;
export type PersonalKind = (typeof PERSONAL_KINDS)[number];

/** On the table: what happened, the bunker's features, the threat inside. */
export const TABLE_KINDS = ['catastrophe', 'bunker', 'threat'] as const;

export const CARD_KINDS = [
  ...TABLE_KINDS,
  ...PERSONAL_KINDS,
  'special',
] as const;
export type CardKind = (typeof CARD_KINDS)[number];

/** Cards with a title above the text. */
export const TITLED_KINDS: readonly CardKind[] = ['catastrophe', 'threat'];

/**
 * What a special card does when used (once a game). `none` is shown to all
 * and the players agree aloud; the rest the server carries out.
 */
export const EFFECTS = [
  'none',
  'swap',
  'replace',
  'reveal_other',
  'double_vote',
  'immunity',
  'cancel_vote',
] as const;
export type Effect = (typeof EFFECTS)[number];

/** Effects that name a kind of personal card (`effectKind`). */
export const EFFECTS_WITH_KIND: readonly Effect[] = [
  'swap',
  'replace',
  'reveal_other',
];

/** Effects that need another player (`targetId`). */
export const EFFECTS_WITH_TARGET: readonly Effect[] = ['swap', 'reveal_other'];

export const TITLE_MAX = 60;
/** Personal, bunker and special cards: one line on a phone. */
export const TEXT_MAX = 140;
/** Catastrophe and threat: a short paragraph. */
export const LONG_TEXT_MAX = 400;

export function textMax(kind: CardKind) {
  return TITLED_KINDS.includes(kind) ? LONG_TEXT_MAX : TEXT_MAX;
}

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 16;
export const ROUNDS = 5;
/** One feature of the bunker opens each round. */
export const BUNKER_FEATURES = ROUNDS;
/** How long to stay in the bunker, months: one is drawn per game. */
export const STAY_MONTHS = [6, 12, 24, 36, 60];
/** Seconds a player has for a turn (null — no timer). */
export const TURN_SECONDS = [30, 60, 120] as const;

/** How many cards of each kind a game of `players` takes. */
export function cardsNeeded(kind: CardKind, players: number): number {
  if (kind === 'catastrophe' || kind === 'threat') return 1;
  if (kind === 'bunker') return BUNKER_FEATURES;
  return players;
}
