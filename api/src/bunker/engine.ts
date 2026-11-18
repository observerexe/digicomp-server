/**
 * Rules of «Бункер» as pure functions: (state, who, action, time, chance) →
 * new state, or GameError. No database and no clock of its own, so every rule
 * has a unit test (engine.spec.ts). The service keeps the state in
 * `bunker_rooms.state`, locks the row for each action and sends each player
 * only what `viewFor` lets them see.
 */
import {
  CardKind,
  Effect,
  PERSONAL_KINDS,
  PersonalKind,
  ROUNDS,
  STAY_MONTHS,
  cardsNeeded,
} from './kinds';

/** A whole number in [0, n): crypto.randomInt in the service, seeded in tests. */
export type Rng = (n: number) => number;

/** A rule said no. The message is the API's (codes in http-exception.filter). */
export class GameError extends Error {
  constructor(
    message: string,
    /** Status: 403 for «not yours to do», 409 for «not now». */
    public status: 403 | 409 = 409,
  ) {
    super(message);
  }
}

export const E = {
  NotHost: 'Only the host can do this',
  NotPlayer: 'You are not playing in this game',
  Eliminated: 'Eliminated players cannot act',
  Phase: 'Not possible in this phase of the game',
  NotYourTurn: 'Not your turn',
  OneCard: 'Only one card per turn',
  Revealed: 'Card already revealed',
  RevealFirst: 'Reveal a card first',
  BadTarget: 'Cannot choose this player',
  SpecialUsed: 'Special condition already used',
  DeckEmpty: 'No cards left in the deck',
  VotePending: 'Players must be voted out first',
  NotEnoughCards: 'Not enough cards',
} as const;

/** A card as dealt: a copy, so editing a pack does not touch a running game. */
export type CardSnap = {
  id: string;
  kind: CardKind;
  title: string;
  text: string;
  effect: Effect | null;
  effectKind: PersonalKind | null;
};

export type Player = {
  userId: string;
  cards: Record<PersonalKind, CardSnap>;
  revealed: PersonalKind[];
  special: CardSnap;
  specialUsed: boolean;
  /** Round the player left the game in (voted out, left, removed). */
  out: number | null;
  left: boolean;
};

export type Phase = 'turns' | 'discussion' | 'voting' | 'finished';

export type Vote = {
  candidates: string[];
  /** voter → candidate. Secret until the vote is resolved. */
  ballots: Record<string, string>;
  /** Voters whose vote counts twice («Подвійний голос»). */
  double: string[];
  /** A re-vote between the tied players. */
  runoff: boolean;
};

export type LogType =
  | 'round'
  | 'reveal'
  | 'timeout'
  | 'skip'
  | 'vote'
  | 'tie'
  | 'out'
  | 'lot'
  | 'special'
  | 'left'
  | 'removed'
  | 'finished';

export type LogEntry = {
  at: string;
  type: LogType;
  round: number;
  userId?: string;
  targetId?: string;
  kind?: PersonalKind;
  /** A revealed card or a used special card: public from that moment. */
  text?: string;
  effect?: Effect;
  tally?: { userId: string; votes: number }[];
};

export type GameState = {
  round: number;
  phase: Phase;
  capacity: number;
  /** Eliminations left per round (index 0 — round 1). */
  schedule: number[];
  stayMonths: number;
  catastrophe: CardSnap;
  bunker: CardSnap[];
  threat: CardSnap;
  /** In seat order. */
  players: Player[];
  /** Who speaks this round and has not yet: the first one speaks now. */
  queue: string[];
  turn: { userId: string; revealed: number; deadline: string | null } | null;
  turnSeconds: number | null;
  vote: Vote | null;
  /** «Імунітет» for this round. */
  immune: string[];
  /** Cards not dealt: «Нова карта» draws from here. */
  deck: Partial<Record<PersonalKind, CardSnap[]>>;
  log: LogEntry[];
};

export type GameAction =
  | { type: 'reveal'; kind: PersonalKind }
  | { type: 'end_turn' }
  | { type: 'skip_turn' }
  | { type: 'start_vote' }
  | { type: 'vote'; targetId: string }
  | { type: 'close_vote' }
  | { type: 'next_round' }
  | { type: 'special'; targetId?: string };

export type Actor = { userId: string; isHost: boolean };

const LOG_MAX = 150;

/** Places in the bunker: half of the players, rounded down. */
export function capacityFor(players: number) {
  return Math.floor(players / 2);
}

/**
 * Eliminations per round: none in round 1, the rest over rounds 2–5 evenly,
 * the remainder to the last rounds (12 players → 0, 1, 1, 2, 2).
 */
export function scheduleFor(players: number): number[] {
  const out = Array.from({ length: ROUNDS }, () => 0);
  spread(out, players - capacityFor(players), 1);
  return out;
}

/** Puts `total` eliminations over rounds `from`..last (indexes), more at the end. */
function spread(schedule: number[], total: number, from: number) {
  const rounds = ROUNDS - from;
  const base = Math.floor(total / rounds);
  const rest = total % rounds;
  for (let i = from; i < ROUNDS; i++) {
    schedule[i] = base + (i >= ROUNDS - rest ? 1 : 0);
  }
}

export function shuffle<T>(list: readonly T[], rng: Rng): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The kind of cards a pool lacks for `players`, or null. */
export function missingKind(
  pool: Partial<Record<CardKind, CardSnap[]>>,
  players: number,
): CardKind | null {
  const kinds: CardKind[] = [
    'catastrophe',
    'bunker',
    'threat',
    ...PERSONAL_KINDS,
    'special',
  ];
  return (
    kinds.find((k) => (pool[k]?.length ?? 0) < cardsNeeded(k, players)) ?? null
  );
}

/** Deals the cards and starts round 1. `players` — user ids, any order. */
export function createGame(
  input: {
    players: string[];
    pool: Partial<Record<CardKind, CardSnap[]>>;
    turnSeconds: number | null;
  },
  now: Date,
  rng: Rng,
): GameState {
  const n = input.players.length;
  if (missingKind(input.pool, n)) throw new GameError(E.NotEnoughCards);
  const piles = Object.fromEntries(
    Object.entries(input.pool).map(([k, cards]) => [k, shuffle(cards, rng)]),
  ) as Partial<Record<CardKind, CardSnap[]>>;
  const draw = (k: CardKind) => piles[k]!.shift()!;
  const players: Player[] = shuffle(input.players, rng).map((userId) => ({
    userId,
    cards: Object.fromEntries(
      PERSONAL_KINDS.map((k) => [k, draw(k)]),
    ) as Record<PersonalKind, CardSnap>,
    revealed: [],
    special: draw('special'),
    specialUsed: false,
    out: null,
    left: false,
  }));
  const s: GameState = {
    round: 1,
    phase: 'turns',
    capacity: capacityFor(n),
    schedule: scheduleFor(n),
    stayMonths: STAY_MONTHS[rng(STAY_MONTHS.length)],
    catastrophe: draw('catastrophe'),
    bunker: Array.from({ length: cardsNeeded('bunker', n) }, () =>
      draw('bunker'),
    ),
    threat: draw('threat'),
    players,
    queue: [],
    turn: null,
    turnSeconds: input.turnSeconds,
    vote: null,
    immune: [],
    deck: Object.fromEntries(PERSONAL_KINDS.map((k) => [k, piles[k] ?? []])),
    log: [],
  };
  startRound(s, now);
  return s;
}

const iso = (d: Date) => d.toISOString();

function log(s: GameState, now: Date, e: Omit<LogEntry, 'at' | 'round'>) {
  s.log.push({ at: iso(now), round: s.round, ...e });
  if (s.log.length > LOG_MAX) s.log.splice(0, s.log.length - LOG_MAX);
}

export function alive(s: GameState): Player[] {
  return s.players.filter((p) => p.out === null);
}

function player(s: GameState, userId: string): Player | undefined {
  return s.players.find((p) => p.userId === userId);
}

/** A player still in the game who may act. */
function me(s: GameState, a: Actor): Player {
  const p = player(s, a.userId);
  if (!p) throw new GameError(E.NotPlayer, 403);
  if (p.out !== null) throw new GameError(E.Eliminated, 403);
  return p;
}

function host(a: Actor) {
  if (!a.isHost) throw new GameError(E.NotHost, 403);
}

function phase(s: GameState, ...allowed: Phase[]) {
  if (!allowed.includes(s.phase)) throw new GameError(E.Phase);
}

function reveal(s: GameState, p: Player, kind: PersonalKind, now: Date) {
  p.revealed.push(kind);
  log(s, now, {
    type: 'reveal',
    userId: p.userId,
    kind,
    text: p.cards[kind].text,
  });
}

function closedKinds(p: Player) {
  return PERSONAL_KINDS.filter((k) => !p.revealed.includes(k));
}

/** Speaking order: seat order, starting one seat further each round. */
function startRound(s: GameState, now: Date) {
  const live = alive(s).map((p) => p.userId);
  const shift = (s.round - 1) % Math.max(1, live.length);
  s.queue = [...live.slice(shift), ...live.slice(0, shift)];
  s.immune = [];
  s.vote = null;
  s.phase = 'turns';
  log(s, now, { type: 'round', text: s.bunker[s.round - 1]?.text });
  beginTurn(s, now);
}

/** The first in the queue speaks; all have spoken — discussion. */
function beginTurn(s: GameState, now: Date) {
  const userId = s.queue[0];
  if (!userId) {
    s.turn = null;
    s.phase = 'discussion';
    return;
  }
  s.turn = {
    userId,
    revealed: 0,
    deadline: s.turnSeconds
      ? iso(new Date(now.getTime() + s.turnSeconds * 1000))
      : null,
  };
  // Round 1: the profession opens by itself, the player picks one more.
  const p = player(s, userId)!;
  if (s.round === 1 && !p.revealed.includes('profession')) {
    reveal(s, p, 'profession', now);
  }
}

function endTurn(s: GameState, now: Date) {
  s.queue.shift();
  beginTurn(s, now);
}

/** Time is up or the host skips: a closed card opens at random. */
function forceTurn(
  s: GameState,
  now: Date,
  rng: Rng,
  type: 'timeout' | 'skip',
) {
  const t = s.turn!;
  const p = player(s, t.userId)!;
  log(s, now, { type, userId: p.userId });
  const closed = closedKinds(p);
  if (t.revealed < 1 && closed.length) {
    reveal(s, p, closed[rng(closed.length)], now);
  }
  endTurn(s, now);
}

function openVote(s: GameState, now: Date) {
  const live = alive(s).map((p) => p.userId);
  const open = live.filter((id) => !s.immune.includes(id));
  s.vote = {
    candidates: open.length >= 2 ? open : live,
    ballots: {},
    double: [],
    runoff: false,
  };
  s.phase = 'voting';
  log(s, now, { type: 'vote' });
}

function voters(s: GameState) {
  return alive(s).map((p) => p.userId);
}

/** Can `voter` vote for anyone at all (not only for themselves)? */
function canVote(v: Vote, voter: string) {
  return v.candidates.some((c) => c !== voter);
}

function allVoted(s: GameState) {
  const v = s.vote!;
  return voters(s).every(
    (id) => !canVote(v, id) || v.ballots[id] !== undefined,
  );
}

function tally(v: Vote) {
  const count = new Map<string, number>(v.candidates.map((c) => [c, 0]));
  for (const [voter, target] of Object.entries(v.ballots)) {
    if (!count.has(target)) continue;
    count.set(target, count.get(target)! + (v.double.includes(voter) ? 2 : 1));
  }
  return [...count].map(([userId, votes]) => ({ userId, votes }));
}

/** Most votes leaves; a tie — re-vote between the tied; a tie again — the lot. */
function resolveVote(s: GameState, now: Date, rng: Rng) {
  const v = s.vote!;
  const t = tally(v);
  const max = Math.max(...t.map((r) => r.votes));
  const top = t.filter((r) => r.votes === max).map((r) => r.userId);
  if (top.length === 1) return eliminate(s, top[0], now, rng, 'out', t);
  if (!v.runoff) {
    log(s, now, { type: 'tie', tally: t });
    s.vote = { candidates: top, ballots: {}, double: v.double, runoff: true };
    return;
  }
  eliminate(s, top[rng(top.length)], now, rng, 'lot', t);
}

function finish(s: GameState, now: Date) {
  s.phase = 'finished';
  s.turn = null;
  s.vote = null;
  s.queue = [];
  log(s, now, { type: 'finished' });
}

function eliminate(
  s: GameState,
  userId: string,
  now: Date,
  rng: Rng,
  type: 'out' | 'lot',
  t: { userId: string; votes: number }[],
) {
  player(s, userId)!.out = s.round;
  s.schedule[s.round - 1] = Math.max(0, s.schedule[s.round - 1] - 1);
  s.vote = null;
  log(s, now, { type, userId, tally: t });
  afterOut(s, now);
}

/** After someone leaves the game: the end, the next vote or the next round. */
function afterOut(s: GameState, now: Date) {
  if (alive(s).length <= s.capacity) return finish(s, now);
  if (s.schedule[s.round - 1] > 0) return openVote(s, now);
  nextRound(s, now);
}

function nextRound(s: GameState, now: Date) {
  if (s.round >= ROUNDS) return finish(s, now);
  s.round += 1;
  startRound(s, now);
}

/** A player action or a host action. Throws GameError when a rule says no. */
export function apply(
  s: GameState,
  a: Actor,
  action: GameAction,
  now: Date,
  rng: Rng,
): void {
  if (s.phase === 'finished') throw new GameError(E.Phase);
  switch (action.type) {
    case 'reveal': {
      const p = me(s, a);
      phase(s, 'turns');
      if (s.turn?.userId !== p.userId) throw new GameError(E.NotYourTurn);
      if (s.turn.revealed >= 1) throw new GameError(E.OneCard);
      if (p.revealed.includes(action.kind)) throw new GameError(E.Revealed);
      reveal(s, p, action.kind, now);
      s.turn.revealed += 1;
      return;
    }
    case 'end_turn': {
      const p = me(s, a);
      phase(s, 'turns');
      if (s.turn?.userId !== p.userId) throw new GameError(E.NotYourTurn);
      if (s.turn.revealed < 1 && closedKinds(p).length) {
        throw new GameError(E.RevealFirst);
      }
      return endTurn(s, now);
    }
    case 'skip_turn':
      host(a);
      phase(s, 'turns');
      return forceTurn(s, now, rng, 'skip');
    case 'start_vote':
      host(a);
      phase(s, 'discussion');
      if (s.schedule[s.round - 1] < 1) throw new GameError(E.Phase);
      return openVote(s, now);
    case 'vote': {
      const p = me(s, a);
      phase(s, 'voting');
      const v = s.vote!;
      if (
        action.targetId === p.userId ||
        !v.candidates.includes(action.targetId)
      ) {
        throw new GameError(E.BadTarget);
      }
      v.ballots[p.userId] = action.targetId;
      if (allVoted(s)) resolveVote(s, now, rng);
      return;
    }
    case 'close_vote':
      host(a);
      phase(s, 'voting');
      return resolveVote(s, now, rng);
    case 'next_round':
      host(a);
      phase(s, 'discussion');
      if (s.schedule[s.round - 1] > 0) throw new GameError(E.VotePending);
      return nextRound(s, now);
    case 'special':
      return useSpecial(s, me(s, a), action.targetId, now, rng);
  }
}

function useSpecial(
  s: GameState,
  p: Player,
  targetId: string | undefined,
  now: Date,
  rng: Rng,
) {
  if (p.specialUsed) throw new GameError(E.SpecialUsed);
  const card = p.special;
  const kind = card.effectKind;
  const target = () => {
    const t = targetId ? player(s, targetId) : undefined;
    if (!t || t.out !== null || t.userId === p.userId) {
      throw new GameError(E.BadTarget);
    }
    return t;
  };
  let targetUser: string | undefined;
  switch (card.effect ?? 'none') {
    case 'none':
      phase(s, 'turns', 'discussion', 'voting');
      break;
    case 'swap': {
      phase(s, 'turns', 'discussion');
      const t = target();
      targetUser = t.userId;
      [p.cards[kind!], t.cards[kind!]] = [t.cards[kind!], p.cards[kind!]];
      // Both cards are on the table after the swap.
      for (const x of [p, t]) {
        if (!x.revealed.includes(kind!)) x.revealed.push(kind!);
      }
      break;
    }
    case 'replace': {
      phase(s, 'turns', 'discussion');
      const pile = s.deck[kind!] ?? [];
      if (!pile.length) throw new GameError(E.DeckEmpty);
      p.cards[kind!] = pile.splice(rng(pile.length), 1)[0];
      break;
    }
    case 'reveal_other': {
      phase(s, 'turns', 'discussion', 'voting');
      const t = target();
      if (t.revealed.includes(kind!)) throw new GameError(E.Revealed);
      p.specialUsed = true;
      log(s, now, {
        type: 'special',
        userId: p.userId,
        targetId: t.userId,
        text: card.text,
        effect: 'reveal_other',
      });
      reveal(s, t, kind!, now);
      return;
    }
    case 'double_vote':
      phase(s, 'voting');
      s.vote!.double.push(p.userId);
      break;
    case 'immunity':
      phase(s, 'turns', 'discussion');
      s.immune.push(p.userId);
      break;
    case 'cancel_vote':
      phase(s, 'voting');
      // The elimination moves to the next round; the last round has none.
      if (s.round >= ROUNDS) throw new GameError(E.Phase);
      s.schedule[s.round - 1] -= 1;
      s.schedule[s.round] += 1;
      s.vote = null;
      s.phase = 'discussion';
      break;
  }
  p.specialUsed = true;
  log(s, now, {
    type: 'special',
    userId: p.userId,
    targetId: targetUser,
    text: card.text,
    effect: card.effect ?? 'none',
  });
  // A card on the table that was replaced: the new one is on the table too.
  if (card.effect === 'replace' && p.revealed.includes(kind!)) {
    log(s, now, {
      type: 'reveal',
      userId: p.userId,
      kind: kind!,
      text: p.cards[kind!].text,
    });
  }
  // The cancelled vote was the round's last: on to the next round.
  if (card.effect === 'cancel_vote' && s.schedule[s.round - 1] < 1) {
    nextRound(s, now);
  }
}

/** Applies a turn whose time is up. Returns whether anything changed. */
export function tick(s: GameState, now: Date, rng: Rng): boolean {
  if (s.phase !== 'turns' || !s.turn?.deadline) return false;
  if (now.getTime() < new Date(s.turn.deadline).getTime()) return false;
  forceTurn(s, now, rng, 'timeout');
  return true;
}

/**
 * A player leaves the game (left the room or the host removed them): out
 * this round; the eliminations left are spread again over the rounds left,
 * and a running vote starts over.
 */
export function removePlayer(
  s: GameState,
  userId: string,
  type: 'left' | 'removed',
  now: Date,
): void {
  const p = player(s, userId);
  if (!p || p.out !== null || s.phase === 'finished') return;
  p.out = s.round;
  p.left = true;
  log(s, now, { type, userId });
  s.queue = s.queue.filter((id) => id !== userId);
  s.immune = s.immune.filter((id) => id !== userId);
  if (alive(s).length <= s.capacity) return finish(s, now);
  spread(s.schedule, alive(s).length - s.capacity, Math.max(1, s.round - 1));
  if (s.turn?.userId === userId) beginTurn(s, now);
  if (s.phase === 'voting') {
    if (s.schedule[s.round - 1] > 0) openVote(s, now);
    else {
      s.vote = null;
      s.phase = 'discussion';
    }
  }
}
