import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '../api/client';
import type { LogEntry, LogKind, LogLevel } from '../api/types';
import { Icon } from '../components/Icon';
import { StackTrace } from '../components/StackTrace';
import { Chip, CopyButton, EmptyState, IconButton, KeyValueTable, Loading, SearchInput } from '../components/ui';
import { VirtualList } from '../components/VirtualList';
import { fmtClock } from '../lib/format';
import { useHotkeys } from '../lib/hooks';
import { useSessionView } from '../state/session';
import { createStore, useStore } from '../state/store';
import { confirmDialog, toast } from '../state/ui';

export const LEVELS: LogLevel[] = ['V', 'D', 'I', 'W', 'E', 'A'];
const LEVEL_NAMES: Record<LogLevel, string> = { V: 'Verbose', D: 'Debug', I: 'Info', W: 'Warn', E: 'Error', A: 'Assert' };
const KINDS: { id: LogKind; label: string; icon: string }[] = [
  { id: 'log', label: 'Log', icon: 'logs' },
  { id: 'event', label: 'Events', icon: 'star' },
  { id: 'logcat', label: 'Logcat', icon: 'terminal' },
];
const ROW_H = 26;

interface LogFilters {
  levels: Record<LogLevel, boolean>;
  kinds: Record<LogKind, boolean>;
  tag: string;
  q: string;
}
const filterStore = createStore<LogFilters>({
  levels: { V: true, D: true, I: true, W: true, E: true, A: true },
  kinds: { log: true, event: true, logcat: true },
  tag: '',
  q: '',
});

function applyFilters(logs: LogEntry[], f: LogFilters): LogEntry[] {
  const q = f.q.trim().toLowerCase();
  const tags = f.tag
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const allLevels = LEVELS.every((l) => f.levels[l]);
  const allKinds = f.kinds.log && f.kinds.event && f.kinds.logcat;
  if (!q && !tags.length && allLevels && allKinds) return logs;
  return logs.filter((l) => {
    if (!f.levels[l.level] || !f.kinds[l.kind]) return false;
    if (tags.length && !tags.some((t) => l.tag.toLowerCase().includes(t))) return false;
    if (q) {
      if (l.message.toLowerCase().includes(q) || l.tag.toLowerCase().includes(q)) return true;
      if (l.throwable?.toLowerCase().includes(q)) return true;
      for (const k in l.attributes) if (l.attributes[k].toLowerCase().includes(q)) return true;
      return false;
    }
    return true;
  });
}

export function LogsPanel() {
  const view = useSessionView();
  const f = useStore(filterStore, (s) => s);
  const [follow, setFollow] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openH, setOpenH] = useState(200);
  const rows = useMemo(() => applyFilters(view.logs, f), [view.logs, f]);
  const openIndex = openId ? rows.findIndex((l) => l.id === openId) : -1;
  const tags = useMemo(() => [...new Set(view.logs.map((l) => l.tag))].sort().slice(0, 400), [view.logs]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of view.logs) c[l.level] = (c[l.level] ?? 0) + 1;
    return c;
  }, [view.logs]);

  const open = (l: LogEntry | undefined) => {
    if (!l) return;
    setFollow(false);
    setOpenId(l.id);
  };
  const step = (d: number) => {
    if (!rows.length) return;
    const i = openIndex < 0 ? (d > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, openIndex + d));
    open(rows[i]);
  };
  useHotkeys({
    j: () => step(1),
    ArrowDown: () => step(1),
    k: () => step(-1),
    ArrowUp: () => step(-1),
    Escape: () => setOpenId(null),
  });

  const clear = async () => {
    if (!(await confirmDialog({ title: 'Clear logs?', message: 'Removes every captured log line from the live session on the device.', confirmLabel: 'Clear', danger: true }))) return;
    try {
      await api.del('data', { stream: 'logs' });
    } catch (e) {
      toast(`Clear failed: ${errorMessage(e)}`, 'error');
    }
  };

  const filtered = rows.length !== view.logs.length;
  const toggleLevel = (l: LogLevel) => filterStore.set({ levels: { ...f.levels, [l]: !f.levels[l] } });
  const soloLevel = (l: LogLevel) => {
    const minIdx = LEVELS.indexOf(l);
    filterStore.set({ levels: Object.fromEntries(LEVELS.map((x, i) => [x, i >= minIdx])) as LogFilters['levels'] });
  };

  return (
    <div className="panel">
      <div className="list-pane">
        <div className="toolbar">
          <SearchInput value={f.q} onChange={(q) => filterStore.set({ q })} placeholder="Search messages" />
          <div className="chips" role="group" aria-label="Levels">
            {LEVELS.map((l) => (
              <Chip
                key={l}
                on={f.levels[l]}
                onClick={() => toggleLevel(l)}
                className={`lvl-chip lvl-${l}`}
                title={`${LEVEL_NAMES[l]} (${counts[l] ?? 0}). Double-click: ${LEVEL_NAMES[l]} and above`}
              >
                <span onDoubleClick={() => soloLevel(l)}>{l}</span>
              </Chip>
            ))}
          </div>
          <div className="chips" role="group" aria-label="Kinds">
            {KINDS.map((k) => (
              <Chip key={k.id} on={f.kinds[k.id]} onClick={() => filterStore.set({ kinds: { ...f.kinds, [k.id]: !f.kinds[k.id] } })}>
                <Icon name={k.icon} size={13} />
                {k.label}
              </Chip>
            ))}
          </div>
          <input
            className="input tag-input mono"
            list="log-tags"
            placeholder="Tag (a, b)"
            aria-label="Tag filter"
            value={f.tag}
            onChange={(e) => filterStore.set({ tag: e.target.value })}
            spellCheck={false}
          />
          <datalist id="log-tags">
            {tags.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <span className="grow" />
          <span className="count tnum">{filtered ? `${rows.length} / ${view.logs.length}` : view.logs.length} lines</span>
          <IconButton icon="follow" label={follow ? 'Following new lines' : 'Follow new lines'} active={follow} onClick={() => setFollow(!follow)} />
          {view.kind === 'live' && <IconButton icon="trash" label="Clear logs" onClick={clear} />}
        </div>
        {view.status === 'loading' && !view.logs.length ? (
          <Loading />
        ) : rows.length === 0 ? (
          filtered ? (
            <EmptyState icon="search" title="No lines match these filters" />
          ) : (
            <EmptyState icon="logs" title="No logs yet">
              {view.kind === 'live'
                ? 'Killcam.log(), analytics events and the app’s logcat will stream in here.'
                : 'This session has no captured logs.'}
            </EmptyState>
          )
        ) : (
          <VirtualList
            className="llist mono"
            count={rows.length}
            rowHeight={ROW_H}
            getKey={(i) => rows[i].id}
            follow={follow}
            onFollowChange={setFollow}
            expanded={openIndex >= 0 ? { index: openIndex, height: openH } : null}
            scrollToIndex={openIndex >= 0 ? openIndex : null}
            ariaLabel="Log lines"
            renderRow={(i) => {
              const l = rows[i];
              const isOpen = i === openIndex;
              return (
                <LogRow
                  entry={l}
                  open={isOpen}
                  onToggle={() => (isOpen ? setOpenId(null) : open(l))}
                  onMeasure={isOpen ? setOpenH : undefined}
                />
              );
            }}
          />
        )}
      </div>
    </div>
  );
}

function LogRow({
  entry: l,
  open,
  onToggle,
  onMeasure,
}: {
  entry: LogEntry;
  open: boolean;
  onToggle: () => void;
  onMeasure?: (h: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !onMeasure) return;
    onMeasure(el.offsetHeight);
    const ro = new ResizeObserver(() => onMeasure(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [onMeasure, open]);
  const attrs = Object.entries(l.attributes);
  const firstLine = l.message.split('\n', 1)[0];
  return (
    <div ref={ref} className={`lrow lvl-${l.level}${open ? ' open' : ''}`}>
      <div className="lline" onClick={onToggle} role="button" aria-expanded={open} tabIndex={-1}>
        <span className="l-time tnum">{fmtClock(l.ts)}</span>
        <span className={`lvl lvl-${l.level}`}>{l.level}</span>
        <span className="l-kind" title={l.kind}>
          <Icon name={l.kind === 'event' ? 'star' : l.kind === 'logcat' ? 'terminal' : 'logs'} size={12} />
        </span>
        <span className="l-tag" title={l.tag}>
          {l.tag}
        </span>
        <span className="l-msg">
          {firstLine}
          {l.kind === 'event' && attrs.length > 0 && (
            <span className="l-attrs">
              {attrs.slice(0, 4).map(([k, v]) => (
                <span key={k}>
                  {' '}
                  {k}=<b>{v}</b>
                </span>
              ))}
              {attrs.length > 4 && ' …'}
            </span>
          )}
        </span>
        {l.throwable && (
          <span className="l-flag" title="Has a throwable">
            <Icon name="bug" size={13} />
          </span>
        )}
      </div>
      {open && <LogDetail entry={l} />}
    </div>
  );
}

function LogDetail({ entry: l }: { entry: LogEntry }) {
  const attrs = Object.entries(l.attributes);
  const asText = () =>
    [
      `${fmtClock(l.ts)} ${l.level}/${l.tag}: ${l.message}`,
      ...attrs.map(([k, v]) => `  ${k}=${v}`),
      l.throwable ?? '',
    ]
      .filter(Boolean)
      .join('\n');
  return (
    <div className="log-detail">
      <div className="log-detail-head">
        <span className="muted">
          {l.kind} · thread <b>{l.thread ?? '—'}</b> · screen <b>{l.screen ?? '—'}</b> · seq {l.seq}
        </span>
        <span className="grow" />
        <CopyButton text={asText} label="Copy log line" />
      </div>
      {(l.message.includes('\n') || l.message.length > 120) && <pre className="log-msg">{l.message}</pre>}
      {attrs.length > 0 && <KeyValueTable rows={attrs.map(([k, v]) => [k, <span className="break">{v}</span>])} />}
      {l.throwable && <StackTrace text={l.throwable} />}
    </div>
  );
}
