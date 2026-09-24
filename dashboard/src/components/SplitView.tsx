import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { load, save } from '../lib/storage';

/**
 * List + detail. Side by side (resizable) when the main area is wide; the
 * detail covers the list when it is narrow (phone / in-app window).
 */
export function SplitView({
  list,
  detail,
  open,
  storageKey,
  initial = 0.5,
}: {
  list: ReactNode;
  detail: ReactNode;
  open: boolean;
  storageKey: string;
  initial?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [frac, setFrac] = useState(() => load<number>(`killcam.split.${storageKey}`, initial));
  const onPointerDown = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    let latest = frac;
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      latest = Math.min(0.78, Math.max(0.25, (r.right - ev.clientX) / r.width));
      setFrac(latest);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      save(`killcam.split.${storageKey}`, latest);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  };
  return (
    <div
      ref={ref}
      className={open ? 'split open' : 'split'}
      style={{ '--detail-w': `${(frac * 100).toFixed(2)}%` } as CSSProperties}
    >
      <div className="split-list">{list}</div>
      {open && (
        <>
          <div
            className="split-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize detail pane"
            onPointerDown={onPointerDown}
          />
          <div className="split-detail">{detail}</div>
        </>
      )}
    </div>
  );
}
