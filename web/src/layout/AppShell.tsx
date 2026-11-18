import { NavLink, Outlet, Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import type { Role } from '../api/types';
import { Avatar } from '../components/Avatar';
import { tint } from '../lib/palette';
import { Icon } from '../components/Icon';
import { ThemeToggle } from '../components/ThemeToggle';
import { plural } from '../lib/format';
import { ROLE_LABEL } from '../lib/labels';
import { OfflineBanner } from '../components/OfflineBanner';
import { ActiveSessionBar } from '../pages/lab/ActiveSessionBar';
import { useReviewCount } from '../pages/panel/PanelPage';
import { GUEST, isGuest, SIDEBAR, STAFF, TABS, visible } from './nav';
import s from './AppShell.module.css';

/** Sidebar on a computer, bottom bar with the QR button on a phone. */
export function AppShell() {
  const { user, can } = useAuth();
  const staff = visible(STAFF, can);
  const review = useReviewCount(can('tasks.accept'));
  const guest = isGuest(user?.role);
  const side = guest ? GUEST : SIDEBAR;

  return (
    <div className={s.shell}>
      <a href="#main" className={s.skip}>
        Перейти до вмісту
      </a>
      <aside className={`${s.sidebar} no-print`}>
        <Link to="/" className={s.brand}>
          <img src="/icons/icon.svg" alt="" width={36} height={36} />
          <span>DigiComp HUB</span>
        </Link>
        <nav aria-label="Основна навігація" className={s.sideNav}>
          {side.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.to === '/'} className={s.sideLink}>
              <Icon name={i.icon} size={20} />
              {i.label}
            </NavLink>
          ))}
        </nav>
        {staff.length > 0 && (
          <nav aria-label="Керування" className={s.sideNav}>
            <span className={s.sideCaption}>Керування</span>
            {staff.map((i) => (
              <NavLink key={i.to} to={i.to} className={s.sideLink}>
                <Icon name={i.icon} size={20} />
                {i.label}
                {i.to === '/panel' && !!review.data && (
                  <span className={s.badge} aria-label={`${review.data} ${plural(review.data, ['технічне завдання', 'технічні завдання', 'технічних завдань'])} на перевірці`}>
                    {review.data}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>
        )}
        <div className={s.meRow}>
          <Link to="/profile" className={`${s.me} ${tint(user?.color)}`}>
            <Avatar name={user?.name ?? ''} url={user?.avatarUrl} color={user?.color} size={40} />
            <span className={s.meText}>
              <span>{user?.name}</span>
              <span className={s.muted}>{roleLabel(user?.role)}</span>
            </span>
          </Link>
          <ThemeToggle className={s.iconButton} />
        </div>
      </aside>

      <div className={s.content}>
        <header className={`${s.topbar} no-print`}>
          <Link to="/" className={s.brandSmall}>
            <img src="/icons/icon.svg" alt="" width={28} height={28} />
            DigiComp HUB
          </Link>
          <span className={s.topActions}>
            <ThemeToggle className={s.iconButton} />
            <NavLink to="/more" className={s.iconButton} aria-label="Ще">
              <Icon name="menu" />
            </NavLink>
          </span>
        </header>
        <div className="no-print">
          <OfflineBanner />
          {!guest && <ActiveSessionBar />}
        </div>
        <main id="main" className={s.main} tabIndex={-1}>
          <Outlet />
        </main>
      </div>

      {guest ? (
        <nav aria-label="Основна навігація" className={`${s.tabbar} no-print`}>
          {GUEST.map((i) => (
            <NavLink key={i.to} to={i.to} className={s.tab}>
              <Icon name={i.icon} />
              {i.short ?? i.label}
            </NavLink>
          ))}
        </nav>
      ) : (
      <nav aria-label="Основна навігація" className={`${s.tabbar} no-print`}>
        {TABS.slice(0, 2).map((i) => (
          <NavLink key={i.to} to={i.to} end={i.to === '/'} className={s.tab}>
            <Icon name={i.icon} />
            {i.short ?? i.label}
          </NavLink>
        ))}
        <NavLink to="/scan" className={s.scan} aria-label="Сканувати QR">
          <Icon name="qr" size={28} />
        </NavLink>
        {TABS.slice(2).map((i) => (
          <NavLink key={i.to} to={i.to} className={s.tab}>
            <Icon name={i.icon} />
            {i.short ?? i.label}
          </NavLink>
        ))}
      </nav>
      )}
    </div>
  );
}

export function roleLabel(role: string | undefined) {
  return ROLE_LABEL[(role ?? 'member') as Role] ?? ROLE_LABEL.member;
}
