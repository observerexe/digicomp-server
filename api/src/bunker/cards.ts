import type { CardSnap } from './engine';
import {
  CardKind,
  EFFECTS_WITH_KIND,
  Effect,
  PersonalKind,
  TITLED_KINDS,
  textMax,
} from './kinds';

export type CardFields = {
  kind: CardKind;
  title: string;
  text: string;
  effect: Effect | null;
  effectKind: PersonalKind | null;
};

/**
 * What a card of its kind may hold: a title — catastrophe and threat only;
 * an effect — special cards only, with a kind exactly when the effect acts
 * on one. Returns the name of the wrong field, or null.
 */
export function cardProblem(c: CardFields): keyof CardFields | null {
  const text = c.text.trim();
  if (!text || text.length > textMax(c.kind)) return 'text';
  const titled = TITLED_KINDS.includes(c.kind);
  if (titled !== c.title.trim().length > 0) return 'title';
  if ((c.kind === 'special') !== (c.effect !== null)) return 'effect';
  const needsKind = c.effect !== null && EFFECTS_WITH_KIND.includes(c.effect);
  if (needsKind !== (c.effectKind !== null)) return 'effectKind';
  return null;
}

/** Fields as stored: trimmed, no title or effect where the kind has none. */
export function normalCard(c: {
  kind: CardKind;
  title?: string | null;
  text: string;
  effect?: Effect | null;
  effectKind?: PersonalKind | null;
}): CardFields {
  return {
    kind: c.kind,
    title: TITLED_KINDS.includes(c.kind) ? (c.title ?? '').trim() : '',
    text: c.text.trim(),
    effect: c.kind === 'special' ? (c.effect ?? null) : null,
    effectKind:
      c.kind === 'special' && c.effect && EFFECTS_WITH_KIND.includes(c.effect)
        ? (c.effectKind ?? null)
        : null,
  };
}

export function snapshot(c: CardFields & { id: string }): CardSnap {
  return {
    id: c.id,
    kind: c.kind,
    title: c.title,
    text: c.text,
    effect: c.effect,
    effectKind: c.effectKind,
  };
}
