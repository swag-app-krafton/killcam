import { useMemo, useState } from 'react';
import { api, errorMessage, isUnavailable } from '../api/client';
import { liveStore, reloadFlags } from '../api/live';
import type { RemoteConfigFetchStatus, RemoteConfigInfo, RemoteConfigValue } from '../api/types';
import { Icon } from '../components/Icon';
import { JsonTree, tryParseJson } from '../components/JsonTree';
import { CopyButton, EmptyState, IconButton, Loading, SearchInput } from '../components/ui';
import { fmtAgo, fmtDateTime } from '../lib/format';
import { useAsync, useNow } from '../lib/hooks';
import { navigate, routePath } from '../state/router';
import { useStore } from '../state/store';
import { toast } from '../state/ui';

const STATUS_LABEL: Record<RemoteConfigFetchStatus, string> = {
  success: 'Fetched',
  failure: 'Fetch failed',
  throttled: 'Throttled',
  no_fetch_yet: 'Not fetched yet',
};

export function RemoteConfigPanel() {
  const res = useAsync((s) => api.get<RemoteConfigInfo>('remote-config', undefined, s), []);
  const [fetched, setFetched] = useState<RemoteConfigInfo | null>(null);
  const [fetching, setFetching] = useState(false);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  // Overrides live in Flags; re-read when the flags stream changes.
  const flags = useStore(liveStore, (s) => s.flags);
  useNow(30_000);
  const info = fetched ?? res.data ?? null;

  const overrides = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const f of flags ?? []) m.set(f.key, f.override);
    return m;
  }, [flags]);

  const values = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (info?.values ?? []).filter((v) => !n || v.key.toLowerCase().includes(n) || v.value.toLowerCase().includes(n));
  }, [info, q]);

  const fetchNow = async () => {
    setFetching(true);
    try {
      const r = await api.post<RemoteConfigInfo>('remote-config/fetch');
      setFetched(r);
      await reloadFlags().catch(() => undefined);
      toast(r.fetchStatus === 'success' ? 'Remote Config fetched and activated' : `Fetch: ${STATUS_LABEL[r.fetchStatus]}`, r.fetchStatus === 'success' ? 'ok' : 'error');
    } catch (e) {
      toast(`Fetch failed: ${errorMessage(e)}`, 'error');
    } finally {
      setFetching(false);
    }
  };

  if (res.error && !fetched) {
    return (
      <div className="panel">
        {isUnavailable(res.error) ? (
          <EmptyState icon="cloud" title="Firebase Remote Config isn't available">
            Killcam reads Remote Config when the app includes <span className="mono">com.google.firebase:firebase-config</span> and has a default{' '}
            <span className="mono">FirebaseApp</span> initialized. Flags from other providers keep working in the Flags panel.
          </EmptyState>
        ) : (
          <EmptyState icon="warning" tone="error" title="Could not load Remote Config">
            {errorMessage(res.error)}
            <div>
              <button type="button" className="link-btn" onClick={res.reload}>
                Retry
              </button>
            </div>
          </EmptyState>
        )}
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="toolbar">
        <div className="toolbar-title">
          <Icon name="cloud" />
          <span>Remote Config</span>
        </div>
        {info && (
          <>
            <span className={`rc-status rc-${info.fetchStatus}`}>{STATUS_LABEL[info.fetchStatus]}</span>
            <span className="muted small rc-meta" title={info.lastFetchMs ? fmtDateTime(info.lastFetchMs, true) : undefined}>
              {info.lastFetchMs ? `last fetch ${fmtAgo(info.lastFetchMs)}` : 'never fetched'} · min interval {info.minimumFetchIntervalSeconds}s · timeout{' '}
              {info.fetchTimeoutSeconds}s
            </span>
          </>
        )}
        <span className="grow" />
        <SearchInput value={q} onChange={setQ} placeholder="Filter keys" width={200} />
        <IconButton icon="refresh" label="Reload" onClick={() => { setFetched(null); res.reload(); }} />
        <button type="button" className="btn primary" onClick={fetchNow} disabled={fetching}>
          <Icon name="cloud" size={14} />
          <span>{fetching ? 'Fetching…' : 'Fetch & activate'}</span>
        </button>
      </div>
      <div className="scroll">
        {!info ? (
          <Loading />
        ) : (
          <>
            <div className="notice rc-note">
              <Icon name="info" size={13} /> Every key is mirrored into <b>Flags</b> (group “Firebase Remote Config”). Overrides set there reach the app only where
              it reads the key through <span className="mono">Killcam.*Flag()</span>.
            </div>
            {values.length === 0 ? (
              <EmptyState icon="cloud" title={info.values.length ? 'No keys match' : 'No Remote Config keys'} />
            ) : (
              <div className="table-scroll">
                <table className="grid rc">
                  <thead>
                    <tr>
                      <th>Key</th>
                      <th className="col-value">Value</th>
                      <th>Source</th>
                      <th>Flag override</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {values.map((v) => (
                      <RcRow
                        key={v.key}
                        v={v}
                        override={overrides.has(v.key) ? (overrides.get(v.key) ?? null) : v.flagOverride}
                        open={open === v.key}
                        onToggle={() => setOpen(open === v.key ? null : v.key)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function RcRow({ v, override, open, onToggle }: { v: RemoteConfigValue; override: string | null; open: boolean; onToggle: () => void }) {
  const json = useMemo(() => tryParseJson(v.value), [v.value]);
  const isJson = json !== undefined && typeof json === 'object' && json !== null;
  return (
    <>
      <tr className={override != null ? 'overridden' : undefined}>
        <td className="mono rc-key">{v.key}</td>
        <td className="col-value">
          {isJson ? (
            <button type="button" className="rc-json mono" onClick={onToggle} aria-expanded={open} title={open ? 'Collapse' : 'Expand JSON'}>
              <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
              <span className="clip">{v.value}</span>
            </button>
          ) : v.value === '' ? (
            <span className="muted">(empty)</span>
          ) : (
            <span className="mono break">{v.value}</span>
          )}
        </td>
        <td>
          <span className={`badge rc-src-${v.source}`}>{v.source}</span>
        </td>
        <td>{override != null ? <span className="badge src-override mono">{override}</span> : <span className="muted">—</span>}</td>
        <td className="row-actions">
          <CopyButton text={v.value} label={`Copy ${v.key}`} />
          <button type="button" className="btn sm" onClick={() => navigate(routePath('flags', v.key))} title="Override this key in Flags">
            <Icon name="flag" size={13} />
            <span>Override</span>
          </button>
        </td>
      </tr>
      {open && isJson && (
        <tr className="rc-expanded">
          <td />
          <td colSpan={4}>
            <JsonTree value={json} expandDepth={3} />
          </td>
        </tr>
      )}
    </>
  );
}
