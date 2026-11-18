import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BASE_PACK } from '../migrations/1834000000000-Bunker';
import { cardProblem, normalCard } from './cards';
import { CreateCardDto } from './dto';
import { CARD_KINDS, CardKind, MAX_PLAYERS, cardsNeeded } from './kinds';
import type { Effect, PersonalKind } from './kinds';

/** The built-in pack (migration Bunker) keeps every rule a card made in the app keeps. */
describe('Базовий пак (міграція Bunker)', () => {
  const cards = BASE_PACK.cards.map((c) =>
    normalCard({
      kind: c.kind as CardKind,
      title: 'title' in c ? c.title : '',
      text: c.text,
      effect: 'effect' in c ? (c.effect as Effect) : null,
      effectKind:
        'effectKind' in c
          ? ((c.effectKind ?? null) as PersonalKind | null)
          : null,
    }),
  );

  it.each(cards.map((c) => [c.text, c] as const))(
    '«%s» проходить перевірки',
    (_t, c) => {
      expect(validateSync(plainToInstance(CreateCardDto, c))).toEqual([]);
      expect(cardProblem(c)).toBeNull();
    },
  );

  it.each(CARD_KINDS)(
    '«%s»: вистачає на 16 гравців і ще на «Нову карту»',
    (kind) => {
      const n = cards.filter((c) => c.kind === kind).length;
      const spare = ['catastrophe', 'bunker', 'threat', 'special'].includes(
        kind,
      )
        ? 0
        : 1;
      expect(n).toBeGreaterThanOrEqual(cardsNeeded(kind, MAX_PLAYERS) + spare);
    },
  );

  it('тексти в межах виду не повторюються', () => {
    const keys = cards.map((c) => `${c.kind}|${c.text}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
