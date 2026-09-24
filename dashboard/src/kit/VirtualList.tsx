import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import s from './VirtualList.module.css';

export interface VirtualListProps {
  count: number;
  rowHeight: number;
  renderRow: (index: number) => ReactNode;
  getKey?: (index: number) => string | number;
  /** One row may be taller (an expanded log line). Height is the measured full height. */
  expanded?: { index: number; height: number } | null;
  /** Keep the view pinned to the bottom as rows arrive. */
  follow?: boolean;
  /** Called when the user scrolls away from / back to the bottom. */
  onFollowChange?: (follow: boolean) => void;
  /** Scroll so this row is visible whenever it (or `scrollNonce`) changes. */
  scrollToIndex?: number | null;
  scrollNonce?: number;
  scrollAlign?: 'nearest' | 'center';
  overscan?: number;
  className?: string;
  ariaLabel?: string;
  role?: string;
}

/**
 * Fixed-row-height windowing: only the visible rows (plus overscan) are in the
 * DOM, positioned absolutely inside a spacer as tall as the whole list.
 */
export function VirtualList({
  count,
  rowHeight: rh,
  renderRow,
  getKey,
  expanded,
  follow,
  onFollowChange,
  scrollToIndex,
  scrollNonce,
  scrollAlign = 'nearest',
  overscan = 8,
  className,
  ariaLabel,
  role = 'list',
}: VirtualListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  const exp = expanded && expanded.index < count ? expanded : null;
  const extra = exp ? Math.max(0, exp.height - rh) : 0;
  const total = count * rh + extra;

  const offsetOf = useCallback(
    (i: number) => i * rh + (exp && i > exp.index ? extra : 0),
    [rh, exp, extra],
  );
  const heightOf = (i: number) => (exp && i === exp.index ? rh + extra : rh);
  const indexAt = (y: number) => {
    if (exp) {
      const top = exp.index * rh;
      if (y >= top + rh + extra) return exp.index + 1 + Math.floor((y - top - rh - extra) / rh);
      if (y >= top) return exp.index;
    }
    return Math.floor(y / rh);
  };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setViewH(el.clientHeight);
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Follow: stick to the bottom whenever content grows.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !follow) return;
    el.scrollTop = el.scrollHeight;
    setScrollTop(el.scrollTop);
  }, [follow, total, viewH]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || scrollToIndex == null || scrollToIndex < 0 || scrollToIndex >= count) return;
    const top = offsetOf(scrollToIndex);
    const bottom = top + heightOf(scrollToIndex);
    if (scrollAlign === 'center') {
      if (top < el.scrollTop || bottom > el.scrollTop + el.clientHeight) {
        el.scrollTop = Math.max(0, top - el.clientHeight / 2 + rh / 2);
      }
    } else if (top < el.scrollTop) {
      el.scrollTop = top;
    } else if (bottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = bottom - el.clientHeight;
    }
    setScrollTop(el.scrollTop);
  }, [scrollToIndex, scrollNonce]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    if (onFollowChange) {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < rh * 1.5;
      if (atBottom !== !!follow) onFollowChange(atBottom);
    }
  };

  const first = Math.max(0, indexAt(scrollTop) - overscan);
  const last = Math.min(count - 1, indexAt(scrollTop + viewH) + overscan);
  const rows: ReactNode[] = [];
  for (let i = first; i <= last; i++) {
    rows.push(
      <div
        key={getKey ? getKey(i) : i}
        className={s.row}
        style={{ top: offsetOf(i), height: heightOf(i) }}
      >
        {renderRow(i)}
      </div>,
    );
  }

  return (
    <div
      ref={ref}
      className={className ? `${s.list} ${className}` : s.list}
      onScroll={onScroll}
      role={role}
      aria-label={ariaLabel}
      tabIndex={-1}
    >
      <div className={s.spacer} style={{ height: total }}>
        {rows}
      </div>
    </div>
  );
}
