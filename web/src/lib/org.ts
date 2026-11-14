import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../api/client';

export const ORG_KEY = ['org-settings'] as const;

/** Requisites for documents: every role reads them (header, signature). */
export function useOrgSettings() {
  return useQuery({
    queryKey: ORG_KEY,
    queryFn: () => unwrap(api.GET('/api/org-settings')),
    staleTime: 5 * 60_000,
  });
}
