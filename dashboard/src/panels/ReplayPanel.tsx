import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { Badge, Button, EmptyState, Segmented, Spacer, StatusSquare, Swatch, Text, ToggleChip, niceTicks } from '@/design';
import { api, errorMessage } from '../api/client';
import type { CrashSummary, LogLevel, NetworkSummary, TimelineEvent } from '../api/types';
import { HttpStatus, IconBtn } from '../kit/controls';
import { KIcon } from '../kit/Icon';
import { Dock } from '../kit/overlays';
import { VirtualList } from '../kit/VirtualList';
import { fmt, fmtClock, fmtDuration, fmtElapsed, fmtOffset, isNetworkError, shortClass } from '../lib/format';
import { useHotkeys, useNow } from '../lib/hooks';
import { appStore, type ReplayFocus } from '../state/app';
import { screenshotUrl, useSessionView, type SessionView } from '../state/session';
import { createStore, useStore } from '../state/store';
import { toast } from '../state/ui';
import { CrashBody } from './crashDetail';
import { NetworkDetail } from './NetworkDetail';
import s from './Replay.module.css';

const LAST_MS = 15_000;
const TAP_WINDOW_MS = 1_500;
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
  tone?: 'fail' | 'warn' | 'pass' | 'mark' | 'screen' | 'muted';
  net?: NetworkSummary;
  crash?: CrashSummary;
  level?: LogLevel;
}

const GROUPS: { id: FeedGroup; label: string }[] = [
  { id: 'ui', label: 'Screens and taps' },
  { id: 'net', label: 'Network' },
  { id: 'logs', label: 'Warnings and errors' },
  { id: 'events', label: 'Analytics' },
  { id: 'shots', label: 'Screenshots' },
];
const feedFilterStore = createStore<Record<FeedGroup, boolean>>({ ui: true, net: true, logs: true, events: true, shots: false });

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
      return { ...base, kind: 'screen', group: 'ui', title: e.label, sub: 'Screen', tone: 'screen' };
    case 'tap': {
      const gesture = typeof e.data.gesture === 'string' ? e.data.gesture : 'tap';
      const verb = gesture === 'swipe' ? 'Swipe' : gesture === 'long_press' ? 'Long press' : 'Tap';
      // Compose and React Native taps have no named target, only a position.
      const target = typeof e.data.target === 'string' && e.data.target ? e.data.target : null;
      return { ...base, kind: 'tap', group: 'ui', title: target ? `${verb} ${target}` : verb };
    }
    case 'lifecycle':
      return { ...base, kind: 'lifecycle', group: 'ui', title: e.label, tone: 'muted' };
    case 'screenshot':
      return { ...base, kind: 'screenshot', group: 'shots', title: 'Screenshot', sub: e.screen ?? undefined, tone: 'muted' };
    case 'mark':
      return { ...base, kind: 'mark', group: 'ui', title: e.label, sub: 'Marked moment', tone: 'mark' };
    default:
      return { ...base, kind: 'custom', group: 'ui', title: e.label };
  }
}

function buildFeed(view: SessionView): FeedItem[] {
  const items: FeedItem[] = view.timeline.map(timelineItem);
  for (const c of view.network) {
    items.push({ id: c.id, ts: c.startMs, seq: c.seq, kind: 'net', group: 'net', title: `${c.method} ${c.path}`, sub: c.host, tone: isNetworkError(c) ? 'fail' : undefined, net: c });
  }
  for (const l of view.logs) {
    if (l.kind === 'event') {
      const attrs = Object.entries(l.attributes)
        .slice(0, 3)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
      items.push({ id: l.id, ts: l.ts, seq: l.seq, kind: 'event', group: 'events', title: l.message, sub: attrs || 'Analytics event', tone: 'pass' });
    } else if (l.level === 'W' || l.level === 'E' || l.level === 'A') {
      items.push({ id: l.id, ts: l.ts, seq: l.seq, kind: 'log', group: 'logs', title: l.message.split('\n', 1)[0], sub: `${l.level === 'W' ? 'Warning' : 'Error'} · ${l.tag}`, tone: l.level === 'W' ? 'warn' : 'fail', level: l.level });
    }
  }
  for (const c of view.sessionCrashes) {
    items.push({ id: c.id, ts: c.ts, seq: c.seq, kind: 'crash', group: 'crash', title: `${c.fatal ? 'Crash' : 'Non-fatal error'}: ${shortClass(c.exception)}`, sub: c.message ?? undefined, tone: c.fatal ? 'fail' : 'warn', crash: c });
  }
  // Timestamps first, then the order they were recorded in.
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
  const focus = useStore(appStore, (x) => x.replayFocus);
  if (view.status === 'error') return <EmptyState title="Could not load this session">{view.error}</EmptyState>;
  if (view.status === 'loading' && !view.timeline.length) return <EmptyState>Loading the session…</EmptyState>;
  return <Replay key={`${view.key}:${view.sessionId}`} view={view} focus={focus} />;
}

function Replay({ view, focus }: { view: SessionView; focus: ReplayFocus | null }) {
  const live = view.kind === 'live';
  const now = useNow(1000, live);
  const embed = useStore(appStore, (x) => x.embed);
  const timeline = view.timeline;
  const shots = useMemo(() => timeline.filter((e) => e.type === 'screenshot' && e.screenshotId), [timeline]);
  const taps = useMemo(() => timeline.filter((e) => e.type === 'tap'), [timeline]);
  const screens = useMemo(() => timeline.filter((e) => e.type === 'screen'), [timeline]);
  const feed = useMemo(() => buildFeed(view), [view]);
  const crash = view.crash;
  const firstTs = feed.length ? feed[0].ts : now;
  const start = Math.min(view.startMs ?? firstTs, firstTs);
  const end = live ? Math.max(now, feed.length ? feed[feed.length - 1].ts : now) : Math.max(view.endMs ?? start, crash ? crash.ts + 400 : 0, start + 1000);

  // Where the playhead starts: a requested moment, a crash's last 15 s, the live head, or the start.
  const [t, setT] = useState<number | null>(() => {
    if (focus) return Math.max(start, focus.ts - LAST_MS);
    if (crash) return Math.max(start, crash.ts - LAST_MS);
    return live ? null : start;
  });
  const [playing, setPlaying] = useState(() => !!focus?.autoplay);
  const [stopAt, setStopAt] = useState<number | null>(() => (focus ? focus.ts + 300 : null));
  const [speed, setSpeed] = useState<'1' | '2' | '4'>('1');
  const [zoom, setZoom] = useState<Zoom>(() => (crash || focus ? '60' : 'all'));
  const [drawer, setDrawer] = useState<{ type: 'net'; item: NetworkSummary } | { type: 'crash'; item: CrashSummary } | null>(null);
  const [seekNonce, setSeekNonce] = useState(0);
  const filters = useStore(feedFilterStore, (x) => x);

  useEffect(() => {
    if (focus) appStore.set({ replayFocus: null });
    // Only the focus that opened this replay is consumed.
  }, []);

  const tEff = t ?? end;

  // Playback (refs, so a ticking `end` does not restart the loop).
  const ref = useRef({ t: tEff, end, stopAt, speed: Number(speed), live });
  ref.current = { t: tEff, end, stopAt, speed: Number(speed), live };
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (nowPerf: number) => {
      const r = ref.current;
      const dt = Math.min(250, nowPerf - last);
      last = nowPerf;
      const next = r.t + dt * r.speed;
      if (r.stopAt != null && r.t < r.stopAt && next >= r.stopAt) {
        setT(r.stopAt);
        setStopAt(null);
        setPlaying(false);
        return;
      }
      if (next >= r.end) {
        setT(r.live ? null : r.end);
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

  const shotIdx = lastAtOrBefore(shots, tEff, (x) => x.ts);
  const shot = shotIdx >= 0 ? shots[shotIdx] : null;
  const screenIdx = lastAtOrBefore(screens, tEff, (x) => x.ts);
  const screenName = screenIdx >= 0 ? screens[screenIdx].label : (shot?.screen ?? null);
  const visibleTaps = useMemo(() => {
    const min = shot ? shot.ts - TAP_WINDOW_MS : -Infinity;
    return taps.filter((tp) => tp.ts >= tEff - TAP_WINDOW_MS && tp.ts <= tEff + TAP_WINDOW_MS && tp.ts >= min && typeof tp.data.x === 'number' && typeof tp.data.y === 'number');
  }, [taps, tEff, shot]);

  useEffect(() => {
    if (!playing) return;
    for (const x of shots.slice(shotIdx + 1, shotIdx + 4)) new Image().src = screenshotUrl(view.key, x.screenshotId!);
  }, [playing, shotIdx, shots, view.key]);

  const visibleFeed = useMemo(() => feed.filter((i) => i.group === 'crash' || filters[i.group]), [feed, filters]);
  const activeIdx = lastAtOrBefore(visibleFeed, tEff, (i) => i.ts);

  // "−12.4 s" before the crash or the end of a saved session; "+02:31" into a live one.
  const refTs = crash ? crash.ts : live ? null : end;
  const rel = (ts: number) => (refTs != null ? fmtOffset(ts - refTs).replace(/s$/, ' s') : fmtElapsed(ts - start));

  const range = useMemo<[number, number]>(() => {
    if (zoom === 'all') return [start, end];
    const anchor = crash ? crash.ts + 1000 : end;
    return [Math.max(start, anchor - Number(zoom) * 1000), Math.min(end, Math.max(anchor, start + 1000))];
  }, [zoom, start, end, crash]);
  useEffect(() => {
    if (zoom !== 'all' && (tEff < range[0] - 1 || tEff > range[1] + 1)) setZoom('all');
  }, [tEff, range, zoom]);

  const inLast = !!crash && tEff >= crash.ts - LAST_MS && tEff <= crash.ts + 400;
  const crashed = !!crash && tEff >= crash.ts - 30;

  const stepShot = (d: number) => {
    if (!shots.length) return;
    if (d < 0) seek(shots[Math.max(0, shot && tEff - shot.ts > 400 ? shotIdx : shotIdx - 1)].ts);
    else seek(shots[Math.min(shots.length - 1, shotIdx + 1)].ts);
  };
  const togglePlay = () => {
    if (playing) return setPlaying(false);
    if (tEff >= end - 20) seek(live ? Math.max(start, end - LAST_MS) : start, { keepPlaying: true });
    setPlaying(true);
  };
  const replayLast = () => {
    if (!crash) return;
    seek(crash.ts - LAST_MS, { keepPlaying: true });
    setStopAt(crash.ts + 300);
    setPlaying(true);
  };
  useHotkeys({ ' ': togglePlay, k: togglePlay, ArrowLeft: () => stepShot(-1), ArrowRight: () => stepShot(1) });

  const capture = async () => {
    try {
      const ev = await api.post<TimelineEvent | undefined>('screenshot');
      toast(ev ? 'Screenshot taken' : 'Nothing to capture: the app is not in the foreground', ev ? 'ok' : 'info');
    } catch (e) {
      toast(`Could not take a screenshot: ${errorMessage(e)}`, 'error');
    }
  };
  const openItem = (item: FeedItem) => {
    seek(item.ts);
    if (item.net) setDrawer({ type: 'net', item: item.net });
    else if (item.crash) setDrawer({ type: 'crash', item: item.crash });
  };

  const ar = shot && typeof shot.data.width === 'number' && typeof shot.data.height === 'number' && shot.data.height > 0 ? shot.data.width / shot.data.height : 360 / 780;

  if (!feed.length) {
    return (
      <EmptyState title="Nothing recorded yet">
        {live
          ? 'Screens, taps, calls and logs appear here as the app is used. Screen names come from Killcam.screen(); screenshots are taken on screen changes and taps.'
          : 'This session was saved before anything was recorded.'}
      </EmptyState>
    );
  }

  return (
    <div className={s.wrap}>
      <div className={s.grid}>
        <section className={s.card} aria-label="Player">
          <div className={s.hud}>
            <Text variant="label">Screen</Text>
            <Text variant="ui" weight={600} truncate>
              {screenName ?? 'not recorded'}
            </Text>
            <Spacer />
            {inLast && <Badge tone="neutral">Last 15 s before the crash</Badge>}
            {live && t === null && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Swatch color="var(--fail)" shape="circle" pulse />
                <Text variant="small">Following live</Text>
              </span>
            )}
          </div>
          <div className={s.stage}>
            <div className={s.phone} style={{ '--ar': String(ar) } as CSSProperties}>
              <div className={s.screen}>
                {shot ? (
                  <ShotImage src={screenshotUrl(view.key, shot.screenshotId!)} alt={`${shot.screen ?? 'The app'} at ${fmtClock(shot.ts)}`} />
                ) : (
                  <div className={s.noShot}>{shots.length ? 'Before the first screenshot' : 'No screenshots in this session'}</div>
                )}
                {visibleTaps.map((tp) => {
                  const d = tEff - tp.ts;
                  const past = d >= 0;
                  const opacity = past ? 1 - d / TAP_WINDOW_MS : 0.55 + (d / TAP_WINDOW_MS) * 0.4;
                  return (
                    <span
                      key={tp.id}
                      className={past ? s.tap : `${s.tap} ${s.ghost}`}
                      style={{ left: `${Number(tp.data.x) * 100}%`, top: `${Number(tp.data.y) * 100}%`, opacity: Math.max(0.12, opacity) }}
                      title={typeof tp.data.target === 'string' ? tp.data.target : tp.label}
                    >
                      <span className={s.tapRipple} />
                      <span className={s.tapDot} />
                    </span>
                  );
                })}
                {crashed && crash && (
                  <div className={s.crashed} role="status">
                    <StatusSquare tone={crash.fatal ? 'fail' : 'warn'} size={28} />
                    {crash.fatal ? 'The app crashed here' : 'A non-fatal error was recorded here'}
                    <code>{shortClass(crash.exception)}</code>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className={s.transport}>
            <Scrubber
              range={range}
              t={tEff}
              screens={screens}
              taps={taps}
              timeline={timeline}
              network={view.network}
              crash={crash}
              lastWindow={crash ? [crash.ts - LAST_MS, crash.ts] : null}
              onSeek={(ts) => seek(ts)}
              rel={rel}
            />
            <div className={s.controls}>
              <IconBtn icon="skip-back" outlined size={embed ? 'lg' : 'md'} label="Previous screenshot (←)" onClick={() => stepShot(-1)} disabled={!shots.length} />
              <Button variant="primary" size="sm" onClick={togglePlay} aria-label={playing ? 'Pause (space)' : 'Play (space)'} style={embed ? { height: 40 } : undefined}>
                <KIcon name={playing ? 'pause' : 'play'} size={14} />
                {playing ? 'Pause' : 'Play'}
              </Button>
              <IconBtn icon="skip-fwd" outlined size={embed ? 'lg' : 'md'} label="Next screenshot (→)" onClick={() => stepShot(1)} disabled={!shots.length} />
              <Segmented
                label="Playback speed"
                value={speed}
                onChange={setSpeed}
                options={[
                  { value: '1', label: '1×' },
                  { value: '2', label: '2×' },
                  { value: '4', label: '4×' },
                ]}
              />
              <span className={s.readout} title={fmtClock(tEff)}>
                <Text variant="mono" tone="primary" weight={600}>
                  {rel(tEff)}
                </Text>
                <Text variant="meta">{fmtClock(tEff)}</Text>
              </span>
              <Spacer />
              {crash && (
                <Button variant="secondary" size="sm" onClick={replayLast} title="Play the 15 s before the crash">
                  Replay the last 15 s
                </Button>
              )}
              <Segmented<Zoom>
                label="Time range"
                value={zoom}
                onChange={setZoom}
                options={[
                  { value: 'all', label: `Whole session · ${fmtDuration(end - start)}` },
                  { value: '60', label: 'Last 60 s' },
                  { value: '15', label: 'Last 15 s' },
                ]}
              />
              {live && (
                <>
                  <Button
                    variant="outline"
                    disabled={t === null}
                    onClick={() => {
                      setPlaying(false);
                      setT(null);
                    }}
                  >
                    {t === null ? 'Following live' : 'Follow live'}
                  </Button>
                  <IconBtn icon="camera" outlined size={embed ? 'lg' : 'md'} label="Take a screenshot now" onClick={capture} />
                </>
              )}
              <Text variant="meta">
                {shots.length ? `${fmt(shotIdx + 1)} of ${fmt(shots.length)} screenshots` : 'No screenshots'}
              </Text>
            </div>
          </div>
        </section>

        <section className={s.card} aria-label="Events">
          <div className={s.feedHead}>
            <Text as="h2" variant="heading-sm">
              Events · {fmt(visibleFeed.length)}
            </Text>
            <div className={s.chips}>
              {GROUPS.map((g) => (
                <ToggleChip key={g.id} pressed={filters[g.id]} onClick={() => feedFilterStore.set({ [g.id]: !filters[g.id] })}>
                  {g.label}
                </ToggleChip>
              ))}
            </div>
          </div>
          <div className={s.feed}>
            {visibleFeed.length === 0 ? (
              <div style={{ padding: 16 }}>
                <EmptyState title="Every kind of event is filtered out" />
              </div>
            ) : (
              <VirtualList
                count={visibleFeed.length}
                rowHeight={46}
                getKey={(i) => visibleFeed[i].id}
                scrollToIndex={activeIdx >= 0 ? activeIdx : 0}
                scrollNonce={seekNonce}
                scrollAlign="center"
                ariaLabel="Session events"
                renderRow={(i) => <FeedRow item={visibleFeed[i]} active={i === activeIdx} future={visibleFeed[i].ts > tEff} rel={rel} onOpen={openItem} />}
              />
            )}
          </div>
        </section>
      </div>

      {drawer?.type === 'net' && (
        <NetworkDetail key={drawer.item.id} summary={view.network.find((c) => c.id === drawer.item.id) ?? drawer.item} view={view} onClose={() => setDrawer(null)} closeOnBack />
      )}
      {drawer?.type === 'crash' && (
        <Dock label="Crash detail" title={drawer.item.fatal ? 'Crash' : 'Non-fatal error'} subtitle={shortClass(drawer.item.exception)} onClose={() => setDrawer(null)} closeOnBack>
          <CrashBody crash={drawer.item} view={view} showReplay={false} />
        </Dock>
      )}
    </div>
  );
}

const GLYPH_CLASS: Record<NonNullable<FeedItem['tone']>, string> = { fail: s.gFail, warn: s.gWarn, pass: s.gPass, mark: s.gMark, screen: s.gScreen, muted: '' };

const FeedRow = memo(function FeedRow({ item: it, active, future, rel, onOpen }: { item: FeedItem; active: boolean; future: boolean; rel: (ts: number) => string; onOpen: (i: FeedItem) => void }) {
  return (
    <button
      type="button"
      className={[s.item, active && s.active, future && s.future].filter(Boolean).join(' ')}
      onClick={() => onOpen(it)}
      title={`${fmtClock(it.ts)} · ${it.title}${it.sub ? ` · ${it.sub}` : ''}`}
      aria-current={active || undefined}
    >
      <span className={s.when}>{rel(it.ts)}</span>
      <span className={`${s.glyph} ${it.tone ? GLYPH_CLASS[it.tone] : ''}`}>
        <KIcon name={KIND_ICON[it.kind]} size={13} />
      </span>
      <span className={s.body}>
        <span className={s.title}>
          {it.net && <HttpStatus call={it.net} />}
          <span className={[s.titleText, it.kind === 'screen' || it.kind === 'crash' ? s.strong : '', it.kind === 'net' ? s.mono : '', it.tone === 'fail' && it.kind !== 'crash' ? s.failText : ''].join(' ')}>
            {it.title}
          </span>
        </span>
        {it.sub && <span className={s.sub}>{it.sub}</span>}
      </span>
    </button>
  );
});

/** Keeps the previous frame until the next has loaded, so playback does not flash. */
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
  return <img className={s.shot} src={shown} alt={alt} draggable={false} />;
}

// -------------------------------------------------------------- scrubber --

interface ScrubberProps {
  range: [number, number];
  t: number;
  screens: TimelineEvent[];
  taps: TimelineEvent[];
  timeline: TimelineEvent[];
  network: NetworkSummary[];
  crash: CrashSummary | null;
  lastWindow: [number, number] | null;
  onSeek: (ts: number) => void;
  rel: (ts: number) => string;
}

/** The session on one axis: screen visits as bands (BandedTimeline's), taps,
 *  failed calls and marks as ticks, the crash as a marker (SpanTimeline's).
 *  Click or drag to seek; ←/→ step 1 s (Shift: 5 s). */
function Scrubber({ range, t, onSeek, rel, ...marks }: ScrubberProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; ts: number } | null>(null);
  const [r0, r1] = range;
  const span = Math.max(1, r1 - r0);
  const tsAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return r0 + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * span;
  };
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    onSeek(tsAt(e.clientX));
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const r = ref.current!.getBoundingClientRect();
    setHover({ x: e.clientX - r.left, ts: tsAt(e.clientX) });
    if (e.buttons & 1) onSeek(tsAt(e.clientX));
  };
  const pct = Math.max(0, Math.min(100, ((t - r0) / span) * 100));
  return (
    <div
      className={s.scrub}
      role="slider"
      tabIndex={0}
      aria-label="Playhead"
      aria-valuemin={r0}
      aria-valuemax={r1}
      aria-valuenow={Math.round(t)}
      aria-valuetext={rel(t)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopPropagation();
          onSeek(t + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 5000 : 1000));
        }
      }}
    >
      <Marks range={range} {...marks} />
      <div ref={ref} className={s.track} onPointerDown={down} onPointerMove={move} onPointerLeave={() => setHover(null)} style={{ position: 'absolute', left: 0, right: 0, top: 18, background: 'transparent' }}>
        <div className={s.head} style={{ left: `${pct}%` }} />
        {hover && (
          <div className={s.tip} style={{ left: hover.x }}>
            {rel(hover.ts)}
          </div>
        )}
      </div>
      <Axis range={range} rel={rel} />
    </div>
  );
}

const Marks = memo(function Marks({ range, screens, taps, timeline, network, crash, lastWindow }: Omit<ScrubberProps, 't' | 'onSeek' | 'rel'>) {
  const [r0, r1] = range;
  const span = Math.max(1, r1 - r0);
  const X = (ts: number) => ((ts - r0) / span) * 100;
  const inRange = (ts: number) => ts >= r0 && ts <= r1;
  // Screen visits: each lasts until the next screen.
  const bands = screens
    .map((sc, i) => ({ label: sc.label, start: Math.max(sc.ts, r0), end: Math.min(screens[i + 1]?.ts ?? r1, r1), key: sc.id }))
    .filter((b) => b.end > b.start);
  const errors = network.filter((c) => isNetworkError(c) && inRange(c.startMs));
  const marksTl = timeline.filter((e) => e.type === 'mark' && inRange(e.ts));
  return (
    <>
      <div className={s.bandLabels} aria-hidden>
        {bands.map((b) =>
          X(b.end) - X(b.start) > 7 ? (
            <span key={b.key} className={s.bandLabel} style={{ left: `${X(b.start)}%`, width: `${X(b.end) - X(b.start)}%` }}>
              {b.label}
            </span>
          ) : null,
        )}
      </div>
      <div className={s.track} aria-hidden>
        {bands.map((b, i) => (
          <div key={b.key} className={i % 2 ? `${s.band} ${s.bandAlt}` : s.band} style={{ left: `${X(b.start)}%`, width: `${Math.max(X(b.end) - X(b.start), 0.2)}%` }} title={b.label} />
        ))}
        {lastWindow && lastWindow[1] >= r0 && <div className={s.window} style={{ left: `${Math.max(0, X(lastWindow[0]))}%`, width: `${Math.min(100, X(lastWindow[1])) - Math.max(0, X(lastWindow[0]))}%` }} />}
        {taps.filter((tp) => inRange(tp.ts)).map((tp) => (
          <span key={tp.id} className={s.tapTick} style={{ left: `${X(tp.ts)}%` }} />
        ))}
        {errors.map((c) => (
          <span key={c.id} className={s.errTick} style={{ left: `${X(c.startMs)}%` }} title={`✕ ${c.status ?? 'No response'} ${c.method} ${c.path}`} />
        ))}
        {marksTl.map((m) => (
          <span key={m.id} className={s.markTick} style={{ left: `${X(m.ts)}%` }} title={`Marked: ${m.label}`} />
        ))}
        {crash && inRange(crash.ts) && (
          <div className={X(crash.ts) > 80 ? `${s.marker} ${s.flip}` : s.marker} style={{ left: `${X(crash.ts)}%` }}>
            <span className={s.markerLabel}>{crash.fatal ? '✕ Crash' : '! Non-fatal'}</span>
          </div>
        )}
      </div>
    </>
  );
});

function Axis({ range, rel }: { range: [number, number]; rel: (ts: number) => string }) {
  const [r0, r1] = range;
  const span = Math.max(1, r1 - r0);
  // Ticks on whole seconds of the session, labelled like the feed.
  const secs = niceTicks(0, span / 1000).filter((x) => x <= span / 1000);
  return (
    <div className={s.ticks} aria-hidden>
      {secs.map((sec, i) => (
        <span key={sec} className={i === 0 ? `${s.tick} ${s.first}` : i === secs.length - 1 && sec > span / 1000 - span / 1000 / 12 ? `${s.tick} ${s.last}` : s.tick} style={{ left: `${((sec * 1000) / span) * 100}%` }}>
          {rel(r0 + sec * 1000)}
        </span>
      ))}
    </div>
  );
}
