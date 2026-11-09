import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';

/** Query keys of the lab: invalidate ['places'] / ['work-sessions'] after a change. */
export const keys = {
  places: ['places', 'list'] as const,
  place: (code: string) => ['places', 'one', code.toUpperCase()] as const,
  recent: (code: string) => ['work-sessions', 'recent', code.toUpperCase()] as const,
  active: ['work-sessions', 'active-mine'] as const,
  bookings: (placeId: string, from: string) => ['bookings', 'place', placeId, from] as const,
  faults: (placeId: string) => ['faults', 'place', placeId] as const,
  fault: (id: string) => ['faults', 'one', id] as const,
  docs: (placeId: string) => ['documents', 'place', placeId] as const,
};

/** My running session (any equipment), or null. */
export function useActiveSession() {
  const { user } = useAuth();
  return useQuery({
    queryKey: keys.active,
    enabled: !!user,
    queryFn: async () => {
      const r = await unwrap(
        api.GET('/api/work-sessions', { params: { query: { active: 'true', userId: user!.id, limit: '1' } } }),
      );
      return r.items[0] ?? null;
    },
    // A session can be ended on another device or closed by the server.
    refetchInterval: 60_000,
  });
}

export function usePlace(code: string) {
  return useQuery({
    queryKey: keys.place(code),
    queryFn: () => unwrap(api.GET('/api/places/{id}', { params: { path: { id: code } } })),
  });
}

/** One idempotency key per user action (a double tap does not start twice). */
export function newActionKey(): string {
  return crypto.randomUUID();
}
