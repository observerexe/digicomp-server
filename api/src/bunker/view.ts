import type { GameState, Player } from './engine';
import { PERSONAL_KINDS } from './kinds';
import type {
  BunkerGameDto,
  BunkerPlayerDto,
  BunkerSpecialDto,
} from './responses.dto';

/**
 * What `userId` sees of the game. The only way the state leaves the server:
 * closed cards of others, others' special cards and the ballots stay here.
 * At the end of the game everything is open.
 */
export function viewFor(s: GameState, userId: string): BunkerGameDto {
  const over = s.phase === 'finished';
  const special = (p: Player): BunkerSpecialDto => ({
    text: p.special.text,
    effect: p.special.effect ?? 'none',
    effectKind: p.special.effectKind,
  });
  const players: BunkerPlayerDto[] = s.players.map((p) => ({
    userId: p.userId,
    out: p.out,
    left: p.left,
    cards: PERSONAL_KINDS.map((kind) => ({
      kind,
      text: over || p.revealed.includes(kind) ? p.cards[kind].text : null,
    })),
    specialUsed: p.specialUsed,
    special: over || p.specialUsed ? special(p) : null,
  }));
  const mine = s.players.find((p) => p.userId === userId);
  const v = s.vote;
  return {
    round: s.round,
    phase: s.phase,
    capacity: s.capacity,
    schedule: [...s.schedule],
    stayMonths: s.stayMonths,
    catastrophe: { title: s.catastrophe.title, text: s.catastrophe.text },
    bunker: s.bunker.map((c, i) => ({
      text: over || i < s.round ? c.text : null,
      round: i + 1,
    })),
    threat: over ? { title: s.threat.title, text: s.threat.text } : null,
    players,
    me: mine
      ? {
          cards: PERSONAL_KINDS.map((kind) => ({
            kind,
            text: mine.cards[kind].text,
            revealed: mine.revealed.includes(kind),
          })),
          special: special(mine),
          specialUsed: mine.specialUsed,
        }
      : null,
    turn: s.turn
      ? {
          userId: s.turn.userId,
          revealed: s.turn.revealed > 0,
          deadline: s.turn.deadline,
        }
      : null,
    queue: [...s.queue],
    vote: v
      ? {
          candidates: [...v.candidates],
          voted: Object.keys(v.ballots),
          myVote: v.ballots[userId] ?? null,
          runoff: v.runoff,
          double: v.double.includes(userId),
        }
      : null,
    immune: [...s.immune],
    log: s.log.map((e) => ({ ...e })),
  };
}
