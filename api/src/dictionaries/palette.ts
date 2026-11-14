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
