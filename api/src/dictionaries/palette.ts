/**
 * Colour names of dictionary items: the palette from docs/design/tokens.json
 * (the values live there; the front turns a name into .pal-<name>).
 * palette.spec.ts keeps this list in sync with tokens.json.
 */
export const PALETTE = [
  'gray',
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
] as const;

export type PaletteColor = (typeof PALETTE)[number];

/**
 * Colours an account gets in turn when it is made (gray — only by choice);
 * migration UserColors gave them out in the same order.
 */
export const ACCOUNT_COLORS = [
  'blue',
  'green',
  'orange',
  'purple',
  'teal',
  'red',
  'yellow',
] as const satisfies readonly PaletteColor[];

/** The colour of the account made `made`-th (from 0). */
export const accountColor = (made: number): PaletteColor =>
  ACCOUNT_COLORS[made % ACCOUNT_COLORS.length]!;
