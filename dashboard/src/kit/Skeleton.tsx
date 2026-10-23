import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import s from './skeleton.module.css';

/**
 * A shimmer placeholder the size of the value it stands in for. Skeletons are
 * built from the real page layout (the design system's cards, tables and rows),
 * with bones where the data will be, so the page doesn't jump when it arrives.
 */
export function Bone({
  w = '100%',
  h = 12,
  r,
  block,
  console: onConsole,
  style,
}: {
  w?: number | string;
  h?: number | string;
  /** Corner radius; defaults to the design system's small radius. */
  r?: number | string;
  block?: boolean;
  /** For bones drawn on the dark console surface (Logs). */
  console?: boolean;
  style?: CSSProperties;
}) {
  return <span aria-hidden="true" className={[s.bone, block ? s.block : '', onConsole ? s.onConsole : ''].join(' ')} style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

/** True once [ms] have passed; skeletons stay hidden on fast loads so they never flash. */
export function useDelayed(ms: number): boolean {
  const [shown, setShown] = useState(ms <= 0);
  useEffect(() => {
    if (ms <= 0) return undefined;
    const timer = window.setTimeout(() => setShown(true), ms);
    return () => window.clearTimeout(timer);
  }, [ms]);
  return shown;
}

/**
 * The accessible wrapper every skeleton renders in: `aria-busy`, a hidden
 * "Loading <label>" for screen readers, and nothing at all for the first
 * [delay] ms of a wait.
 */
export function Skeleton({ label, delay = 150, className, style, children }: { label: string; delay?: number; className?: string; style?: CSSProperties; children: ReactNode }) {
  const shown = useDelayed(delay);
  if (!shown) return null;
  return (
    <div aria-busy="true" role="status" className={[s.region, className ?? ''].join(' ')} style={style}>
      <span className={s.srOnly}>Loading {label}</span>
      {/* inert: the real components a skeleton borrows (row toggles, table
          headers) must not take focus or be read out while nothing is there. */}
      <div inert className={s.body}>
        {children}
      </div>
    </div>
  );
}

/** Deterministic widths so a skeleton looks like varied data, not a barcode. */
export const widths = (n: number, pattern: readonly (number | string)[]) => Array.from({ length: n }, (_, i) => pattern[i % pattern.length]!);

export { s as skeletonClasses };
