import type { Endpoint, NetworkSummary } from '../api/types';
import { compilePattern } from './match';

/** Does this catalog endpoint cover the call? Same rules as the device's mock matching. */
export function endpointMatcher(e: Endpoint): (method: string, url: string) => boolean {
  const pattern = compilePattern(e.matchType, e.urlPattern);
  return (method, url) => (e.method == null || e.method === method) && pattern.test(url);
}

const ID_SEGMENT = [
  /^\d+$/, // 12345
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // uuid
  /^[0-9a-f]{12,}$/i, // hashes
  /^(?=.*\d)[A-Za-z0-9_-]{8,}$/, // SWG2609242LP9MS8HHS, 8Q2K1abc
];

/** "/v1/transactions/SWG26092?x=1" → "/v1/transactions/*": ids collapsed so one endpoint covers them all. */
export function normalizePath(path: string): string {
  const clean = path.split('?')[0].split('#')[0];
  return clean
    .split('/')
    .map((seg) => (seg && ID_SEGMENT.some((re) => re.test(seg)) ? '*' : seg))
    .join('/');
}

export interface Discovered {
  method: string;
  host: string;
  path: string;
  calls: number;
  sampleUrl: string;
}

/** Paths in captured traffic that no endpoint covers, most-called first. */
export function discover(network: NetworkSummary[], endpoints: Endpoint[]): Discovered[] {
  const matchers = endpoints.map(endpointMatcher);
  const found = new Map<string, Discovered>();
  for (const c of network) {
    if (c.source === 'repeat' || matchers.some((m) => m(c.method, c.url))) continue;
    const path = normalizePath(c.path);
    const id = `${c.method} ${c.host}${path}`;
    const hit = found.get(id);
    if (hit) hit.calls++;
    else found.set(id, { method: c.method, host: c.host, path, calls: 1, sampleUrl: c.url });
  }
  return [...found.values()].sort((a, b) => b.calls - a.calls);
}

/** A registered endpoint for a discovered path: "*" ids become a glob, otherwise "URL contains path". */
export function endpointFromDiscovered(d: Discovered): { key: string; method: string; urlPattern: string | null; matchType: 'contains' | 'glob' } {
  return d.path.includes('*')
    ? { key: d.path, method: d.method, urlPattern: `*${d.path}*`, matchType: 'glob' }
    : { key: d.path, method: d.method, urlPattern: null, matchType: 'contains' };
}
