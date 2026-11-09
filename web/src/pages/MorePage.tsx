import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { Card, PageHeader } from '../components/ui';
import { MORE, STAFF, visible } from '../layout/nav';
import { applyTheme, storedTheme, type ThemeChoice } from '../theme/theme';
import s from './MorePage.module.css';

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'Як у системі' },
  { value: 'light', label: 'Світла' },
  { value: 'dark', label: 'Темна' },
];

export function ThemeSwitch() {
  const [theme, setTheme] = useState<ThemeChoice>(storedTheme);
  return (
    <fieldset className={s.themes}>
      <legend className={s.legend}>Тема</legend>
      {THEMES.map((t) => (
        <label key={t.value} className={s.themeOption}>
          <input
            type="radio"
            name="theme"
            value={t.value}
            checked={theme === t.value}
            onChange={() => {
              applyTheme(t.value);
              setTheme(t.value);
            }}
          />
          {t.label}
        </label>
      ))}
    </fieldset>
  );
}

/** «Ще» on a phone: sections that are not in the bottom bar, theme, exit. */
export function MorePage() {
  const { can, logout } = useAuth();
  const links = [...MORE, ...visible(STAFF, can), { to: '/about', label: 'Про застосунок', icon: 'info' as const }];
  return (
    <>
      <PageHeader title="Ще" />
      <nav aria-label="Інші розділи" className={s.list}>
        {links.map((l) => (
          <Link key={l.to} to={l.to} className={s.row}>
            <Icon name={l.icon} size={22} />
            <span>{l.label}</span>
          </Link>
        ))}
      </nav>
      <Card>
        <ThemeSwitch />
      </Card>
      <div className={s.exit}>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void logout({ next: '/' })}
        >
          <Icon name="logout" size={20} />
          Вийти
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void logout({ everywhere: true, next: '/' })}
        >
          Вийти на всіх пристроях
        </button>
      </div>
    </>
  );
}
