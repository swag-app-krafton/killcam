import type { Panel } from '../state/router';

/** The navigation model, grouped the way swagperf groups its screens. The
 *  sidebar, page header, bottom tabs and More sheet all read this table. */
export type NavGroup = 'Analyse' | 'Run' | 'Data';

export interface ScreenDef {
  id: Panel;
  label: string;
  /** Two-letter code shown in the collapsed rail. */
  code: string;
  group: NavGroup;
  /** One line: what the page is for. */
  hint: string;
  icon: string;
  /** Renders from the session in view (live or saved), not the live app. */
  session?: boolean;
}

export const SCREENS: ScreenDef[] = [
  { id: 'replay', label: 'Replay', code: 'RP', group: 'Analyse', icon: 'replay', session: true, hint: 'The screens, taps, calls and logs before a moment, played back. A crashed session opens on its last 15 s.' },
  { id: 'network', label: 'Network', code: 'NW', group: 'Analyse', icon: 'network', session: true, hint: 'Every HTTP call in the session in view: status, timing, headers and bodies.' },
  { id: 'logs', label: 'Logs', code: 'LG', group: 'Analyse', icon: 'logs', session: true, hint: "Killcam.log lines, analytics events and the app's own logcat, as they happen." },
  { id: 'crashes', label: 'Crashes', code: 'CR', group: 'Analyse', icon: 'skull', session: true, hint: "Fatal crashes and recorded non-fatal errors, from this session and earlier ones, with the app's own frames marked." },
  { id: 'mocks', label: 'Mocks', code: 'MK', group: 'Run', icon: 'mocks', hint: 'Rules that answer matching calls with a canned response, add latency or fail them. The first enabled match wins.' },
  { id: 'endpoints', label: 'Endpoints', code: 'EP', group: 'Run', icon: 'link', hint: "The app's APIs by name (/page/fetch, /data/sync), from the repo catalog, code and testers. Target them with mocks, failures and breakpoints; export new ones for the repo." },
  { id: 'flags', label: 'Flags', code: 'FL', group: 'Run', icon: 'flag', hint: 'Every declared flag with its default, remote and override value. Overrides apply to the running app.' },
  { id: 'remote-config', label: 'Remote Config', code: 'RC', group: 'Run', icon: 'cloud', hint: 'Firebase Remote Config as the app sees it: each value, where it came from, and the last fetch.' },
  { id: 'actions', label: 'Actions', code: 'AC', group: 'Run', icon: 'bolt', hint: 'Buttons the app registered for testing, and a deep-link launcher.' },
  { id: 'sessions', label: 'Sessions', code: 'SE', group: 'Data', icon: 'save', hint: 'The live session and every saved one. Open one to replay it, or export it as a bug bundle.' },
  { id: 'storage', label: 'Storage', code: 'SG', group: 'Data', icon: 'storage', hint: "Shared preferences, MMKV, SQLite databases and files in the app's sandbox. Edits apply to the running app." },
];

export const GROUPS: NavGroup[] = ['Analyse', 'Run', 'Data'];

export const screenOf = (id: Panel): ScreenDef => SCREENS.find((s) => s.id === id) ?? SCREENS[0];

/** The phone's bottom tabs; everything else is under More. */
export const TAB_IDS: Panel[] = ['logs', 'network', 'replay', 'crashes'];
