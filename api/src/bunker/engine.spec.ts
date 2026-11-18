import {
  CardSnap,
  E,
  GameAction,
  GameState,
  Rng,
  alive,
  apply,
  capacityFor,
  createGame,
  removePlayer,
  scheduleFor,
  tick,
} from './engine';
import { CardKind, Effect, PERSONAL_KINDS, PersonalKind } from './kinds';
import { viewFor } from './view';

// Правила «Бункера» (docs/tech/ARCHITECTURE.md, «Розваги») — кожне окремим тестом.

const T0 = new Date('2026-11-18T12:00:00Z');
const later = (s: number) => new Date(T0.getTime() + s * 1000);

/** Repeatable chance: a small LCG. */
function seeded(seed = 1): Rng {
  let x = seed;
  return (n) => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x % n;
  };
}

let nextId = 0;
function card(
  kind: CardKind,
  effect: Effect | null = null,
  effectKind: PersonalKind | null = null,
): CardSnap {
  nextId += 1;
  return {
    id: `c${nextId}`,
    kind,
    title: kind === 'catastrophe' || kind === 'threat' ? `T${nextId}` : '',
    text: `${kind} ${nextId}`,
    effect,
    effectKind,
  };
}

/** A pool for `n` players and a spare card of each personal kind. */
function pool(
  n: number,
  special: () => CardSnap = () => card('special', 'none'),
) {
  const p: Partial<Record<CardKind, CardSnap[]>> = {
    catastrophe: [card('catastrophe')],
    bunker: Array.from({ length: 5 }, () => card('bunker')),
    threat: [card('threat')],
    special: Array.from({ length: n }, special),
  };
  for (const k of PERSONAL_KINDS)
    p[k] = Array.from({ length: n + 1 }, () => card(k));
  return p;
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `u${i + 1}`);

function game(
  n: number,
  opts: { turnSeconds?: number | null; special?: () => CardSnap } = {},
) {
  return createGame(
    {
      players: ids(n),
      pool: pool(n, opts.special),
      turnSeconds: opts.turnSeconds ?? null,
    },
    T0,
    seeded(),
  );
}

const HOST = { userId: 'host', isHost: true };
const as = (userId: string) => ({ userId, isHost: false });
const act = (
  s: GameState,
  who: { userId: string; isHost: boolean },
  a: GameAction,
) => apply(s, who, a, T0, seeded(7));

function speaker(s: GameState) {
  return s.turn!.userId;
}

/** The speaker reveals the first closed card and ends the turn. */
function playTurn(s: GameState) {
  const id = speaker(s);
  const p = s.players.find((x) => x.userId === id)!;
  const kind = PERSONAL_KINDS.find((k) => !p.revealed.includes(k))!;
  act(s, as(id), { type: 'reveal', kind });
  act(s, as(id), { type: 'end_turn' });
}

function playTurns(s: GameState) {
  while (s.phase === 'turns') playTurn(s);
}

/** Everyone votes for `target` (target itself — for the first other one). */
function voteOut(s: GameState, target: string) {
  for (const p of alive(s)) {
    if (s.phase !== 'voting') return;
    const to =
      p.userId === target
        ? s.vote!.candidates.find((c) => c !== target)!
        : target;
    act(s, as(p.userId), { type: 'vote', targetId: to });
  }
}

/** Plays rounds until the game ends, voting out the first candidate each time. */
function playToEnd(s: GameState) {
  for (let guard = 0; guard < 100 && s.phase !== 'finished'; guard++) {
    if (s.phase === 'turns') playTurns(s);
    else if (s.phase === 'discussion') {
      if (s.schedule[s.round - 1] > 0) act(s, HOST, { type: 'start_vote' });
      else act(s, HOST, { type: 'next_round' });
    } else if (s.phase === 'voting') voteOut(s, s.vote!.candidates[0]);
  }
}

describe('Скільки місць і хто коли вибуває', () => {
  it.each([
    [4, 2, [0, 0, 0, 1, 1]],
    [5, 2, [0, 0, 1, 1, 1]],
    [6, 3, [0, 0, 1, 1, 1]],
    [8, 4, [0, 1, 1, 1, 1]],
    [12, 6, [0, 1, 1, 2, 2]],
    [16, 8, [0, 2, 2, 2, 2]],
  ])('%i гравців: %i місць, вибувають %j', (n, cap, schedule) => {
    expect(capacityFor(n)).toBe(cap);
    expect(scheduleFor(n)).toEqual(schedule);
    expect(schedule.reduce((a, b) => a + b, 0)).toBe(n - cap);
  });
});

describe('Роздача', () => {
  it('кожен отримує по карті кожного виду й особливу умову, усі різні', () => {
    const s = game(6);
    const all = s.players.flatMap((p) =>
      [...Object.values(p.cards), p.special].map((c) => c.id),
    );
    expect(new Set(all).size).toBe(6 * 9);
    expect(s.bunker).toHaveLength(5);
    expect(s.capacity).toBe(3);
    expect(s.round).toBe(1);
    expect(s.phase).toBe('turns');
  });

  it('карт якогось виду бракує — гра не починається', () => {
    const p = pool(5);
    p.phobia = p.phobia!.slice(0, 4);
    expect(() =>
      createGame({ players: ids(5), pool: p, turnSeconds: null }, T0, seeded()),
    ).toThrow(E.NotEnoughCards);
  });

  it('у першому раунді професія відкривається сама, далі гравець відкриває ще одну', () => {
    const s = game(4);
    const p = s.players.find((x) => x.userId === speaker(s))!;
    expect(p.revealed).toEqual(['profession']);
    act(s, as(p.userId), { type: 'reveal', kind: 'hobby' });
    expect(p.revealed).toEqual(['profession', 'hobby']);
  });
});

describe('Хід', () => {
  it('відкривати можна лише у свій хід, одну карту, ще закриту', () => {
    const s = game(4);
    const id = speaker(s);
    const other = s.queue[1];
    expect(() => act(s, as(other), { type: 'reveal', kind: 'health' })).toThrow(
      E.NotYourTurn,
    );
    expect(() =>
      act(s, as(id), { type: 'reveal', kind: 'profession' }),
    ).toThrow(E.Revealed);
    act(s, as(id), { type: 'reveal', kind: 'health' });
    expect(() => act(s, as(id), { type: 'reveal', kind: 'fact' })).toThrow(
      E.OneCard,
    );
  });

  it('завершити хід — лише відкривши карту; далі говорить наступний', () => {
    const s = game(4);
    const [a, b] = s.queue;
    expect(() => act(s, as(a), { type: 'end_turn' })).toThrow(E.RevealFirst);
    act(s, as(a), { type: 'reveal', kind: 'health' });
    act(s, as(a), { type: 'end_turn' });
    expect(speaker(s)).toBe(b);
  });

  it('усі сказали — обговорення; у першому раунді голосування немає', () => {
    const s = game(4);
    playTurns(s);
    expect(s.phase).toBe('discussion');
    expect(() => act(s, HOST, { type: 'start_vote' })).toThrow(E.Phase);
    act(s, HOST, { type: 'next_round' });
    expect(s.round).toBe(2);
    expect(s.phase).toBe('turns');
  });

  it('наступний раунд починає наступний за місцем гравець', () => {
    const s = game(4);
    const first = speaker(s);
    playTurns(s);
    act(s, HOST, { type: 'next_round' });
    expect(speaker(s)).not.toBe(first);
    expect(s.queue).toHaveLength(4);
  });

  it('керувати ходом і раундами може лише ведучий', () => {
    const s = game(4);
    expect(() => act(s, as('u1'), { type: 'skip_turn' })).toThrow(E.NotHost);
    playTurns(s);
    expect(() => act(s, as('u1'), { type: 'next_round' })).toThrow(E.NotHost);
  });

  it('ведучий пропускає хід: випадкова закрита карта відкривається сама', () => {
    const s = game(4);
    const id = speaker(s);
    act(s, HOST, { type: 'skip_turn' });
    expect(s.players.find((p) => p.userId === id)!.revealed).toHaveLength(2);
    expect(speaker(s)).not.toBe(id);
  });

  it('час ходу вийшов — те саме, що пропуск', () => {
    const s = game(4, { turnSeconds: 60 });
    const id = speaker(s);
    expect(tick(s, later(59), seeded())).toBe(false);
    expect(tick(s, later(61), seeded())).toBe(true);
    expect(s.players.find((p) => p.userId === id)!.revealed).toHaveLength(2);
    expect(s.log.some((e) => e.type === 'timeout' && e.userId === id)).toBe(
      true,
    );
    expect(speaker(s)).not.toBe(id);
  });

  it('гравець, що відкрив карту й не встиг завершити, не відкриває другу', () => {
    const s = game(4, { turnSeconds: 30 });
    const id = speaker(s);
    act(s, as(id), { type: 'reveal', kind: 'fact' });
    tick(s, later(31), seeded());
    expect(s.players.find((p) => p.userId === id)!.revealed).toEqual([
      'profession',
      'fact',
    ]);
  });
});

/** A game of 8 in round 2, voting started. */
function voting8() {
  const s = game(8);
  playTurns(s);
  act(s, HOST, { type: 'next_round' });
  playTurns(s);
  act(s, HOST, { type: 'start_vote' });
  return s;
}

describe('Голосування', () => {
  it('за себе голосувати не можна', () => {
    const s = voting8();
    expect(() => act(s, as('u1'), { type: 'vote', targetId: 'u1' })).toThrow(
      E.BadTarget,
    );
  });

  it('проголосували всі — хто набрав найбільше, вибуває; далі наступний раунд', () => {
    const s = voting8();
    voteOut(s, 'u3');
    expect(s.players.find((p) => p.userId === 'u3')!.out).toBe(2);
    expect(s.round).toBe(3);
    expect(s.phase).toBe('turns');
    expect(
      s.log
        .find((e) => e.type === 'out')!
        .tally!.find((t) => t.userId === 'u3')!.votes,
    ).toBe(7);
  });

  it('голос можна змінити, доки голосування триває', () => {
    const s = voting8();
    act(s, as('u1'), { type: 'vote', targetId: 'u2' });
    act(s, as('u1'), { type: 'vote', targetId: 'u4' });
    expect(s.vote!.ballots.u1).toBe('u4');
  });

  it('ведучий закриває голосування: хто не голосував, утримався', () => {
    const s = voting8();
    act(s, as('u1'), { type: 'vote', targetId: 'u2' });
    act(s, HOST, { type: 'close_vote' });
    expect(s.players.find((p) => p.userId === 'u2')!.out).toBe(2);
  });

  it('нічия — переголосування між рівними; знову нічия — жереб', () => {
    const s = voting8();
    act(s, as('u1'), { type: 'vote', targetId: 'u2' });
    act(s, as('u3'), { type: 'vote', targetId: 'u4' });
    act(s, HOST, { type: 'close_vote' });
    expect(s.vote!.runoff).toBe(true);
    expect(s.vote!.candidates.sort()).toEqual(['u2', 'u4']);
    expect(() => act(s, as('u1'), { type: 'vote', targetId: 'u3' })).toThrow(
      E.BadTarget,
    );
    act(s, HOST, { type: 'close_vote' });
    const out = s.players.filter((p) => p.out !== null).map((p) => p.userId);
    expect(out).toHaveLength(1);
    expect(['u2', 'u4']).toContain(out[0]);
    expect(s.log.some((e) => e.type === 'lot')).toBe(true);
  });

  it('двоє за раунд — два голосування поспіль', () => {
    const s = game(12);
    playTurns(s);
    act(s, HOST, { type: 'next_round' });
    for (const r of [2, 3]) {
      playTurns(s);
      act(s, HOST, { type: 'start_vote' });
      voteOut(s, s.vote!.candidates[0]);
      expect(s.round).toBe(r + 1);
    }
    playTurns(s);
    act(s, HOST, { type: 'start_vote' });
    voteOut(s, s.vote!.candidates[0]);
    expect(s.round).toBe(4);
    expect(s.phase).toBe('voting');
    voteOut(s, s.vote!.candidates[0]);
    expect(s.round).toBe(5);
  });

  it('до наступного раунду — лише коли всіх, кого треба, вигнали', () => {
    const s = game(8);
    playTurns(s);
    act(s, HOST, { type: 'next_round' });
    playTurns(s);
    expect(() => act(s, HOST, { type: 'next_round' })).toThrow(E.VotePending);
  });

  it('вибулий не ходить і не голосує', () => {
    const s = voting8();
    voteOut(s, 'u3');
    expect(() => act(s, as('u3'), { type: 'end_turn' })).toThrow(E.Eliminated);
  });
});

describe('Фінал', () => {
  it.each([4, 5, 7, 8, 12, 16])(
    '%i гравців: після п’ятого раунду в бункері рівно стільки, скільки місць',
    (n) => {
      const s = game(n);
      playToEnd(s);
      expect(s.phase).toBe('finished');
      expect(s.round).toBe(5);
      expect(alive(s)).toHaveLength(capacityFor(n));
      expect(() =>
        act(s, as(alive(s)[0].userId), { type: 'end_turn' }),
      ).toThrow(E.Phase);
    },
  );

  it('у фіналі відкрито все: карти, умови, бункер, загрозу', () => {
    const s = game(4);
    playToEnd(s);
    const v = viewFor(s, 'u1');
    expect(v.threat).not.toBeNull();
    expect(v.bunker.every((b) => b.text)).toBe(true);
    expect(
      v.players.every((p) => p.special && p.cards.every((c) => c.text)),
    ).toBe(true);
  });
});

describe('Що бачить гравець', () => {
  it('свої карти — усі, чужі — лише відкриті; голоси — лише хто проголосував', () => {
    const s = voting8();
    act(s, as('u1'), { type: 'vote', targetId: 'u2' });
    const v = viewFor(s, 'u3');
    const own = s.players.find((p) => p.userId === 'u3')!;
    expect(v.me!.cards.map((c) => c.text)).toEqual(
      PERSONAL_KINDS.map((k) => own.cards[k].text),
    );
    for (const p of v.players) {
      const real = s.players.find((x) => x.userId === p.userId)!;
      for (const c of p.cards)
        expect(c.text).toBe(
          real.revealed.includes(c.kind) ? real.cards[c.kind].text : null,
        );
      expect(p.special).toBeNull();
    }
    expect(v.vote!.voted).toEqual(['u1']);
    expect(v.vote!.myVote).toBeNull();
    expect(JSON.stringify(v)).not.toContain('"ballots"');
    expect(v.threat).toBeNull();
    expect(v.bunker.filter((b) => b.text)).toHaveLength(2);
  });

  it('ведучий, що не грає, не бачить жодної закритої карти', () => {
    const s = game(4);
    const v = viewFor(s, 'host');
    expect(v.me).toBeNull();
    const closed = v.players
      .flatMap((p) => p.cards)
      .filter((c) => c.text === null);
    expect(closed.length).toBeGreaterThan(20);
  });
});

/** A game where everyone's special card has `effect`. */
function withSpecial(
  n: number,
  effect: Effect,
  kind: PersonalKind | null = null,
) {
  return game(n, { special: () => card('special', effect, kind) });
}

describe('Особливі умови', () => {
  it('раз за гру', () => {
    const s = withSpecial(4, 'none');
    act(s, as('u1'), { type: 'special' });
    expect(() => act(s, as('u1'), { type: 'special' })).toThrow(E.SpecialUsed);
    expect(
      viewFor(s, 'u2').players.find((p) => p.userId === 'u1')!.special!.effect,
    ).toBe('none');
  });

  it('обмін: карти виду міняються й обидві відкриті', () => {
    const s = withSpecial(4, 'swap', 'health');
    const [a, b] = [s.players[0], s.players[1]];
    const [ha, hb] = [a.cards.health.id, b.cards.health.id];
    expect(() =>
      act(s, as(a.userId), { type: 'special', targetId: a.userId }),
    ).toThrow(E.BadTarget);
    act(s, as(a.userId), { type: 'special', targetId: b.userId });
    expect([a.cards.health.id, b.cards.health.id]).toEqual([hb, ha]);
    expect(a.revealed).toContain('health');
    expect(b.revealed).toContain('health');
  });

  it('нова карта: з колоди, відкрита лишається відкритою', () => {
    const s = withSpecial(4, 'replace', 'profession');
    const p = s.players[0];
    const old = p.cards.profession.id;
    const wasOpen = p.revealed.includes('profession');
    act(s, as(p.userId), { type: 'special' });
    expect(p.cards.profession.id).not.toBe(old);
    expect(p.revealed.includes('profession')).toBe(wasOpen);
    expect(s.deck.profession).toHaveLength(0);
  });

  it('нова карта: колода порожня — відмова', () => {
    const s = withSpecial(4, 'replace', 'fact');
    s.deck.fact = [];
    expect(() => act(s, as('u1'), { type: 'special' })).toThrow(E.DeckEmpty);
  });

  it('відкрити чужу карту', () => {
    const s = withSpecial(4, 'reveal_other', 'phobia');
    act(s, as('u1'), { type: 'special', targetId: 'u2' });
    expect(s.players.find((p) => p.userId === 'u2')!.revealed).toContain(
      'phobia',
    );
    expect(
      viewFor(s, 'u3')
        .players.find((p) => p.userId === 'u2')!
        .cards.find((c) => c.kind === 'phobia')!.text,
    ).not.toBeNull();
  });

  it('подвійний голос — лише під час голосування й рахується двічі', () => {
    const s = game(8, { special: () => card('special', 'double_vote') });
    expect(() => act(s, as('u1'), { type: 'special' })).toThrow(E.Phase);
    playTurns(s);
    act(s, HOST, { type: 'next_round' });
    playTurns(s);
    act(s, HOST, { type: 'start_vote' });
    act(s, as('u1'), { type: 'special' });
    act(s, as('u1'), { type: 'vote', targetId: 'u2' });
    act(s, as('u3'), { type: 'vote', targetId: 'u4' });
    act(s, HOST, { type: 'close_vote' });
    expect(s.players.find((p) => p.userId === 'u2')!.out).toBe(2);
  });

  it('імунітет: проти гравця цього раунду не голосують', () => {
    const s = game(8, { special: () => card('special', 'immunity') });
    playTurns(s);
    act(s, HOST, { type: 'next_round' });
    act(s, as('u2'), { type: 'special' });
    playTurns(s);
    act(s, HOST, { type: 'start_vote' });
    expect(s.vote!.candidates).not.toContain('u2');
    expect(() => act(s, as('u1'), { type: 'vote', targetId: 'u2' })).toThrow(
      E.BadTarget,
    );
  });

  it('скасувати голосування: вибулий переноситься на наступний раунд', () => {
    const s = game(8, { special: () => card('special', 'cancel_vote') });
    playTurns(s);
    act(s, HOST, { type: 'next_round' });
    playTurns(s);
    act(s, HOST, { type: 'start_vote' });
    act(s, as('u1'), { type: 'special' });
    expect(s.round).toBe(3);
    expect(s.schedule[2]).toBe(2);
    expect(alive(s)).toHaveLength(8);
  });

  it('скасувати голосування в останньому раунді не можна', () => {
    const s = game(4, { special: () => card('special', 'cancel_vote') });
    for (let r = 1; r < 4; r++) {
      playTurns(s);
      act(s, HOST, { type: 'next_round' });
    }
    playTurns(s);
    act(s, HOST, { type: 'start_vote' });
    voteOut(s, s.vote!.candidates[0]);
    expect(s.round).toBe(5);
    playTurns(s);
    act(s, HOST, { type: 'start_vote' });
    expect(() => act(s, as(alive(s)[0].userId), { type: 'special' })).toThrow(
      E.Phase,
    );
  });
});

describe('Гравець вийшов', () => {
  it('вийшов той, хто говорить, — говорить наступний', () => {
    const s = game(6);
    const [a, b] = s.queue;
    removePlayer(s, a, 'left', T0);
    expect(speaker(s)).toBe(b);
    expect(s.players.find((p) => p.userId === a)!.out).toBe(1);
  });

  it('вибулих стає менше: решта розподіляється на раунди, що лишилися', () => {
    const s = game(8);
    removePlayer(s, 'u5', 'left', T0);
    expect(s.schedule.reduce((a, b) => a + b, 0)).toBe(3);
    playToEnd(s);
    expect(alive(s)).toHaveLength(4);
  });

  it('у грі лишилося стільки, скільки місць, — одразу фінал', () => {
    const s = game(4);
    removePlayer(s, 'u1', 'left', T0);
    expect(s.phase).toBe('turns');
    removePlayer(s, 'u2', 'removed', T0);
    expect(s.phase).toBe('finished');
  });

  it('під час голосування вийшов той, кого мали вигнати цього раунду, — голосування знято', () => {
    const s = voting8();
    act(s, as('u1'), { type: 'vote', targetId: 'u2' });
    removePlayer(s, 'u7', 'left', T0);
    expect(s.phase).toBe('discussion');
    expect(s.vote).toBeNull();
    act(s, HOST, { type: 'next_round' });
    expect(s.round).toBe(3);
  });

  it('під час голосування, коли вигнати треба ще когось, — голосування починається заново', () => {
    const s = game(16);
    playTurns(s);
    act(s, HOST, { type: 'next_round' });
    playTurns(s);
    act(s, HOST, { type: 'start_vote' });
    act(s, as('u1'), { type: 'vote', targetId: 'u2' });
    removePlayer(s, 'u7', 'left', T0);
    expect(s.phase).toBe('voting');
    expect(s.vote!.ballots).toEqual({});
    expect(s.vote!.candidates).not.toContain('u7');
  });
});
