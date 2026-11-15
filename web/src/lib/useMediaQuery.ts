import { useSyncExternalStore } from 'react';

/** Whether the media query matches now; follows changes (a window made narrower). Without matchMedia — true. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia?.(query);
      m?.addEventListener('change', onChange);
      return () => m?.removeEventListener('change', onChange);
    },
    () => window.matchMedia?.(query).matches ?? true,
  );
}
