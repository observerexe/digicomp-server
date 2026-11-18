import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '../../../api/client';
import type { BunkerActionType, BunkerPersonalKind, BunkerRoom } from '../../../api/types';

export const roomsKey = ['bunker', 'rooms'] as const;
export const roomKey = (id: string) => ['bunker', 'room', id] as const;
export const packsKey = ['bunker', 'packs'] as const;
export const packKey = (id: string) => ['bunker', 'pack', id] as const;
export const cardsKey = ['bunker', 'cards'] as const;

/** How often an open room asks for news: there is no push from the server. */
export const ROOM_POLL_MS = 2000;
export const ROOMS_POLL_MS = 5000;

export function useRooms() {
  return useQuery({
    queryKey: roomsKey,
    queryFn: () => unwrap(api.GET('/api/bunker/rooms')),
    refetchInterval: ROOMS_POLL_MS,
  });
}

export function useRoom(id: string) {
  return useQuery({
    queryKey: roomKey(id),
    queryFn: async () => {
      const room = await unwrap(api.GET('/api/bunker/rooms/{id}', { params: { path: { id } } }));
      // Server time minus ours: the turn timer counts from the server's.
      return { room, skew: new Date(room.now).getTime() - Date.now() };
    },
    refetchInterval: (q) => (q.state.error ? false : ROOM_POLL_MS),
  });
}

export function usePacks() {
  return useQuery({ queryKey: packsKey, queryFn: () => unwrap(api.GET('/api/bunker/packs')) });
}

/** A change of the room: the answer is the room as the reader sees it now. */
export function useRoomChange(id: string) {
  const qc = useQueryClient();
  const put = (room: BunkerRoom | null | undefined) => {
    if (room) qc.setQueryData(roomKey(id), { room, skew: new Date(room.now).getTime() - Date.now() });
    void qc.invalidateQueries({ queryKey: roomsKey });
  };
  const act = useMutation({
    mutationFn: (body: { type: BunkerActionType; kind?: BunkerPersonalKind; targetId?: string }) =>
      unwrap(api.POST('/api/bunker/rooms/{id}/actions', { params: { path: { id } }, body })),
    onSuccess: put,
  });
  const room = useMutation({
    mutationFn: (what: 'start' | 'restart' | 'join') => {
      const params = { params: { path: { id } } };
      if (what === 'start') return unwrap(api.POST('/api/bunker/rooms/{id}/start', params));
      if (what === 'restart') return unwrap(api.POST('/api/bunker/rooms/{id}/restart', params));
      return unwrap(api.POST('/api/bunker/rooms/{id}/join', params));
    },
    onSuccess: put,
  });
  const member = useMutation({
    mutationFn: ({ userId, what }: { userId: string; what: 'remove' | 'host' }) =>
      what === 'remove'
        ? unwrap(api.DELETE('/api/bunker/rooms/{id}/members/{userId}', { params: { path: { id, userId } } }))
        : unwrap(api.POST('/api/bunker/rooms/{id}/host', { params: { path: { id } }, body: { userId } })),
    onSuccess: put,
  });
  return { act, room, member };
}
