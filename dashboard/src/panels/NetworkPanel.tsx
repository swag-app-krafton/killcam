import { useMemo, useState } from 'react';
import { api, errorMessage } from '../api/client';
import type { NetworkSummary } from '../api/types';
import { Icon } from '../components/Icon';
import { MethodTag, StatusPill } from '../components/StatusPill';
import { SplitView } from '../components/SplitView';
import { Chip, EmptyState, IconButton, Loading, SearchInput } from '../components/ui';
import { VirtualList } from '../components/VirtualList';
import { fmtBytes, fmtDuration, fmtTime, isNetworkError, statusClass, type StatusClass } from '../lib/format';
import { listStep, useHotkeys } from '../lib/hooks';
import { appStore } from '../state/app';
import { navigate, routePath, useRoute } from '../state/router';
import { useSessionView } from '../state/session';
import { createStore, useStore } from '../state/store';
import { confirmDialog, toast } from '../state/ui';
import { NetworkDetail } from './NetworkDetail';

interface NetFilters {
  q: string;
  method: string;
  status: '' | StatusClass;
  host: string;
  mockedOnly: boolean;
  errorsOnly: boolean;
}
const filterStore = createStore<NetFilters>({
  q: '',
  method: '',
  status: '',
  host: '',
  mockedOnly: false,
  errorsOnly: false,
});

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const ROW_H = 28;

function applyFilters(list: NetworkSummary[], f: NetFilters): NetworkSummary[] {
  const q = f.q.trim().toLowerCase();
  if (!q && !f.method && !f.status && !f.host && !f.mockedOnly && !f.errorsOnly) return list;
  return list.filter((c) => {
    if (f.method && c.method !== f.method) return false;
    if (f.host && c.host !== f.host) return false;
    if (f.mockedOnly && !c.mockRuleId) return false;
    if (f.errorsOnly && !isNetworkError(c)) return false;
    if (f.status && statusClass(c) !== f.status) return false;
    if (q && !c.url.toLowerCase().includes(q) && !(c.screen ?? '').toLowerCase().includes(q)) return false;
    return true;
  });
}

export function NetworkPanel() {
  const view = useSessionView();
  const route = useRoute();
  const embed = useStore(appStore, (s) => s.embed);
  const f = useStore(filterStore, (s) => s);
  const [follow, setFollow] = useState(true);
  const selectedId = route.parts[0] ?? null;

  const hosts = useMemo(() => [...new Set(view.network.map((c) => c.host))].sort(), [view.network]);
  const rows = useMemo(() => applyFilters(view.network, f), [view.network, f]);
  const selIndex = selectedId ? rows.findIndex((r) => r.id === selectedId) : -1;
  const selected = selectedId ? (view.network.find((c) => c.id === selectedId) ?? null) : null;

  const select = (c: NetworkSummary | undefined) => {
    if (!c) return;
    setFollow(false);
    navigate(routePath('network', c.id), { replace: !!selectedId });
  };
  const close = () => navigate('network');

  useHotkeys({
    j: () => select(listStep(rows, selIndex, 1)),
    ArrowDown: () => select(listStep(rows, selIndex, 1)),
    k: () => select(listStep(rows, selIndex, -1)),
    ArrowUp: () => select(listStep(rows, selIndex, -1)),
    Escape: () => selectedId && close(),
  });

  const clear = async () => {
    if (!(await confirmDialog({ title: 'Clear network calls?', message: 'Removes every captured call from the live session on the device.', confirmLabel: 'Clear', danger: true }))) return;
    try {
      await api.del('data', { stream: 'network' });
      close();
    } catch (e) {
      toast(`Clear failed: ${errorMessage(e)}`, 'error');
    }
  };

  const filtered = rows.length !== view.network.length;
  const errors = useMemo(() => view.network.filter(isNetworkError).length, [view.network]);

  const list = (
    <div className="list-pane">
      <div className="toolbar">
        <SearchInput value={f.q} onChange={(q) => filterStore.set({ q })} placeholder="Filter URL or screen" />
        <select className="select" aria-label="Method" value={f.method} onChange={(e) => filterStore.set({ method: e.target.value })}>
          <option value="">All methods</option>
          {METHODS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <select
          className="select"
          aria-label="Status"
          value={f.status}
          onChange={(e) => filterStore.set({ status: e.target.value as NetFilters['status'] })}
        >
          <option value="">All statuses</option>
          <option value="2xx">2xx</option>
          <option value="3xx">3xx</option>
          <option value="4xx">4xx</option>
          <option value="5xx">5xx</option>
          <option value="failed">Failed</option>
          <option value="pending">Pending</option>
        </select>
        <select className="select host-select" aria-label="Host" value={f.host} onChange={(e) => filterStore.set({ host: e.target.value })}>
          <option value="">All hosts</option>
          {hosts.map((h) => (
            <option key={h}>{h}</option>
          ))}
        </select>
        <Chip on={f.mockedOnly} onClick={() => filterStore.set({ mockedOnly: !f.mockedOnly })}>
          Mocked
        </Chip>
        <Chip on={f.errorsOnly} onClick={() => filterStore.set({ errorsOnly: !f.errorsOnly })} className="chip-error">
          Errors{errors ? ` ${errors}` : ''}
        </Chip>
        <span className="grow" />
        <span className="count tnum" aria-live="polite">
          {filtered ? `${rows.length} / ${view.network.length}` : view.network.length} calls
        </span>
        <IconButton icon="follow" label={follow ? 'Following new calls' : 'Follow new calls'} active={follow} onClick={() => setFollow(!follow)} />
        {view.kind === 'live' && !embed && (
          <a className="btn btn-icon" href="api/network.har" download aria-label="Download HAR" title="Download HAR">
            <Icon name="download" />
          </a>
        )}
        {view.kind === 'live' && <IconButton icon="trash" label="Clear calls" onClick={clear} />}
      </div>
      <div className="ntable">
        <div className="nrow nhead" role="row">
          <span className="c-status">Status</span>
          <span className="c-method">Method</span>
          <span className="c-url">URL</span>
          <span className="c-screen">Screen</span>
          <span className="c-dur">Time</span>
          <span className="c-size">Size</span>
          <span className="c-time">Started</span>
        </div>
        {view.status === 'loading' && !view.network.length ? (
          <Loading />
        ) : view.status === 'error' ? (
          <EmptyState icon="warning" tone="error" title="Could not load this session">
            {view.error}
          </EmptyState>
        ) : rows.length === 0 ? (
          filtered ? (
            <EmptyState icon="search" title="No calls match these filters">
              <button type="button" className="link-btn" onClick={() => filterStore.set({ q: '', method: '', status: '', host: '', mockedOnly: false, errorsOnly: false })}>
                Clear filters
              </button>
            </EmptyState>
          ) : (
            <EmptyState icon="network" title="No calls yet">
              {view.kind === 'live' ? "Use the app and they'll stream in." : 'This session has no captured network calls.'}
            </EmptyState>
          )
        ) : (
          <VirtualList
            className="nlist"
            count={rows.length}
            rowHeight={ROW_H}
            getKey={(i) => rows[i].id}
            follow={follow && !selectedId}
            onFollowChange={selectedId ? undefined : setFollow}
            scrollToIndex={selIndex >= 0 ? selIndex : null}
            ariaLabel="Network calls"
            role="grid"
            renderRow={(i) => {
              const c = rows[i];
              const cls = statusClass(c);
              return (
                <div
                  className={[
                    'nrow',
                    c.id === selectedId ? 'sel' : '',
                    cls === 'failed' || cls === '5xx' || cls === '4xx' ? 'err' : '',
                    cls === 'pending' ? 'pending' : '',
                  ].join(' ')}
                  role="row"
                  aria-selected={c.id === selectedId}
                  onClick={() => (c.id === selectedId ? close() : select(c))}
                >
                  <span className="c-status">
                    <StatusPill call={c} />
                  </span>
                  <span className="c-method">
                    <MethodTag method={c.method} />
                  </span>
                  <span className="c-url mono" title={c.url}>
                    <span className="host">{c.host}</span>
                    <span className="path">{c.path}</span>
                    {c.mockRuleId && <span className="badge badge-mock">MOCK</span>}
                  </span>
                  <span className="c-screen" title={c.screen ?? undefined}>
                    {c.screen ?? ''}
                  </span>
                  <span className="c-dur tnum">{c.state === 'pending' ? <span className="dots" /> : fmtDuration(c.durationMs)}</span>
                  <span className="c-size tnum">{c.state === 'complete' ? fmtBytes(c.responseSize) : '—'}</span>
                  <span className="c-time tnum">{fmtTime(c.startMs)}</span>
                </div>
              );
            }}
          />
        )}
      </div>
    </div>
  );

  return (
    <div className="panel">
      <SplitView
        storageKey="network"
        open={!!selected}
        list={list}
        detail={selected && <NetworkDetail key={selected.id} summary={selected} view={view} onClose={close} />}
      />
    </div>
  );
}
