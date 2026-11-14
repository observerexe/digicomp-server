import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../api/client';
import type { Dictionary } from '../api/types';

export const DICTIONARIES_KEY = ['dictionaries'] as const;

/** Category dictionaries of the modules (keys are fixed by the server). */
export const CATEGORY = {
  place: 'place_category',
  document: 'document_category',
  inventory: 'inventory_category',
} as const;

/** All dictionaries: every role reads them (labels on cards, pickers). */
export function useDictionaries() {
  return useQuery({
    queryKey: DICTIONARIES_KEY,
    queryFn: () => unwrap(api.GET('/api/dictionaries')),
  });
}

/** One dictionary; items rarely change, so it is kept for a few minutes. No key — nothing to load. */
export function useDictionary(key: string | null | undefined) {
  return useQuery({
    queryKey: [...DICTIONARIES_KEY, key ?? ''],
    enabled: !!key,
    queryFn: () => unwrap(api.GET('/api/dictionaries/{key}', { params: { path: { key: key! } } })),
    staleTime: 5 * 60_000,
  });
}

/** Title of an item; the key itself while the dictionary loads or if the item is gone. */
export function itemTitle(dict: Dictionary | undefined, key: string): string {
  return dict?.items.find((i) => i.key === key)?.title ?? key;
}

/** Filter options: items that occur in `used`, in the dictionary order. */
export function usedItems(dict: Dictionary | undefined, used: string[]): { value: string; label: string }[] {
  const present = new Set(used.filter(Boolean));
  const known = (dict?.items ?? []).filter((i) => present.has(i.key)).map((i) => ({ value: i.key, label: i.title }));
  const rest = [...present].filter((k) => !known.some((o) => o.value === k)).map((k) => ({ value: k, label: k }));
  return [...known, ...rest];
}
