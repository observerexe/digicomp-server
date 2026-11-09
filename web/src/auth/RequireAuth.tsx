import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Skeleton } from '../components/ui';
import { useAuth } from './AuthProvider';

/** Logged-in area: unknown session → skeleton, none → /login?next=… */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, exit } = useAuth();
  const loc = useLocation();
  if (loading) {
    return (
      <div style={{ padding: 16, display: 'grid', gap: 12 }} aria-busy="true" aria-label="Завантаження">
        <Skeleton height={48} />
        <Skeleton />
        <Skeleton />
      </div>
    );
  }
  if (!user) {
    const next = encodeURIComponent(exit?.next ?? loc.pathname + loc.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}

/** Hides a screen the role cannot open (the API checks anyway). */
export function RequirePermission({ action, children, fallback }: { action: string; children: ReactNode; fallback: ReactNode }) {
  const { can } = useAuth();
  return <>{can(action) ? children : fallback}</>;
}
