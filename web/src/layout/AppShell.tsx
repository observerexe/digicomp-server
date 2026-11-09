import { NavLink, Outlet, Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { OfflineBanner } from '../components/OfflineBanner';
import { SIDEBAR, STAFF, TABS, visible } from './nav';
import s from './AppShell.module.css';

/** Sidebar on a computer, bottom bar with the QR button on a phone. */
export function AppShell() {
  const { user, can } = useAuth();
  const staff = visible(STAFF, can);
  const initials = (user?.name ?? '')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className={s.shell}>
      <a href="#main" className={s.skip}>
        Перейти до вмісту
      </a>
      <aside className={s.sidebar}>
        <Link to="/" className={s.brand}>
          <img src="/icons/icon.svg" alt="" width={36} height={36} />
          <span>DigiComp HUB</span>
        </Link>
        <nav aria-label="Основна навігація" className={s.sideNav}>
          {SIDEBAR.map((i) => (
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
              </NavLink>
            ))}
          </nav>
        )}
        <Link to="/profile" className={s.me}>
          <span className={s.avatar} aria-hidden="true">
            {initials}
          </span>
          <span className={s.meText}>
            <span>{user?.name}</span>
            <span className={s.muted}>{roleLabel(user?.role)}</span>
          </span>
        </Link>
      </aside>

      <div className={s.content}>
        <header className={s.topbar}>
          <Link to="/" className={s.brandSmall}>
            <img src="/icons/icon.svg" alt="" width={28} height={28} />
            DigiComp HUB
          </Link>
          <NavLink to="/more" className={s.iconButton} aria-label="Ще">
            <Icon name="menu" />
          </NavLink>
        </header>
        <OfflineBanner />
        <main id="main" className={s.main} tabIndex={-1}>
          <Outlet />
        </main>
      </div>

      <nav aria-label="Основна навігація" className={s.tabbar}>
        {TABS.slice(0, 2).map((i) => (
          <NavLink key={i.to} to={i.to} end={i.to === '/'} className={s.tab}>
            <Icon name={i.icon} />
            {i.label}
          </NavLink>
        ))}
        <NavLink to="/scan" className={s.scan} aria-label="Сканувати QR">
          <Icon name="qr" size={28} />
        </NavLink>
        {TABS.slice(2).map((i) => (
          <NavLink key={i.to} to={i.to} className={s.tab}>
            <Icon name={i.icon} />
            {i.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function roleLabel(role: string | undefined) {
  return role === 'admin' ? 'Адміністратор' : role === 'moderator' ? 'Модератор' : 'Учасник';
}
