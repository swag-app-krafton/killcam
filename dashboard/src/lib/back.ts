import { useEffect, useRef } from 'react';
import { appStore } from '../state/app';

/*
 * In the phone WebView, every open sheet/modal owns one history entry, so the
 * Android Back button (native calls webView.goBack()) closes the top one instead
 * of leaving the panel. Navigation started from inside a sheet should use
 * replaceRoute(), which takes over that entry.
 *
 * history.back() is async, so pushes are queued until our own pending backs
 * have landed; otherwise closing one sheet and opening another in the same
 * tick would pop the new one.
 */

let pendingBacks = 0;
let queue: (() => void)[] = [];
let safety: ReturnType<typeof setTimeout> | undefined;

function flush(): void {
  pendingBacks = 0;
  clearTimeout(safety);
  const q = queue;
  queue = [];
  q.forEach((f) => f());
}

window.addEventListener('popstate', () => {
  if (pendingBacks > 0 && --pendingBacks === 0) flush();
});

function goBack(): void {
  pendingBacks++;
  clearTimeout(safety);
  safety = setTimeout(flush, 400);
  history.back();
}

function whenSettled(fn: () => void): void {
  if (pendingBacks === 0) fn();
  else queue.push(fn);
}

type SheetState = { killcamSheet?: string } | null;

export function useBackToClose(onClose: () => void, enabled = appStore.get().embed): void {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    if (!enabled) return;
    const token = Math.random().toString(36).slice(2);
    let pushed = false;
    let closed = false;
    const onPop = () => {
      // Landing on our own entry means something above us was popped: stay open.
      if ((history.state as SheetState)?.killcamSheet === token) return;
      closed = true;
      window.removeEventListener('popstate', onPop);
      ref.current();
    };
    whenSettled(() => {
      if (closed) return;
      history.pushState({ killcamSheet: token }, '');
      pushed = true;
      window.addEventListener('popstate', onPop);
    });
    return () => {
      const wasOpen = !closed;
      closed = true;
      window.removeEventListener('popstate', onPop);
      if (wasOpen && pushed && (history.state as SheetState)?.killcamSheet === token) goBack();
    };
  }, [enabled]);
}
