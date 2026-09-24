import { load, save } from '../lib/storage';
import { createStore, useStore } from './store';

export const PANELS = [
  'replay',
  'network',
  'logs',
  'crashes',
  'mocks',
  'flags',
  'remote-config',
  'actions',
  'sessions',
  'storage',
] as const;
export type Panel = (typeof PANELS)[number];

export interface Route {
  panel: Panel;
  /** Decoded path segments after the panel, e.g. ['net_0001abc'] for #/network/net_0001abc. */
  parts: string[];
  /** `?focus=<id>`: scroll to the element marked data-hl="<id>" and ring it. */
  focus: string | null;
  /** Changes on every navigation, so the same focus can ring again. */
  key: number;
}

const EMBED = new URLSearchParams(location.search).get('embed') === '1';
const LAST_PANEL_KEY = 'killcam.embed.lastPanel';
/** Where an empty hash lands: the phone window reopens the last panel used
 *  (Logs the first time); elsewhere the first screen in the sidebar. */
const HOME: Panel = EMBED ? 'logs' : 'replay';

if (EMBED && !location.hash.replace(/^#\/?/, '')) {
  const last = load<string>(LAST_PANEL_KEY, 'logs');
  const panel = (PANELS as readonly string[]).includes(last) ? last : 'logs';
  history.replaceState(history.state, '', `#/${panel}`);
}

let navKey = 0;

function parse(): Route {
  const raw = location.hash.replace(/^#\/?/, '');
  const [pathPart, query = ''] = raw.split('?');
  const segs = pathPart
    .split('/')
    .filter((s) => s !== '')
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
  const known = (PANELS as readonly string[]).includes(segs[0] ?? '');
  const panel = known ? (segs[0] as Panel) : HOME;
  return { panel, parts: known ? segs.slice(1) : [], focus: new URLSearchParams(query).get('focus'), key: ++navKey };
}

export const routeStore = createStore<Route>(parse());

window.addEventListener('hashchange', () => routeStore.set(parse()));

if (EMBED) {
  let lastSaved = '';
  routeStore.subscribe(() => {
    const p = routeStore.get().panel;
    if (p !== lastSaved) {
      lastSaved = p;
      save(LAST_PANEL_KEY, p);
    }
  });
}

/** Build a route path from raw segments: routePath('storage', 'db', 'swag-pay.db'). */
export function routePath(...segs: (string | null | undefined)[]): string {
  return segs
    .filter((s): s is string => s != null && s !== '')
    .map(encodeURIComponent)
    .join('/');
}

/** A link that lands on the named thing and rings it: focusPath('flags', 'flag:pay.x'). */
export function focusPath(path: string, id: string): string {
  return `${path}?focus=${encodeURIComponent(id)}`;
}

/** Navigate to a route path (no leading '#/'). `replace` avoids a history entry (list selection). */
export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  const hash = '#/' + path.replace(/^\/+/, '');
  if (location.hash === hash) {
    routeStore.set(parse());
    return;
  }
  if (opts.replace) {
    history.replaceState(history.state, '', hash);
    routeStore.set(parse());
  } else {
    location.hash = hash;
  }
}

/**
 * Navigate from inside a sheet: replaces the sheet's history entry, so Back
 * then returns to where the sheet was opened from.
 */
export function replaceRoute(path: string): void {
  history.replaceState(null, '', '#/' + path.replace(/^\/+/, ''));
  routeStore.set(parse());
}

export function useRoute(): Route {
  return useStore(routeStore, (s) => s);
}
