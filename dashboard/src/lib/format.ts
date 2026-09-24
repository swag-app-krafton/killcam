import type { NetworkSummary } from '../api/types';

/** A number in en-US grouping (swagperf's fmt): '–' when there is none. */
export const fmt = (v: number | null | undefined, dp = 0): string =>
  v == null || !Number.isFinite(v) ? '–' : v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });

/** "1 call", "3 calls": every count carries its unit. */
export const plural = (n: number, one: string, many = one + 's'): string => `${fmt(n)} ${n === 1 ? one : many}`;

export function fmtBytes(n: number | null | undefined): string {
  if (n == null || n < 0) return '–';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return '–';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** 12:30:01.123 */
export function fmtClock(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** 12:30:01 */
export function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Sep 24, 12:30 (adds the year when it is not this year) */
export function fmtDateTime(ts: number, seconds = false): string {
  const d = new Date(ts);
  const y = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${y}, ${pad(d.getHours())}:${pad(d.getMinutes())}${seconds ? ':' + pad(d.getSeconds()) : ''}`;
}

export function fmtAgo(ts: number, now = Date.now()): string {
  const s = Math.round((now - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** Signed offset: "-12.4s", "-2:05.3", "+0:31". */
export function fmtOffset(ms: number, precise = true): string {
  const sign = ms < 0 ? '-' : '+';
  const a = Math.abs(ms);
  if (a < 60_000) return `${sign}${(a / 1000).toFixed(precise ? 1 : 0)}s`;
  const m = Math.floor(a / 60_000);
  const s = (a % 60_000) / 1000;
  return `${sign}${m}:${precise ? s.toFixed(1).padStart(4, '0') : pad(Math.floor(s))}`;
}

/** Elapsed since session start: "+02:31" (or "+1:02:31"). */
export function fmtElapsed(ms: number): string {
  const a = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(a / 3600);
  const m = Math.floor((a % 3600) / 60);
  const s = a % 60;
  return h ? `+${h}:${pad(m)}:${pad(s)}` : `+${pad(m)}:${pad(s)}`;
}

export type StatusClass = 'pending' | 'failed' | '1xx' | '2xx' | '3xx' | '4xx' | '5xx';

export function statusClass(c: Pick<NetworkSummary, 'state' | 'status'>): StatusClass {
  if (c.state === 'pending') return 'pending';
  if (c.state === 'failed' || c.status == null) return 'failed';
  if (c.status >= 500) return '5xx';
  if (c.status >= 400) return '4xx';
  if (c.status >= 300) return '3xx';
  if (c.status >= 200) return '2xx';
  return '1xx';
}

export function isNetworkError(c: Pick<NetworkSummary, 'state' | 'status'>): boolean {
  const k = statusClass(c);
  return k === 'failed' || k === '4xx' || k === '5xx';
}

export function shortClass(fqcn: string): string {
  const i = fqcn.lastIndexOf('.');
  return i >= 0 ? fqcn.slice(i + 1) : fqcn;
}

/** Epoch millis between 2000 and 2100: probably a timestamp worth decoding. */
export function looksLikeEpochMs(v: unknown): v is number {
  return typeof v === 'number' && v > 946_684_800_000 && v < 4_102_444_800_000;
}

export function fmtPaise(p: number): string {
  return '₹' + (p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}
