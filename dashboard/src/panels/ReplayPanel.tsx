import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { api, errorMessage } from '../api/client';
import type { CrashSummary, LogLevel, NetworkSummary, TimelineEvent } from '../api/types';
import { Icon } from '../components/Icon';
import { StatusPill } from '../components/StatusPill';
import { Chip, EmptyState, IconButton, Loading, Segmented } from '../components/ui';
import { VirtualList } from '../components/VirtualList';
import {
  fmtClock,
  fmtDuration,
  fmtElapsed,
  fmtOffset,
  isNetworkError,
  shortClass,
} from '../lib/format';
import { useHotkeys, useNow } from '../lib/hooks';
import { appStore, type ReplayFocus } from '../state/app';
import { screenshotUrl, useSessionView, type SessionView } from '../state/session';
import { createStore, useStore } from '../state/store';
import { toast } from '../state/ui';
import { CrashDetail } from './CrashesPanel';
import { NetworkDetail } from './NetworkDetail';

const KILLCAM_MS = 15_000;
const TAP_WINDOW_MS = 1_500;
const SPEEDS = [1, 2, 4] as const;
type Speed = (typeof SPEEDS)[number];
type Zoom = 'all' | '60' | '15';

// ------------------------------------------------------------------ feed --

type FeedKind = 'screen' | 'tap' | 'lifecycle' | 'screenshot' | 'mark' | 'custom' | 'net' | 'log' | 'event' | 'crash';
type FeedGroup = 'ui' | 'net' | 'logs' | 'events' | 'shots';

interface FeedItem {
  id: string;
  ts: number;
  seq: number;
  kind: FeedKind;
  group: FeedGroup | 'crash';
  title: string;
  sub?: string;
  tone?: 'err' | 'warn' | 'accent' | 'mute' | 'ok';
  net?: NetworkSummary;
  crash?: CrashSummary;
  level?: LogLevel;
}

const feedFilterStore = createStore<Record<FeedGroup, boolean>>({
  ui: true,
  net: true,
  logs: true,
  events: true,
  shots: false,
});

const KIND_ICON: Record<FeedKind, string> = {
  screen: 'screen',
  tap: 'tap',
  lifecycle: 'cycle',
  screenshot: 'camera',
  mark: 'mark',
  custom: 'bolt',
  net: 'network',
  log: 'logs',
  event: 'star',
  crash: 'skull',
};

function timelineItem(e: TimelineEvent): FeedItem {
  const base = { id: e.id, ts: e.ts, seq: e.seq };
  switch (e.type) {
    case 'screen':
      return { ...base, kind: 'screen', group: 'ui', title: e.label, tone: 'accent' };
    case 'tap': {
      const gesture = typeof e.data.gesture === 'string' ? e.data.gesture : 'tap';
      const verb = gesture === 'swipe' ? 'Swipe' : gesture === 'long_press' ? 'Long press' : 'Tap';
      // Compose and React Native taps have no named target, only a position.
      const target = typeof e.data.target === 'string' && e.data.target ? e.data.target : null;
      return { ...base, kind: 'tap', group: 'ui', title: target ? `${verb} ${target}` : verb };
    }
    case 'lifecycle':
      return { ...base, kind: 'lifecycle', group: 'ui', title: e.label, tone: 'mute' };
    case 'screenshot':
      return { ...base, kind: 'screenshot', group: 'shots', title: 'Screenshot', sub: e.screen ?? undefined, tone: 'mute' };
    case 'mark':
      return { ...base, kind: 'mark', group: 'ui', title: e.label, tone: 'accent' };
    default:
      return { ...base, kind: 'custom', group: 'ui', title: e.label };
  }
}

function buildFeed(view: SessionView): FeedItem[] {
  const items: FeedItem[] = [];
  for (const e of view.timeline) items.push(timelineItem(e));
  for (const c of view.network) {
    items.push({
      id: c.id,
      ts: c.startMs,
      seq: c.seq,
      kind: 'net',
      group: 'net',
      title: `${c.method} ${c.path}`,
      sub: c.host,
      tone: isNetworkError(c) ? 'err' : c.state === 'pending' ? 'mute' : undefined,
      net: c,
    });
  }
  for (const l of view.logs) {
    if (l.kind === 'event') {
      const attrs = Object.entries(l.attributes)
        .slice(0, 3)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
      items.push({ id: l.id, ts: l.ts, seq: l.seq, kind: 'event', group: 'events', title: l.message, sub: attrs, tone: 'ok' });
    } else if (l.level === 'W' || l.level === 'E' || l.level === 'A') {
      items.push({
        id: l.id,
        ts: l.ts,
        seq: l.seq,
        kind: 'log',
        group: 'logs',
        title: `${l.tag}: ${l.message.split('\n', 1)[0]}`,
        tone: l.level === 'W' ? 'warn' : 'err',
        level: l.level,
      });
    }
  }
  for (const c of view.sessionCrashes) {
    items.push({
      id: c.id,
      ts: c.ts,
      seq: c.seq,
      kind: 'crash',
      group: 'crash',
      title: `${c.fatal ? 'CRASH' : 'Non-fatal'} ${shortClass(c.exception)}`,
      sub: c.message ?? undefined,
      tone: 'err',
      crash: c,
    });
  }
  items.sort((a, b) => a.ts - b.ts || a.seq - b.seq);
  return items;
}

/** Index of the last element with ts <= t (−1 if none). */
function lastAtOrBefore<T>(arr: readonly T[], t: number, ts: (x: T) => number): number {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ts(arr[mid]) <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

// ---------------------------------------------------------------- panel --

export function ReplayPanel() {
  const view = useSessionView();
  const focus = useStore(appStore, (s) => s.replayFocus);
  if (view.status === 'error') {
    return (
      <div className="panel">
        <EmptyState icon="warning" tone="error" title="Could not load this session">
          {view.error}
        </EmptyState>
      </div>
    );
  }
  if (view.status === 'loading' && !view.timeline.length) {
    return (
      <div className="panel">
        <Loading label="Loading session…" />
      </div>
    );
  }
  return <Replay key={`${view.key}:${view.sessionId}`} view={view} focus={focus} />;
}

function Replay({ view, focus }: { view: SessionView; focus: ReplayFocus | null }) {
  const live = view.kind === 'live';
  const now = useNow(1000, live);
  const timeline = view.timeline;
  const shots = useMemo(() => timeline.filter((e) => e.type === 'screenshot' && e.screenshotId), [timeline]);
  const taps = useMemo(() => timeline.filter((e) => e.type === 'tap'), [timeline]);
  const screens = useMemo(() => timeline.filter((e) => e.type === 'screen'), [timeline]);
  const feed = useMemo(() => buildFeed(view), [view]);
  const crash = view.crash;
  const firstTs = feed.length ? feed[0].ts : now;
  const start = Math.min(view.startMs ?? firstTs, firstTs);
  const end = live ? Math.max(now, feed.length ? feed[feed.length - 1].ts : now) : Math.max(view.endMs ?? start, crash ? crash.ts + 400 : 0, start + 1000);

  // Initial playhead: explicit focus (Watch killcam) → crash framing → live head → start.
  const [t, setT] = useState<number | null>(() => {
    if (focus) return Math.max(start, focus.ts - KILLCAM_MS);
    if (crash) return Math.max(start, crash.ts - KILLCAM_MS);
    return live ? null : start;
  });
  const [playing, setPlaying] = useState(() => !!focus?.autoplay);
  const [stopAt, setStopAt] = useState<number | null>(() => (focus ? focus.ts + 300 : null));
  const [speed, setSpeed] = useState<Speed>(1);
  const [zoom, setZoom] = useState<Zoom>(() => (crash || focus ? '60' : 'all'));
  const [drawer, setDrawer] = useState<{ type: 'net'; item: NetworkSummary } | { type: 'crash'; item: CrashSummary } | null>(null);
  const [seekNonce, setSeekNonce] = useState(0);
  const filters = useStore(feedFilterStore, (s) => s);

  useEffect(() => {
    if (focus) appStore.set({ replayFocus: null });
    // Only consume the focus that opened this replay.
  }, []);

  const tEff = t ?? end;

  // Playback loop (refs so a ticking `end` does not restart it).
  const ref = useRef({ t: tEff, end, stopAt, speed, live });
  ref.current = { t: tEff, end, stopAt, speed, live };
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (nowPerf: number) => {
      const r = ref.current;
      const dt = Math.min(250, nowPerf - last);
      last = nowPerf;
      let next = r.t + dt * r.speed;
      if (r.stopAt != null && r.t < r.stopAt && next >= r.stopAt) {
        setT(r.stopAt);
        setStopAt(null);
        setPlaying(false);
        return;
      }
      if (next >= r.end) {
        next = r.end;
        setT(r.live ? null : next);
        setPlaying(false);
        return;
      }
      ref.current.t = next;
      setT(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const seek = (ts: number, opts: { keepPlaying?: boolean } = {}) => {
    const clamped = Math.max(start, Math.min(end, ts));
    setT(live && clamped >= end - 50 ? null : clamped);
    setStopAt(null);
    if (!opts.keepPlaying) setPlaying(false);
    setSeekNonce((n) => n + 1);
  };

  const shotIdx = lastAtOrBefore(shots, tEff, (s) => s.ts);
  const shot = shotIdx >= 0 ? shots[shotIdx] : null;
  const screenIdx = lastAtOrBefore(screens, tEff, (s) => s.ts);
  const screenName = screenIdx >= 0 ? screens[screenIdx].label : (shot?.screen ?? null);

  const visibleTaps = useMemo(() => {
    const from = tEff - TAP_WINDOW_MS;
    const to = tEff + TAP_WINDOW_MS;
    const min = shot ? shot.ts - TAP_WINDOW_MS : -Infinity;
    return taps.filter((tp) => tp.ts >= from && tp.ts <= to && tp.ts >= min && typeof tp.data.x === 'number' && typeof tp.data.y === 'number');
  }, [taps, tEff, shot]);

  // Preload the next screenshots so playback does not flash.
  useEffect(() => {
    if (!playing) return;
    for (const s of shots.slice(shotIdx + 1, shotIdx + 4)) {
      const img = new Image();
      img.src = screenshotUrl(view.key, s.screenshotId!);
    }
  }, [playing, shotIdx, shots, view.key]);

  const visibleFeed = useMemo(() => feed.filter((i) => i.group === 'crash' || filters[i.group]), [feed, filters]);
  const activeIdx = lastAtOrBefore(visibleFeed, tEff, (i) => i.ts);

  // Relative labels: "−12.4s" before the crash / end of a saved session, "+mm:ss" into a live one.
  const refTs = crash ? crash.ts : live ? null : end;
  const rel = (ts: number) => (refTs != null ? fmtOffset(ts - refTs) : fmtElapsed(ts - start));

  const range = useMemo<[number, number]>(() => {
    if (zoom === 'all') return [start, end];
    const span = Number(zoom) * 1000;
    const anchor = crash ? crash.ts + 1000 : end;
    return [Math.max(start, anchor - span), Math.min(end, Math.max(anchor, start + 1000))];
  }, [zoom, start, end, crash]);
  // A seek outside the zoomed window widens it.
  useEffect(() => {
    if (zoom !== 'all' && (tEff < range[0] - 1 || tEff > range[1] + 1)) setZoom('all');
  }, [tEff, range, zoom]);

  const inKillcam = !!crash && tEff >= crash.ts - KILLCAM_MS && tEff <= crash.ts + 400;
  const crashed = !!crash && tEff >= crash.ts - 30;

  const stepShot = (d: number) => {
    if (!shots.length) return;
    if (d < 0) {
      const i = shot && tEff - shot.ts > 400 ? shotIdx : shotIdx - 1;
      seek(shots[Math.max(0, i)].ts);
    } else {
      seek(shots[Math.min(shots.length - 1, shotIdx + 1)].ts);
    }
  };
  const togglePlay = () => {
    if (playing) return setPlaying(false);
    if (tEff >= end - 20) seek(live ? Math.max(start, end - KILLCAM_MS) : start, { keepPlaying: true });
    setPlaying(true);
  };
  const playKillcam = () => {
    if (!crash) return;
    seek(crash.ts - KILLCAM_MS, { keepPlaying: true });
    setStopAt(crash.ts + 300);
    setPlaying(true);
  };

  useHotkeys({
    ' ': togglePlay,
    ArrowLeft: () => stepShot(-1),
    ArrowRight: () => stepShot(1),
    k: togglePlay,
    Escape: () => setDrawer(null),
  });

  const capture = async () => {
    try {
      const ev = await api.post<TimelineEvent | undefined>('screenshot');
      toast(ev ? 'Screenshot captured' : 'Nothing to capture (app in background?)', ev ? 'ok' : 'info');
    } catch (e) {
      toast(`Capture failed: ${errorMessage(e)}`, 'error');
    }
  };

  const openItem = (item: FeedItem) => {
    seek(item.ts);
    if (item.net) setDrawer({ type: 'net', item: item.net });
    else if (item.crash) setDrawer({ type: 'crash', item: item.crash });
  };

  const ar = shot && typeof shot.data.width === 'number' && typeof shot.data.height === 'number' && shot.data.height > 0 ? shot.data.width / shot.data.height : 360 / 780;

  return (
    <div className="panel replay">
      <div className="replay-stage">
        <div className="stage-hud">
          <span className="hud-screen" title="Screen at the playhead">
            <Icon name="screen" size={13} /> {screenName ?? '—'}
          </span>
          <span className="grow" />
          {inKillcam && (
            <span className="hud-killcam">
              <Icon name="skull" size={13} /> KILLCAM · last 15s before crash
            </span>
          )}
          {live && t === null && (
            <span className="hud-live">
              <span className="rec-dot" /> LIVE
            </span>
          )}
        </div>
        <div className="phone-wrap">
          <div className="phone" style={{ '--ar': String(ar) } as CSSProperties}>
            <div className="phone-screen">
              {shot ? (
                <ShotImage src={screenshotUrl(view.key, shot.screenshotId!)} alt={`Screenshot of ${shot.screen ?? 'the app'} at ${fmtClock(shot.ts)}`} />
              ) : (
                <div className="phone-empty">
                  <Icon name="camera" size={22} />
                  <span>{shots.length ? 'Before the first screenshot' : 'No screenshots in this session'}</span>
                </div>
              )}
              {visibleTaps.map((tp) => {
                const dtp = tEff - tp.ts;
                const past = dtp >= 0;
                const opacity = past ? 1 - dtp / TAP_WINDOW_MS : 0.55 - (-dtp / TAP_WINDOW_MS) * 0.4;
                return (
                  <span
                    key={tp.id}
                    className={past ? 'tap-marker' : 'tap-marker ghost'}
                    style={{ left: `${Number(tp.data.x) * 100}%`, top: `${Number(tp.data.y) * 100}%`, opacity: Math.max(0.12, opacity) }}
                    title={typeof tp.data.target === 'string' ? tp.data.target : tp.label}
                  >
                    <span className="tap-ripple" />
                    <span className="tap-dot" />
                  </span>
                );
              })}
              {crashed && crash && (
                <div className="crash-overlay">
                  <Icon name="skull" size={40} />
                  <b>{crash.fatal ? 'CRASHED' : 'NON-FATAL'}</b>
                  <span className="mono">{shortClass(crash.exception)}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="replay-transport">
        <Scrubber
          range={range}
          t={tEff}
          screens={screens}
          taps={taps}
          timeline={timeline}
          network={view.network}
          crashes={view.sessionCrashes}
          killcam={crash ? [crash.ts - KILLCAM_MS, crash.ts] : null}
          onSeek={(ts) => seek(ts)}
          rel={rel}
        />
        <div className="transport-row">
          <IconButton icon="skip-back" label="Previous screenshot (←)" onClick={() => stepShot(-1)} disabled={!shots.length} />
          <button type="button" className="btn btn-icon play-btn" onClick={togglePlay} aria-label={playing ? 'Pause (space)' : 'Play (space)'} title={playing ? 'Pause (space)' : 'Play (space)'}>
            <Icon name={playing ? 'pause' : 'play'} size={18} />
          </button>
          <IconButton icon="skip-fwd" label="Next screenshot (→)" onClick={() => stepShot(1)} disabled={!shots.length} />
          <Segmented<string>
            size="sm"
            label="Speed"
            value={String(speed)}
            onChange={(v) => setSpeed(Number(v) as Speed)}
            options={SPEEDS.map((s) => ({ value: String(s), label: `${s}×` }))}
          />
          <span className="t-readout tnum" title={fmtClock(tEff)}>
            <b>{rel(tEff)}</b>
            <span className="muted"> {fmtClock(tEff)}</span>
          </span>
          <span className="grow" />
          {crash && (
            <button type="button" className="btn killcam-btn sm" onClick={playKillcam} title="Replay the 15 seconds before the crash">
              <Icon name="skull" size={14} />
              <span>Killcam</span>
            </button>
          )}
          <Segmented<Zoom>
            size="sm"
            label="Scrubber range"
            value={zoom}
            onChange={setZoom}
            options={[
              { value: 'all', label: 'All', title: `Whole session (${fmtDuration(end - start)})` },
              { value: '60', label: '60s' },
              { value: '15', label: '15s' },
            ]}
          />
          {live && (
            <>
              <button
                type="button"
                className={t === null ? 'btn sm live-btn on' : 'btn sm live-btn'}
                onClick={() => {
                  setPlaying(false);
                  setT(null);
                }}
                title="Follow the live head"
              >
                <span className="rec-dot" /> Live
              </button>
              <IconButton icon="camera" label="Capture a screenshot now" onClick={capture} />
            </>
          )}
          <span className="muted tnum shot-count">
            {shots.length ? `${shotIdx + 1}/${shots.length}` : '0'} shots
          </span>
        </div>
      </div>

      <div className="replay-feed">
        <div className="feed-head">
          <div className="chips">
            {(
              [
                ['ui', 'UI'],
                ['net', 'Network'],
                ['logs', 'Logs'],
                ['events', 'Events'],
                ['shots', 'Shots'],
              ] as [FeedGroup, string][]
            ).map(([g, label]) => (
              <Chip key={g} on={filters[g]} onClick={() => feedFilterStore.set({ [g]: !filters[g] })}>
                {label}
              </Chip>
            ))}
          </div>
        </div>
        {visibleFeed.length === 0 ? (
          <EmptyState icon="replay" title="Nothing recorded yet">
            {live ? 'Screens, taps, calls and logs appear here as the app is used.' : 'This session has no events.'}
          </EmptyState>
        ) : (
          <VirtualList
            className="feed-list"
            count={visibleFeed.length}
            rowHeight={34}
            getKey={(i) => visibleFeed[i].id}
            scrollToIndex={activeIdx >= 0 ? activeIdx : 0}
            scrollNonce={seekNonce}
            scrollAlign="center"
            ariaLabel="Session events"
            renderRow={(i) => {
              const it = visibleFeed[i];
              const past = it.ts <= tEff;
              return (
                <button
                  type="button"
                  className={['feed-item', `tone-${it.tone ?? 'none'}`, `kind-${it.kind}`, i === activeIdx ? 'active' : '', past ? '' : 'future'].join(' ')}
                  onClick={() => openItem(it)}
                  title={`${fmtClock(it.ts)} · ${it.title}${it.sub ? ' · ' + it.sub : ''}`}
                >
                  <span className="f-time tnum">{rel(it.ts)}</span>
                  <span className="f-icon">
                    <Icon name={KIND_ICON[it.kind]} size={13} />
                  </span>
                  <span className="f-body">
                    <span className="f-title">
                      {it.net && <StatusPill call={it.net} />}
                      {it.level && <span className={`lvl lvl-${it.level}`}>{it.level}</span>}
                      <span className="f-text">{it.title}</span>
                    </span>
                    {it.sub && <span className="f-sub">{it.sub}</span>}
                  </span>
                </button>
              );
            }}
          />
        )}
      </div>

      {drawer && (
        <div className="drawer" role="dialog" aria-label="Event detail">
          {drawer.type === 'net' ? (
            <NetworkDetail
              key={drawer.item.id}
              summary={view.network.find((c) => c.id === drawer.item.id) ?? drawer.item}
              view={view}
              onClose={() => setDrawer(null)}
            />
          ) : (
            <CrashDetail key={drawer.item.id} crash={drawer.item} view={view} onClose={() => setDrawer(null)} hideWatch />
          )}
        </div>
      )}
    </div>
  );
}

/** Keeps showing the previous frame until the next one has loaded (no flash between shots). */
function ShotImage({ src, alt }: { src: string; alt: string }) {
  const [shown, setShown] = useState(src);
  useEffect(() => {
    if (src === shown) return;
    let cancelled = false;
    const img = new Image();
    img.onload = img.onerror = () => !cancelled && setShown(src);
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src, shown]);
  return <img className="shot" src={shown} alt={alt} draggable={false} />;
}

// -------------------------------------------------------------- scrubber --

interface ScrubberProps {
  range: [number, number];
  t: number;
  screens: TimelineEvent[];
  taps: TimelineEvent[];
  timeline: TimelineEvent[];
  network: NetworkSummary[];
  crashes: CrashSummary[];
  killcam: [number, number] | null;
  onSeek: (ts: number) => void;
  rel: (ts: number) => string;
}

function Scrubber({ range, t, onSeek, rel, ...marks }: ScrubberProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; ts: number } | null>(null);
  const [r0, r1] = range;
  const span = Math.max(1, r1 - r0);
  const pct = (ts: number) => ((ts - r0) / span) * 100;
  const tsAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return r0 + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * span;
  };
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    onSeek(tsAt(e.clientX));
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = ref.current!.getBoundingClientRect();
    setHover({ x: e.clientX - r.left, ts: tsAt(e.clientX) });
    if (e.buttons & 1) onSeek(tsAt(e.clientX));
  };
  const head = Math.max(0, Math.min(100, pct(t)));
  return (
    <div className="scrub-wrap">
      <div
        ref={ref}
        className="scrub"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHover(null)}
        role="slider"
        aria-label="Playhead"
        aria-valuemin={r0}
        aria-valuemax={r1}
        aria-valuenow={Math.round(t)}
        aria-valuetext={rel(t)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            e.stopPropagation();
            onSeek(t + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 5000 : 1000));
          }
        }}
      >
        <div className="scrub-track" />
        {marks.killcam && marks.killcam[1] >= r0 && (
          <div
            className="scrub-killcam"
            style={{ left: `${Math.max(0, pct(marks.killcam[0]))}%`, width: `${Math.min(100, pct(marks.killcam[1])) - Math.max(0, pct(marks.killcam[0]))}%` }}
            title="Last 15 s before the crash"
          />
        )}
        <div className="scrub-progress" style={{ width: `${head}%` }} />
        <Ticks range={range} {...marks} />
        <div className="scrub-head" style={{ left: `${head}%` }} />
        {hover && (
          <div className="scrub-hover tnum" style={{ left: hover.x }}>
            {rel(hover.ts)}
          </div>
        )}
      </div>
      <div className="scrub-labels tnum">
        <span>{rel(r0)}</span>
        <span>{rel(r1)}</span>
      </div>
    </div>
  );
}

const Ticks = memo(function Ticks({
  range,
  screens,
  taps,
  timeline,
  network,
  crashes,
}: Omit<ScrubberProps, 't' | 'onSeek' | 'rel' | 'killcam'>) {
  const [r0, r1] = range;
  const span = Math.max(1, r1 - r0);
  const inRange = (ts: number) => ts >= r0 && ts <= r1;
  const left = (ts: number) => `${((ts - r0) / span) * 100}%`;
  const marks = timeline.filter((e) => e.type === 'mark' && inRange(e.ts));
  const errors = network.filter((c) => isNetworkError(c) && inRange(c.startMs));
  return (
    <div className="ticks" aria-hidden>
      {screens.filter((s) => inRange(s.ts)).map((s) => (
        <span key={s.id} className="tick tick-screen" style={{ left: left(s.ts) }} title={`Screen: ${s.label}`} />
      ))}
      {taps.filter((s) => inRange(s.ts)).map((s) => (
        <span key={s.id} className="tick tick-tap" style={{ left: left(s.ts) }} />
      ))}
      {errors.map((c) => (
        <span key={c.id} className="tick tick-error" style={{ left: left(c.startMs) }} title={`${c.status ?? 'failed'} ${c.method} ${c.path}`} />
      ))}
      {marks.map((m) => (
        <span key={m.id} className="tick-mark" style={{ left: left(m.ts) }} title={`Mark: ${m.label}`}>
          <Icon name="flag" size={11} />
        </span>
      ))}
      {crashes.filter((c) => inRange(c.ts)).map((c) => (
        <span key={c.id} className={c.fatal ? 'tick-crash' : 'tick-crash nonfatal'} style={{ left: left(c.ts) }} title={`${c.fatal ? 'Crash' : 'Non-fatal'}: ${shortClass(c.exception)}`}>
          <Icon name={c.fatal ? 'skull' : 'bug'} size={13} />
        </span>
      ))}
    </div>
  );
});
