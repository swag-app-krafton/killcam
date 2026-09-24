import { useMemo, useState } from 'react';
import { Button, ChipButton, EmptyState, SearchInput, SelectField, Spacer, Text, ToggleChip } from '@/design';
import { api, errorMessage } from '../api/client';
import type { NetworkSummary } from '../api/types';
import { HttpStatus, IconBtn, MethodTag } from '../kit/controls';
import { KIcon } from '../kit/Icon';
import { Sheet, SheetItem, SheetSection } from '../kit/overlays';
import { VirtualList } from '../kit/VirtualList';
import { VTable, type VColumn } from '../kit/VTable';
import { fmt, fmtBytes, fmtDuration, fmtTime, isNetworkError, statusClass, type StatusClass } from '../lib/format';
import { listStep, useHotkeys } from '../lib/hooks';
import { appStore } from '../state/app';
import { navigate, routePath, useRoute } from '../state/router';
import { useSessionView } from '../state/session';
import { createStore, useStore } from '../state/store';
import { confirmDialog, toast } from '../state/ui';
import { NetworkDetail } from './NetworkDetail';
import s from './Network.module.css';

interface NetFilters {
  q: string;
  method: string;
  status: '' | StatusClass;
  host: string;
  mockedOnly: boolean;
  errorsOnly: boolean;
}
const NO_FILTERS: NetFilters = { q: '', method: '', status: '', host: '', mockedOnly: false, errorsOnly: false };
const filterStore = createStore<NetFilters>({ ...NO_FILTERS });

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const STATUSES: { value: NetFilters['status']; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: '2xx', label: '2xx success' },
  { value: '3xx', label: '3xx redirect' },
  { value: '4xx', label: '4xx client error' },
  { value: '5xx', label: '5xx server error' },
  { value: 'failed', label: 'No response' },
  { value: 'pending', label: 'In flight' },
];

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
const activeFilters = (f: NetFilters) => [f.method, f.status, f.host, f.mockedOnly, f.errorsOnly].filter(Boolean).length;

const COLUMNS: VColumn[] = [
  { key: 'status', label: 'Status', width: '78px' },
  { key: 'method', label: 'Method', width: '64px' },
  { key: 'url', label: 'URL', width: 'minmax(200px, 1fr)' },
  { key: 'screen', label: 'Screen', width: 'minmax(0, 150px)', minTableWidth: 860 },
  { key: 'time', label: 'Time', width: '76px', align: 'right', minTableWidth: 520 },
  { key: 'size', label: 'Size', width: '76px', align: 'right', minTableWidth: 660 },
  { key: 'started', label: 'Started', width: '76px', align: 'right', minTableWidth: 980 },
];

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

export function NetworkPanel() {
  const view = useSessionView();
  const route = useRoute();
  const embed = useStore(appStore, (x) => x.embed);
  const f = useStore(filterStore, (x) => x);
  const [follow, setFollow] = useState(true);
  const [sheet, setSheet] = useState(false);
  const selectedId = route.parts[0] ?? null;

  const hosts = useMemo(() => [...new Set(view.network.map((c) => c.host))].sort(), [view.network]);
  const rows = useMemo(() => applyFilters(view.network, f), [view.network, f]);
  const selIndex = selectedId ? rows.findIndex((r) => r.id === selectedId) : -1;
  const selected = selectedId ? (view.network.find((c) => c.id === selectedId) ?? null) : null;
  const stats = useMemo(() => {
    const done = view.network.filter((c) => c.state !== 'pending');
    return {
      errors: view.network.filter(isNetworkError).length,
      mocked: view.network.filter((c) => c.mockRuleId).length,
      median: median(done.map((c) => c.durationMs ?? 0)),
      bytes: done.reduce((a, c) => a + (c.state === 'complete' ? c.responseSize : 0), 0),
    };
  }, [view.network]);

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
  });

  const clear = async () => {
    const ok = await confirmDialog({ title: 'Clear the calls?', message: 'Removes every captured call from the live session on the device.', confirmLabel: 'Clear calls', danger: true });
    if (!ok) return;
    try {
      await api.del('data', { stream: 'network' });
      close();
    } catch (e) {
      toast(`Could not clear the calls: ${errorMessage(e)}`, 'error');
    }
  };
  const har = () => {
    const a = document.createElement('a');
    a.href = 'api/network.har';
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const filtered = rows.length !== view.network.length;
  const count = `${filtered ? `${fmt(rows.length)} of ` : ''}${fmt(view.network.length)} calls`;
  const summary = `${count}${stats.median != null ? ` · median ${fmt(stats.median)} ms` : ''} · ${fmtBytes(stats.bytes)} received`;
  const n = activeFilters(f);
  const selects = (
    <>
      <SelectField label="Method" value={f.method} onChange={(method) => filterStore.set({ method })} options={[{ value: '', label: 'All' }, ...METHODS.map((m) => ({ value: m, label: m }))]} />
      <SelectField<NetFilters['status']> label="Status" value={f.status} onChange={(status) => filterStore.set({ status })} options={STATUSES} />
      <SelectField label="Host" value={f.host} onChange={(host) => filterStore.set({ host })} options={[{ value: '', label: 'All hosts' }, ...hosts.map((h) => ({ value: h, label: h }))]} />
    </>
  );

  const empty = filtered ? (
    <EmptyState title="No calls match these filters" actions={<Button variant="outline" onClick={() => filterStore.set({ ...NO_FILTERS })}>Clear filters</Button>} />
  ) : null;

  return (
    <div className={s.page}>
      {embed ? (
        <div className={s.bar}>
          <SearchInput label="Filter calls" placeholder="Filter by URL or screen" value={f.q} onChange={(q) => filterStore.set({ q })} />
          <ChipButton onClick={() => setSheet(true)} aria-expanded={sheet} style={{ height: 40 }}>
            Filters{n ? ` · ${n}` : ''}
          </ChipButton>
        </div>
      ) : (
        <>
          <div className={s.bar}>
            <SearchInput label="Filter calls" placeholder="Filter by URL or screen" value={f.q} onChange={(q) => filterStore.set({ q })} />
            {selects}
            <ToggleChip pressed={f.mockedOnly} onClick={() => filterStore.set({ mockedOnly: !f.mockedOnly })} count={stats.mocked}>
              Mocked only
            </ToggleChip>
            <ToggleChip pressed={f.errorsOnly} onClick={() => filterStore.set({ errorsOnly: !f.errorsOnly })} color="var(--fail)" count={stats.errors}>
              Errors only
            </ToggleChip>
            <Text variant="small" tone="muted">
              {summary}
            </Text>
            <Spacer />
            <IconBtn icon="follow" outlined label={follow ? 'Following new calls' : 'Follow new calls'} pressed={follow} onClick={() => setFollow(!follow)} />
            {view.kind === 'live' && (
              <>
                <Button variant="outline" onClick={har} title="Download the live session's calls as HAR 1.2">
                  HAR
                </Button>
                <Button variant="quiet" onClick={clear}>
                  Clear
                </Button>
              </>
            )}
          </div>
        </>
      )}

      {view.status === 'loading' && !view.network.length ? (
        <EmptyState>Loading calls…</EmptyState>
      ) : view.status === 'error' ? (
        <EmptyState title="Could not load this session">{view.error}</EmptyState>
      ) : view.network.length === 0 ? (
        <EmptyState title="No calls captured">
          {view.kind === 'live'
            ? 'This app has no HTTP client wired to Killcam yet, or has made no calls. Add KillcamInterceptor() to OkHttp, or to the Ktor OkHttp engine, and use the app.'
            : 'This session was saved before the app made any call.'}
        </EmptyState>
      ) : embed ? (
        rows.length === 0 ? (
          empty
        ) : (
          <div className={s.plist} role="list" aria-label="Calls">
            <VirtualList
              count={rows.length}
              rowHeight={56}
              getKey={(i) => rows[i].id}
              follow={follow && !selectedId}
              onFollowChange={selectedId ? undefined : setFollow}
              scrollToIndex={selIndex >= 0 ? selIndex : null}
              renderRow={(i) => {
                const c = rows[i];
                return (
                  <div className={isNetworkError(c) ? `${s.prow} ${s.bad}` : s.prow} role="listitem" onClick={() => select(c)}>
                    <div className={s.pline}>
                      <HttpStatus call={c} />
                      <MethodTag method={c.method} />
                      <span className={s.url}>
                        <span className={s.path}>{c.path}</span>
                      </span>
                    </div>
                    <div className={s.pmeta}>
                      {c.host} · {c.screen ?? 'no screen'} · {c.state === 'pending' ? 'in flight' : fmtDuration(c.durationMs)} · {c.state === 'complete' ? fmtBytes(c.responseSize) : '–'}
                      {c.mockRuleId ? ' · mocked' : ''}
                    </div>
                  </div>
                );
              }}
            />
          </div>
        )
      ) : (
        <VTable
          label="Calls"
          style={{ flex: '1 1 0', minHeight: 280 }}
          columns={COLUMNS}
          rows={rows}
          rowKey={(c) => c.id}
          rowHeight={40}
          selectedKey={selectedId}
          onRowClick={(c) => (c.id === selectedId ? close() : select(c))}
          follow={follow && !selectedId}
          onFollowChange={selectedId ? undefined : setFollow}
          rowClassName={(c) => (isNetworkError(c) ? s.bad : undefined)}
          empty={empty}
          cells={(c) => [
            <HttpStatus key="s" call={c} />,
            <MethodTag key="m" method={c.method} />,
            <span key="u" className={s.url} title={c.url}>
              <span className={s.host}>{c.host}</span>
              <span className={s.path}>{c.path}</span>
            </span>,
            <Text key="sc" variant="small" truncate>
              {c.screen ?? '–'}
            </Text>,
            <span key="t" className={c.state === 'pending' ? `${s.num} ${s.inflight}` : s.num}>
              {c.state === 'pending' ? 'in flight' : fmtDuration(c.durationMs)}
            </span>,
            <span key="z" className={s.num}>
              {c.state === 'complete' ? fmtBytes(c.responseSize) : '–'}
            </span>,
            <span key="st" className={s.num}>
              {fmtTime(c.startMs)}
            </span>,
          ]}
        />
      )}

      {selected && <NetworkDetail key={selected.id} summary={selected} view={view} onClose={close} />}

      {sheet && (
        <Sheet title={`Filters · ${count}`} onClose={() => setSheet(false)} footer={<Button variant="secondary" onClick={() => filterStore.set({ ...NO_FILTERS, q: f.q })}>Clear filters</Button>}>
          <SheetSection>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{selects}</div>
          </SheetSection>
          <SheetItem icon={<KIcon name={f.mockedOnly ? 'check' : 'mocks'} size={18} />} label="Mocked calls only" right={f.mockedOnly ? 'On' : 'Off'} onClick={() => filterStore.set({ mockedOnly: !f.mockedOnly })} />
          <SheetItem icon={<KIcon name={f.errorsOnly ? 'check' : 'warning'} size={18} />} label="Errors only" hint="4xx, 5xx and no response" right={f.errorsOnly ? 'On' : 'Off'} onClick={() => filterStore.set({ errorsOnly: !f.errorsOnly })} />
          <SheetItem icon={<KIcon name="follow" size={18} />} label="Follow new calls" right={follow ? 'On' : 'Off'} onClick={() => setFollow(!follow)} />
          {view.kind === 'live' && (
            <SheetItem
              icon={<KIcon name="trash" size={18} />}
              label="Clear calls"
              danger
              onClick={() => {
                setSheet(false);
                void clear();
              }}
            />
          )}
        </Sheet>
      )}
    </div>
  );
}
