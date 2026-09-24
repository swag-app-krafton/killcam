import { createStore } from '../state/store';

/** An HTTP failure from the device, carrying the `{ error }` code when there is one. */
export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiFailure) {
    if (e.status === 0) return 'Device unreachable';
    return `${e.code} (${e.status})`;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

/** 501 from a storage provider that this build does not expose (e.g. "prefs_unavailable"). */
export function isUnavailable(e: unknown): e is ApiFailure {
  return e instanceof ApiFailure && e.status === 501;
}

type Query = Record<string, string | number | boolean | null | undefined>;

/** Relative to the page so the dashboard works at "/" on the device and behind the dev proxy. */
export function apiUrl(path: string, query?: Query): string {
  let url = 'api/' + path.replace(/^\/+/, '').replace(/^api\//, '');
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v != null && v !== '') qs.set(k, String(v));
    const s = qs.toString();
    if (s) url += (url.includes('?') ? '&' : '?') + s;
  }
  return url;
}

export const enc = encodeURIComponent;

// ------------------------------------------------------------------- auth --

export interface AuthState {
  needPin: boolean;
  busy: boolean;
  error: string | null;
}
export const authStore = createStore<AuthState>({ needPin: false, busy: false, error: null });

let pinWaiters: (() => void)[] = [];
const authListeners = new Set<() => void>();

/** Called after a successful PIN entry (the live stream reconnects). */
export function onAuthenticated(fn: () => void): () => void {
  authListeners.add(fn);
  return () => {
    authListeners.delete(fn);
  };
}

/** Parks the caller until the PIN screen succeeds. */
export function waitForPin(): Promise<void> {
  authStore.set({ needPin: true });
  return new Promise((resolve) => pinWaiters.push(resolve));
}

export async function submitPin(pin: string): Promise<boolean> {
  authStore.set({ busy: true, error: null });
  try {
    const res = await fetch(apiUrl('auth'), {
      method: 'POST',
      headers: WRITE_HEADERS,
      body: JSON.stringify({ pin }),
      credentials: 'same-origin',
    });
    if (res.ok) {
      authStore.set({ needPin: false, busy: false, error: null });
      const waiters = pinWaiters;
      pinWaiters = [];
      waiters.forEach((w) => w());
      authListeners.forEach((f) => f());
      return true;
    }
    authStore.set({ busy: false, error: res.status === 401 ? 'Wrong PIN, try again.' : `Failed (${res.status})` });
  } catch {
    authStore.set({ busy: false, error: 'Device unreachable.' });
  }
  return false;
}

// ---------------------------------------------------------------- request --

const WRITE_HEADERS: Record<string, string> = {
  'X-Killcam': '1',
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
  /** Return the body as text regardless of content type. */
  text?: boolean;
  /** Return the raw bytes. */
  bytes?: boolean;
}

async function readError(res: Response): Promise<string> {
  try {
    const t = await res.text();
    try {
      const j = JSON.parse(t) as { error?: unknown };
      if (j && typeof j.error === 'string') return j.error;
    } catch {
      /* not JSON */
    }
    return t.slice(0, 200) || res.statusText || 'error';
  } catch {
    return res.statusText || 'error';
  }
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  for (;;) {
    let res: Response;
    try {
      res = await fetch(apiUrl(path, opts.query), {
        method,
        headers: method === 'GET' ? { Accept: 'application/json' } : WRITE_HEADERS,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: opts.signal,
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      throw new ApiFailure(0, 'unreachable');
    }
    if (res.status === 401) {
      const code = await readError(res);
      if (code === 'pin_required') {
        await waitForPin();
        continue;
      }
      throw new ApiFailure(401, code);
    }
    if (!res.ok) throw new ApiFailure(res.status, await readError(res));
    if (res.status === 204) return undefined as T;
    if (opts.bytes) return (await res.arrayBuffer()) as T;
    const type = res.headers.get('content-type') ?? '';
    if (!opts.text && type.includes('json')) return (await res.json()) as T;
    return (await res.text()) as T;
  }
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>(path, { query, signal }),
  text: (path: string, query?: Query, signal?: AbortSignal) => request<string>(path, { query, signal, text: true }),
  bytes: (path: string, query?: Query, signal?: AbortSignal) => request<ArrayBuffer>(path, { query, signal, bytes: true }),
  post: <T>(path: string, body?: unknown, query?: Query) => request<T>(path, { method: 'POST', body, query }),
  put: <T>(path: string, body?: unknown, query?: Query) => request<T>(path, { method: 'PUT', body, query }),
  del: <T = void>(path: string, query?: Query) => request<T>(path, { method: 'DELETE', query }),
};
