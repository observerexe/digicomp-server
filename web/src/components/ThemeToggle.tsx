import { applyTheme, useTheme } from '../theme/theme';
import { Icon } from './Icon';

/** ☀ / ☾: the light theme ↔ the dark one at a click («Як у системі» — in «Ще» and «Про застосунок»). */
export function ThemeToggle({ className }: { className?: string }) {
  const { dark } = useTheme();
  const label = dark ? 'Увімкнути світлу тему' : 'Увімкнути темну тему';
  return (
    <button type="button" className={className} aria-label={label} title={label} onClick={() => applyTheme(dark ? 'light' : 'dark')}>
      <Icon name={dark ? 'sun' : 'moon'} />
    </button>
  );
}
