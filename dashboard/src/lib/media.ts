import { useSyncExternalStore } from 'react';

/** Same breakpoints as swagperf (lib/useMediaQuery.ts). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const useIsNarrow = () => useMediaQuery('(max-width: 759px)');
