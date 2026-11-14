import type { PaletteColor } from '../api/types';

/**
 * Colours of dictionary items (docs/design/tokens.json, "palette").
 * Values live in tokens.css; an element gets them with the class pal-<name>.
 */
export const PALETTE: { name: PaletteColor; label: string }[] = [
  { name: 'gray', label: 'Сірий' },
  { name: 'red', label: 'Червоний' },
  { name: 'orange', label: 'Помаранчевий' },
  { name: 'yellow', label: 'Жовтий' },
  { name: 'green', label: 'Зелений' },
  { name: 'teal', label: 'Бірюзовий' },
  { name: 'blue', label: 'Синій' },
  { name: 'purple', label: 'Фіолетовий' },
];
