/**
 * "Which session am I looking at": the live stream, or a saved SessionBundle.
 * Network / Logs / Crashes / Replay render from useSessionView(); everything
 * else always talks to the live device.
 */
import { useEffect, useMemo } from 'react';
import { api, enc, errorMessage } from '../api/client';
import { byTsSeq, liveStore } from '../api/live';
import type {
  Crash,
  CrashSummary,
  LogEntry,
  NetworkCall,
  NetworkSummary,
  SessionBundle,
  SessionSummary,
  TimelineEvent,
} from '../api/types';
import { appStore } from './app';
import { createStore, useStore } from './store';

interface BundleEntry {
  status: 'loading' | 'ready' | 'error';
  bundle: SessionBundle | null;
  error: string | null;
}

export const bundleStore = createStore<{ entries: Record<string, BundleEntry> }>({ entries: {} });

export function ensureBundle(id: string, force = false): void {
  const cur = bundleStore.get().entries[id];
  if (cur && !force && cur.status !== 'error') return;
  const put = (e: BundleEntry) => bundleStore.set((s) => ({ entries: { ...s.entries, [id]: e } }));
  put({ status: 'loading', bundle: null, error: null });
  api
    .get<SessionBundle>(`sessions/${enc(id)}`)
    .then((bundle) => put({ status: 'ready', bundle, error: null }))
    .catch((e) => put({ status: 'error', bundle: null, error: errorMessage(e) }));
}

export function forgetBundle(id: string): void {
  bundleStore.set((s) => {
    const entries = { ...s.entries };
    delete entries[id];
    return { entries };
  });
}

export interface SessionView {
  kind: 'live' | 'saved';
  /** Path segment for /api/sessions/{key}/...: 'live' or the saved id. */
  key: string;
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  sessionId: string | null;
  summary: SessionSummary | null;
  startMs: number | null;
  /** null while live. */
  endMs: number | null;
  /** The crash that ended the session, if any. */
  crash: CrashSummary | null;
  network: NetworkSummary[];
  /** Full calls (saved sessions carry them in the bundle). */
  calls: NetworkCall[] | null;
  logs: LogEntry[];
  timeline: TimelineEvent[];
  /** What the Crashes panel lists. Live: this session + earlier ones. */
  crashes: CrashSummary[];
  /** Full crashes when saved (no fetch needed). */
  fullCrashes: Crash[] | null;
  /** Crashes that happened in this session only (Replay). */
  sessionCrashes: CrashSummary[];
}

export function useSelectedKey(): string {
  return useStore(appStore, (s) => s.selected);
}

export function useSessionView(): SessionView {
  const selected = useSelectedKey();
  const isLive = selected === 'live';
  const entry = useStore(bundleStore, (s) => (isLive ? undefined : s.entries[selected]));
  const liveId = useStore(liveStore, (s) => s.sessionId);
  const loaded = useStore(liveStore, (s) => s.loaded);
  const info = useStore(liveStore, (s) => s.info);
  const sessions = useStore(liveStore, (s) => s.sessions);
  const network = useStore(liveStore, (s) => s.network);
  const logs = useStore(liveStore, (s) => s.logs);
  const timeline = useStore(liveStore, (s) => s.timeline);
  const crashes = useStore(liveStore, (s) => s.crashes);

  useEffect(() => {
    if (!isLive) ensureBundle(selected);
  }, [isLive, selected]);

  return useMemo<SessionView>(() => {
    if (isLive) {
      const summary = sessions?.find((s) => s.live) ?? null;
      return {
        kind: 'live',
        key: 'live',
        status: loaded ? 'ready' : 'loading',
        error: null,
        sessionId: liveId,
        summary,
        startMs: info?.sessionStartMs ?? summary?.startMs ?? null,
        endMs: null,
        crash: null,
        network,
        calls: null,
        logs,
        timeline,
        crashes,
        fullCrashes: null,
        sessionCrashes: crashes.filter((c) => c.sessionId === liveId),
      };
    }
    const b = entry?.bundle ?? null;
    const tl = b ? sortedTimeline(b) : [];
    const fatal = b?.session.crash ?? b?.crashes.find((c) => c.fatal) ?? null;
    return {
      kind: 'saved',
      key: selected,
      status: entry?.status ?? 'loading',
      error: entry?.error ?? null,
      sessionId: b?.session.id ?? selected,
      summary: b?.session ?? sessions?.find((s) => s.id === selected) ?? null,
      startMs: b?.session.startMs ?? null,
      endMs: b ? (b.session.endMs ?? fatal?.ts ?? lastTs(b)) : null,
      crash: fatal,
      network: b?.network ?? [],
      calls: b?.network ?? null,
      logs: b?.logs ?? [],
      timeline: tl,
      crashes: b ? [...b.crashes].sort((x, y) => y.ts - x.ts) : [],
      fullCrashes: b?.crashes ?? null,
      sessionCrashes: b?.crashes ?? [],
    };
  }, [isLive, selected, entry, liveId, loaded, info, sessions, network, logs, timeline, crashes]);
}

const sortedCache = new WeakMap<SessionBundle, TimelineEvent[]>();
function sortedTimeline(b: SessionBundle): TimelineEvent[] {
  let t = sortedCache.get(b);
  if (!t) {
    t = [...b.timeline].sort(byTsSeq);
    sortedCache.set(b, t);
  }
  return t;
}

function lastTs(b: SessionBundle): number {
  let t = b.session.startMs;
  for (const e of b.timeline) t = Math.max(t, e.ts);
  for (const e of b.logs) t = Math.max(t, e.ts);
  for (const c of b.network) t = Math.max(t, c.startMs + (c.durationMs ?? 0));
  return t;
}

/** Map a crash's sessionId to the key used by the session selector. */
export function sessionKeyFor(sessionId: string): string {
  return sessionId === liveStore.get().sessionId ? 'live' : sessionId;
}

export function screenshotUrl(key: string, screenshotId: string): string {
  return `api/sessions/${enc(key)}/screenshots/${enc(screenshotId)}`;
}
