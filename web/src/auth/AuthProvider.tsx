import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { api, ApiError, onLoggedOut, unwrap } from '../api/client';
import type { LoginResult, Me } from '../api/types';

export const ME_KEY = ['me'] as const;

/** Current user or null when not logged in. */
export async function fetchMe(): Promise<Me | null> {
  const r = await api.GET('/api/auth/me');
  if (r.response.status === 401) return null;
  if (!r.response.ok) {
    const body = (r.error ?? {}) as { errorCode?: string };
    throw new ApiError(r.response.status, body.errorCode ?? 'ERROR');
  }
  return r.data as unknown as Me;
}

type AuthValue = {
  user: Me | null;
  loading: boolean;
  /** Role layer only (permissions from /auth/me); the API checks the rest. */
  can: (action: string) => boolean;
  /** Returns a challenge token when the account has 2FA. */
  login: (email: string, password: string) => Promise<{ challengeToken: string } | null>;
  verifyTwoFactor: (challengeToken: string, proof: { code?: string; recoveryCode?: string }) => Promise<void>;
  logout: (everywhere?: boolean) => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe, retry: false, staleTime: 60_000 });

  /**
   * New session (or none): drop every cached answer of the previous user and
   * update the profile in place. The profile query itself is kept, because
   * this provider is subscribed to it.
   */
  const setUser = useCallback(
    (user: Me | null) => {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] });
      qc.setQueryData(ME_KEY, user);
    },
    [qc],
  );

  // A session that cannot be refreshed: show the login screen.
  useEffect(() => onLoggedOut(() => setUser(null)), [setUser]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = (await unwrap(api.POST('/api/auth/login', { body: { email, password } }))) as unknown as LoginResult;
      if ('twoFactorRequired' in res) return { challengeToken: res.challengeToken };
      setUser(res.user);
      return null;
    },
    [setUser],
  );

  const verifyTwoFactor = useCallback(
    async (challengeToken: string, proof: { code?: string; recoveryCode?: string }) => {
      const res = (await unwrap(
        api.POST('/api/auth/2fa/verify', { body: { challengeToken, ...proof } }),
      )) as unknown as { user: Me };
      setUser(res.user);
    },
    [setUser],
  );

  const logout = useCallback(
    async (everywhere = false) => {
      try {
        if (everywhere) await api.POST('/api/auth/logout-all');
        else await api.POST('/api/auth/logout', { body: {} });
      } finally {
        setUser(null);
      }
    },
    [setUser],
  );

  const value = useMemo<AuthValue>(() => {
    const user = me.data ?? null;
    return {
      user,
      loading: me.isPending,
      can: (action) => !!user?.permissions.includes(action),
      login,
      verifyTwoFactor,
      logout,
    };
  }, [me.data, me.isPending, login, verifyTwoFactor, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
