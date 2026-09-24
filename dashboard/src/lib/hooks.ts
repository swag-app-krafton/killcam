import { useEffect, useRef, useState } from 'react';

/**
 * Window-level single-key shortcuts (j, k, Escape, ...). Ignored while typing
 * in a field (except Escape), with modifiers held, or while a modal is open.
 */
export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>, enabled = true): void {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('.modal-backdrop')) return;
      const t = e.target as HTMLElement | null;
      const editable = t?.closest?.('input, textarea, select, [contenteditable="true"]');
      if (editable && e.key !== 'Escape') return;
      const fn = ref.current[e.key];
      if (fn) {
        e.preventDefault();
        fn(e);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/** Re-render every `ms` while `active` (relative times, live playhead). */
export function useNow(ms: number, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms, active]);
  return now;
}

/** Async loader with cancellation; `reload()` re-runs it. */
export function useAsync<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
): { data: T | undefined; error: unknown; loading: boolean; reload: () => void } {
  const [state, setState] = useState<{ data: T | undefined; error: unknown; loading: boolean }>({
    data: undefined,
    error: undefined,
    loading: true,
  });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => ({ data: s.data, error: undefined, loading: true }));
    fn(ctrl.signal).then(
      (data) => !ctrl.signal.aborted && setState({ data, error: undefined, loading: false }),
      (error) => !ctrl.signal.aborted && setState({ data: undefined, error, loading: false }),
    );
    return () => ctrl.abort();
  }, [...deps, nonce]);
  return { ...state, reload: () => setNonce((n) => n + 1) };
}

/** Move a selection through a list with j/k/arrows. */
export function listStep<T>(items: readonly T[], currentIndex: number, delta: number): T | undefined {
  if (!items.length) return undefined;
  if (currentIndex < 0) return delta > 0 ? items[0] : items[items.length - 1];
  return items[Math.max(0, Math.min(items.length - 1, currentIndex + delta))];
}
