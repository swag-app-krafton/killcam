import type { MockRuleInput } from '../api/types';
import { callNative, nativeBridge } from '../lib/native';
import { load, save } from '../lib/storage';
import { createStore } from './store';

export type Theme = 'dark' | 'light';

export interface ReplayFocus {
  ts: number;
  autoplay: boolean;
  nonce: number;
}

export interface AppState {
  theme: Theme;
  /** ?embed=1: the phone's in-app window (a full-screen WebView). */
  embed: boolean;
  /** ?embed=devtools: iframed in React Native DevTools (host shows the brand). */
  devtools: boolean;
  /** The sidebar collapsed to a rail of two-letter codes (desktop). */
  railPinned: boolean;
  /** The sidebar as a drawer (narrow desktop windows). */
  drawerOpen: boolean;
  /** The Session details dialog (app, device, runtime, connection). */
  detailsOpen: boolean;
  /** 'live' or the id of a saved session. */
  selected: string;
  /** Where Replay should put its playhead next ("Replay the last 15 s"). */
  replayFocus: ReplayFocus | null;
  /** Prefilled rule for the Mocks editor (set by "Mock this"). */
  mockDraft: { input: MockRuleInput; testUrl: string } | null;
}

const params = new URLSearchParams(location.search);
const embedParam = params.get('embed');

export const appStore = createStore<AppState>({
  theme: load<Theme>('killcam.theme', 'dark') === 'light' ? 'light' : 'dark',
  embed: embedParam === '1',
  devtools: embedParam === 'devtools',
  railPinned: load<boolean>('killcam.rail', embedParam === 'devtools'),
  drawerOpen: false,
  detailsOpen: false,
  selected: 'live',
  replayFocus: null,
  mockDraft: null,
});

/** Puts the theme on <html>, where the design tokens are scoped, and tells the
 *  phone window to paint its status and navigation bars to match the page. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  const b = nativeBridge();
  if (!b || typeof b.setChrome !== 'function') return;
  // Read the resolved --bg after the attribute change applied.
  requestAnimationFrame(() => {
    const bg = getComputedStyle(document.body).backgroundColor;
    callNative((n) => n.setChrome?.(toHex(bg), theme === 'light'));
  });
}

function toHex(color: string): string {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(color);
  if (!m) return color.startsWith('#') ? color : '#000000';
  return '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('');
}

export function setTheme(theme: Theme): void {
  appStore.set({ theme });
  applyTheme(theme);
  save('killcam.theme', theme);
}

export function toggleRail(): void {
  const railPinned = !appStore.get().railPinned;
  appStore.set({ railPinned });
  save('killcam.rail', railPinned);
}

let focusNonce = 0;
export function focusReplay(sessionKey: string, ts: number, autoplay: boolean): void {
  appStore.set({ selected: sessionKey, replayFocus: { ts, autoplay, nonce: ++focusNonce } });
}
