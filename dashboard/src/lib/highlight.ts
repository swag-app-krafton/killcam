import { useEffect } from 'react';
import { useRoute } from '../state/router';

export const HIGHLIGHT_MS = 2800;
const OFFSET = 96;

/** swagperf's link behaviour: `#/flags?focus=flag:pay.x` scrolls the element
 *  marked data-hl="flag:pay.x" into view and rings it (the design system's
 *  global .sp-highlight). Retries briefly, since the target may render only
 *  after its data arrives. */
export function useHighlightTarget(scroller: () => HTMLElement | null): void {
  const { focus, key } = useRoute();
  useEffect(() => {
    if (!focus) return;
    let tries = 0;
    let clear: ReturnType<typeof setTimeout> | undefined;
    const tick = setInterval(() => {
      const el = document.querySelector<HTMLElement>(`[data-hl="${CSS.escape(focus)}"]`);
      const main = scroller();
      if (!el || !main) {
        if (++tries > 40) clearInterval(tick);
        return;
      }
      clearInterval(tick);
      if (main.contains(el)) {
        const top = el.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop - OFFSET;
        main.scrollTo({ top, behavior: 'smooth' });
      } else {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      el.classList.add('sp-highlight');
      clear = setTimeout(() => el.classList.remove('sp-highlight'), HIGHLIGHT_MS);
    }, 100);
    return () => {
      clearInterval(tick);
      if (clear) clearTimeout(clear);
    };
  }, [focus, key, scroller]);
}
