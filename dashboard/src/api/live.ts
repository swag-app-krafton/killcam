/**
 * Live device state: snapshots from the REST API kept current by the SSE stream
 * at /api/live. Incoming events are batched (one store update per ~60 ms) and
 * arrays are capped so a chatty app cannot grow the tab without bound.
 */
import { createStore } from '../state/store';
import { toast } from '../state/ui';
import { api, errorMessage, onAuthenticated } from './client';
import type {
  AppInfo,
  CrashSummary,
  Flag,
  KillcamStatus,
  LiveEvents,
  LogEntry,
  Endpoint,
  MockRule,
  NetworkConditions,
  NetworkSummary,
  PausedCall,
  SessionSummary,
  TimelineEvent,
} from './types';

export const CAP = { network: 1000, logs: 5000, timeline: 5000 } as const;

export type ConnState = 'connecting' | 'open' | 'down';

export interface LiveState {
  conn: ConnState;
  /** Live session id from the last `hello`. */
  sessionId: string | null;
  /** True once the first snapshot for the current session arrived. */
  loaded: boolean;
  info: AppInfo | null;
  status: KillcamStatus | null;
  sessions: SessionSummary[] | null;
  network: NetworkSummary[];
  logs: LogEntry[];
  timeline: TimelineEvent[];
  /** /api/crashes: this session plus crashes saved from earlier ones, newest first. */
  crashes: CrashSummary[];
  mocks: MockRule[] | null;
  /** null until loaded, or when the device predates network conditions. */
  conditions: NetworkConditions | null;
  endpoints: Endpoint[] | null;
  /** Calls held at breakpoints, oldest first. */
  paused: PausedCall[];
  flags: Flag[] | null;
}

export const liveStore = createStore<LiveState>({
  conn: 'connecting',
  sessionId: null,
  loaded: false,
  info: null,
  status: null,
  sessions: null,
  network: [],
  logs: [],
  timeline: [],
  crashes: [],
  mocks: null,
  conditions: null,
  endpoints: null,
  paused: [],
  flags: null,
});

type LiveEvent = { [K in keyof LiveEvents]: [K, LiveEvents[K]] }[keyof LiveEvents];

let es: EventSource | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let backoff = 1000;
let buffering = false;
let queue: LiveEvent[] = [];
let generation = 0;

const STREAMS = ['network', 'log', 'crash', 'timeline', 'mocks', 'conditions', 'endpoints', 'breakpoints', 'flags', 'status', 'cleared'] as const;

export function connectLive(): void {
  clearTimeout(retryTimer);
  es?.close();
  const gen = ++generation;
  liveStore.set({ conn: 'connecting' });
  const source = new EventSource('api/live');
  es = source;
  source.addEventListener('hello', (e) => {
    if (gen !== generation) return;
    backoff = 1000;
    void onHello(JSON.parse((e as MessageEvent<string>).data) as LiveEvents['hello'], gen);
  });
  for (const type of STREAMS) {
    source.addEventListener(type, (e) => {
      if (gen !== generation) return;
      try {
        enqueue([type, JSON.parse((e as MessageEvent<string>).data)] as LiveEvent);
      } catch {
        /* malformed event */
      }
    });
  }
  source.onerror = () => {
    if (gen !== generation) return;
    liveStore.set({ conn: 'down' });
    if (source.readyState === EventSource.CLOSED) {
      // Non-200 (e.g. 401 pin_required) or a fatal error: probe with fetch so the
      // PIN screen can appear, then reconnect ourselves.
      source.close();
      retryTimer = setTimeout(() => {
        api
          .get<KillcamStatus>('status')
          .then((status) => liveStore.set({ status }))
          .catch(() => undefined)
          .finally(() => {
            if (gen === generation) connectLive();
          });
      }, backoff);
      backoff = Math.min(backoff * 2, 10_000);
    }
    // Otherwise the browser is already retrying (readyState CONNECTING).
  };
}

onAuthenticated(() => connectLive());

async function onHello(hello: LiveEvents['hello'], gen: number): Promise<void> {
  const prev = liveStore.get().sessionId;
  const restarted = prev != null && prev !== hello.sessionId;
  buffering = true;
  queue = [];
  if (restarted) {
    liveStore.set({ network: [], logs: [], timeline: [], loaded: false });
    toast('The app restarted: now showing its new live session.', 'info', 5000);
  }
  liveStore.set({ conn: 'open', sessionId: hello.sessionId });
  try {
    const [info, status, sessions, network, logs, timeline, crashes, mocks, flags, conditions, endpoints, paused] = await Promise.all([
      api.get<AppInfo>('info'),
      api.get<KillcamStatus>('status'),
      api.get<SessionSummary[]>('sessions'),
      api.get<NetworkSummary[]>('network'),
      api.get<LogEntry[]>('logs'),
      api.get<TimelineEvent[]>('timeline'),
      api.get<CrashSummary[]>('crashes'),
      api.get<MockRule[]>('mocks'),
      api.get<Flag[]>('flags'),
      // Older devices lack these endpoints; the panels then show their empty states.
      api.get<NetworkConditions>('network-conditions').catch(() => null),
      api.get<Endpoint[]>('endpoints').catch(() => null),
      api.get<PausedCall[]>('breakpoints').catch(() => [] as PausedCall[]),
    ]);
    if (gen !== generation) return;
    liveStore.set({
      info,
      status,
      sessions,
      network: network.slice(-CAP.network),
      logs: logs.slice(-CAP.logs),
      timeline: timeline.slice(-CAP.timeline).sort(byTsSeq),
      crashes,
      mocks,
      flags,
      conditions,
      endpoints,
      paused,
      loaded: true,
    });
  } catch (e) {
    if (gen !== generation) return;
    toast(`Could not load snapshot: ${errorMessage(e)}`, 'error');
  } finally {
    if (gen === generation) {
      buffering = false;
      flush();
    }
  }
}

function enqueue(ev: LiveEvent): void {
  queue.push(ev);
  if (!buffering && flushTimer === undefined) flushTimer = setTimeout(flush, 60);
}

function lastSeq(arr: { seq: number }[]): number {
  return arr.length ? arr[arr.length - 1].seq : 0;
}

function maxSeq(arr: { seq: number }[]): number {
  let m = 0;
  for (const x of arr) if (x.seq > m) m = x.seq;
  return m;
}

/** Timeline order is ts, then seq: a screenshot is stamped with its capture
 *  time, which can precede events recorded while it was encoding. */
export const byTsSeq = (a: { ts: number; seq: number }, b: { ts: number; seq: number }) => a.ts - b.ts || a.seq - b.seq;

function flush(): void {
  flushTimer = undefined;
  if (!queue.length) return;
  const batch = queue;
  queue = [];
  const s = liveStore.get();
  let { network, logs, timeline, crashes, mocks, flags, status, conditions, endpoints, paused } = s;
  let netCopied = false;
  let logsCopied = false;
  let tlCopied = false;
  let refreshSessions = false;
  const logSeq = lastSeq(logs);
  const tlSeq = maxSeq(timeline);
  let tlUnordered = false;

  for (const [type, data] of batch) {
    switch (type) {
      case 'network': {
        if (!netCopied) {
          network = network.slice();
          netCopied = true;
        }
        let i = network.length - 1;
        while (i >= 0 && network[i].id !== data.id) i--;
        if (i >= 0) {
          // Never regress a finished call to pending (late event after a snapshot).
          if (!(data.state === 'pending' && network[i].state !== 'pending')) network[i] = data;
        } else {
          network.push(data);
        }
        break;
      }
      case 'log':
        if (data.seq <= logSeq) break;
        if (!logsCopied) {
          logs = logs.slice();
          logsCopied = true;
        }
        logs.push(data);
        break;
      case 'timeline':
        if (data.seq <= tlSeq) break;
        if (!tlCopied) {
          timeline = timeline.slice();
          tlCopied = true;
        }
        if (timeline.length && byTsSeq(timeline[timeline.length - 1], data) > 0) tlUnordered = true;
        timeline.push(data);
        break;
      case 'crash':
        if (!crashes.some((c) => c.id === data.id)) crashes = [data, ...crashes];
        if (data.fatal) refreshSessions = true;
        break;
      case 'mocks':
        mocks = data;
        break;
      case 'conditions':
        conditions = data;
        break;
      case 'endpoints':
        endpoints = data;
        break;
      case 'breakpoints':
        paused = data;
        break;
      case 'flags':
        flags = data;
        break;
      case 'status':
        status = data;
        break;
      case 'cleared': {
        const st = data.stream;
        if (st === 'network' || st === 'all') network = [];
        if (st === 'logs' || st === 'all') logs = [];
        if (st === 'timeline' || st === 'all') timeline = [];
        if (st === 'crashes' || st === 'all') crashes = crashes.filter((c) => c.sessionId !== s.sessionId);
        break;
      }
    }
  }
  if (network.length > CAP.network) network = network.slice(-CAP.network);
  if (logs.length > CAP.logs) logs = logs.slice(-CAP.logs);
  if (tlUnordered) timeline.sort(byTsSeq);
  if (timeline.length > CAP.timeline) timeline = timeline.slice(-CAP.timeline);
  liveStore.set({ network, logs, timeline, crashes, mocks, flags, status, conditions, endpoints, paused });
  if (refreshSessions) void reloadSessions();
}

// --------------------------------------------------------- manual refresh --

export async function reloadSessions(): Promise<void> {
  try {
    liveStore.set({ sessions: await api.get<SessionSummary[]>('sessions') });
  } catch {
    /* keep the old list */
  }
}

export async function reloadMocks(): Promise<void> {
  liveStore.set({ mocks: await api.get<MockRule[]>('mocks') });
}

export async function reloadConditions(): Promise<void> {
  liveStore.set({ conditions: await api.get<NetworkConditions>('network-conditions') });
}

export async function reloadEndpoints(): Promise<void> {
  liveStore.set({ endpoints: await api.get<Endpoint[]>('endpoints') });
}

export async function reloadFlags(): Promise<void> {
  liveStore.set({ flags: await api.get<Flag[]>('flags') });
}

export async function reloadInfo(): Promise<void> {
  const [info, status] = await Promise.all([api.get<AppInfo>('info'), api.get<KillcamStatus>('status')]);
  liveStore.set({ info, status });
}

export async function reloadCrashes(): Promise<void> {
  liveStore.set({ crashes: await api.get<CrashSummary[]>('crashes') });
}
