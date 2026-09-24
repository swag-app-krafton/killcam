import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Button, Chip, EmptyState, SearchInput, Spacer, Text, ToggleChip } from '@/design';
import { api, errorMessage } from '../api/client';
import type { LogEntry, LogKind, LogLevel } from '../api/types';
import { StackLines } from '../kit/console';
import { IconBtn } from '../kit/controls';
import { KIcon } from '../kit/Icon';
import { PointMenu, Sheet, SheetItem, SheetSection } from '../kit/overlays';
import { VirtualList } from '../kit/VirtualList';
import { copyText } from '../lib/clipboard';
import { fmt, fmtClock } from '../lib/format';
import { useHotkeys } from '../lib/hooks';
import { load, save } from '../lib/storage';
import { appStore } from '../state/app';
import { useSessionView } from '../state/session';
import { createStore, useStore } from '../state/store';
import { confirmDialog, toast } from '../state/ui';
import s from './Logs.module.css';

export const LEVELS: LogLevel[] = ['V', 'D', 'I', 'W', 'E', 'A'];
const LEVEL_NAME: Record<LogLevel, string> = { V: 'Verbose', D: 'Debug', I: 'Info', W: 'Warn', E: 'Error', A: 'Assert' };
/** Chip keys, on the page surface. */
const LEVEL_COLOR: Record<LogLevel, string> = { V: 'var(--tx3)', D: 'var(--c1)', I: 'var(--pass)', W: 'var(--warn)', E: 'var(--fail)', A: 'var(--fail)' };
/** The same levels on the console, which is dark in both themes. */
const CON_COLOR: Record<LogLevel, string> = { V: 'var(--con-dim)', D: '#7cb4ff', I: 'var(--con-tx)', W: 'var(--con-warn)', E: 'var(--con-err)', A: 'var(--con-err)' };
const KINDS: { id: LogKind; label: string }[] = [
  { id: 'log', label: 'Killcam.log' },
  { id: 'event', label: 'Analytics events' },
  { id: 'logcat', label: 'Logcat' },
];

interface LogFilters {
  levels: Record<LogLevel, boolean>;
  kinds: Record<LogKind, boolean>;
  /** Show only these tags (empty: all). */
  only: string[];
  /** Never show these tags; remembered, since logcat is noisy. */
  hidden: string[];
  q: string;
}
const HIDDEN_KEY = 'killcam.logs.hiddenTags';
const filterStore = createStore<LogFilters>({
  levels: { V: true, D: true, I: true, W: true, E: true, A: true },
  kinds: { log: true, event: true, logcat: true },
  only: [],
  hidden: load<string[]>(HIDDEN_KEY, []),
  q: '',
});
function setHidden(hidden: string[]) {
  filterStore.set({ hidden });
  save(HIDDEN_KEY, hidden);
}

function applyFilters(logs: LogEntry[], f: LogFilters): LogEntry[] {
  const q = f.q.trim().toLowerCase();
  const allLevels = LEVELS.every((l) => f.levels[l]);
  const allKinds = f.kinds.log && f.kinds.event && f.kinds.logcat;
  if (!q && allLevels && allKinds && !f.only.length && !f.hidden.length) return logs;
  const only = new Set(f.only);
  const hidden = new Set(f.hidden);
  return logs.filter((l) => {
    if (!f.levels[l.level] || !f.kinds[l.kind]) return false;
    if (only.size && !only.has(l.tag)) return false;
    if (hidden.has(l.tag)) return false;
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
  const embed = useStore(appStore, (x) => x.embed);
  const f = useStore(filterStore, (x) => x);
  const [follow, setFollow] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openH, setOpenH] = useState(200);
  const [tagMenu, setTagMenu] = useState<{ tag: string; x: number; y: number } | null>(null);
  const [options, setOptions] = useState(false);
  const rows = useMemo(() => applyFilters(view.logs, f), [view.logs, f]);
  const openIndex = openId ? rows.findIndex((l) => l.id === openId) : -1;
  const counts = useMemo(() => {
    const c: Partial<Record<LogLevel, number>> = {};
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
    open(rows[openIndex < 0 ? (d > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, openIndex + d))]);
  };
  useHotkeys({ j: () => step(1), ArrowDown: () => step(1), k: () => step(-1), ArrowUp: () => step(-1), Escape: () => setOpenId(null) });

  const clear = async () => {
    const ok = await confirmDialog({ title: 'Clear the logs?', message: 'Removes every captured log line from the live session on the device.', confirmLabel: 'Clear logs', danger: true });
    if (!ok) return;
    try {
      await api.del('data', { stream: 'logs' });
    } catch (e) {
      toast(`Could not clear the logs: ${errorMessage(e)}`, 'error');
    }
  };
  const onlyTag = (tag: string) => filterStore.set({ only: f.only.includes(tag) ? f.only : [...f.only, tag] });
  const hideTag = (tag: string) => {
    if (!f.hidden.includes(tag)) setHidden([...f.hidden, tag]);
    filterStore.set({ only: f.only.filter((t) => t !== tag) });
  };
  const tagActions = (tag: string) => [
    { label: `Show only “${tag}”`, onPick: () => onlyTag(tag) },
    { label: `Hide “${tag}”`, onPick: () => hideTag(tag) },
    { label: 'Copy tag', onPick: () => void copyText(tag) },
  ];

  const filtered = rows.length !== view.logs.length;
  const levelChips = LEVELS.map((l) => (
    <ToggleChip key={l} pressed={f.levels[l]} onClick={() => filterStore.set({ levels: { ...f.levels, [l]: !f.levels[l] } })} color={LEVEL_COLOR[l]} count={counts[l] ?? 0}>
      {embed ? l : LEVEL_NAME[l]}
    </ToggleChip>
  ));
  const tagChips = [
    ...f.only.map((t) => (
      <Chip key={`o:${t}`} onRemove={() => filterStore.set({ only: f.only.filter((x) => x !== t) })} removeLabel={`Stop showing only ${t}`}>
        Only {t}
      </Chip>
    )),
    ...f.hidden.map((t) => (
      <Chip key={`h:${t}`} onRemove={() => setHidden(f.hidden.filter((x) => x !== t))} removeLabel={`Show ${t} again`}>
        Hiding {t}
      </Chip>
    )),
  ];
  const count = `${filtered ? `${fmt(rows.length)} of ` : ''}${fmt(view.logs.length)} lines`;

  return (
    <div className={s.page}>
      {embed ? (
        <>
          <div className={s.bar}>
            <SearchInput label="Search logs" placeholder="Search messages and tags" value={f.q} onChange={(q) => filterStore.set({ q })} />
            <IconBtn icon="follow" size="lg" label={follow ? 'Following new lines' : 'Follow new lines'} pressed={follow} onClick={() => setFollow(!follow)} />
            <IconBtn icon="more" size="lg" label="Log options" onClick={() => setOptions(true)} />
          </div>
          <div className={s.chipRow}>
            {levelChips}
            {tagChips}
          </div>
        </>
      ) : (
        <div className={s.bar}>
          <SearchInput label="Search logs" placeholder="Search messages, tags and attributes" value={f.q} onChange={(q) => filterStore.set({ q })} />
          {levelChips}
          <span className={s.sep} aria-hidden />
          {KINDS.map((k) => (
            <ToggleChip key={k.id} pressed={f.kinds[k.id]} onClick={() => filterStore.set({ kinds: { ...f.kinds, [k.id]: !f.kinds[k.id] } })}>
              {k.label}
            </ToggleChip>
          ))}
          {tagChips}
          <Text variant="small" tone="muted">
            {count}
          </Text>
          <Spacer />
          <IconBtn icon="follow" outlined label={follow ? 'Following new lines' : 'Follow new lines'} pressed={follow} onClick={() => setFollow(!follow)} />
          {view.kind === 'live' && (
            <Button variant="quiet" onClick={clear}>
              Clear
            </Button>
          )}
        </div>
      )}

      {view.status === 'loading' && !view.logs.length ? (
        <EmptyState>Loading logs…</EmptyState>
      ) : view.logs.length === 0 ? (
        <EmptyState title="No log lines yet">
          {view.kind === 'live'
            ? 'Killcam.log() lines, analytics events and the app’s logcat (React Native console.log included) appear here as they happen. Use the app, or check that Killcam.install() runs in Application.onCreate.'
            : 'This session was saved before any line was logged.'}
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No lines match these filters"
          actions={
            <Button variant="outline" onClick={() => filterStore.set({ levels: { V: true, D: true, I: true, W: true, E: true, A: true }, kinds: { log: true, event: true, logcat: true }, only: [], q: '' })}>
              Clear filters
            </Button>
          }
        >
          {f.hidden.length ? `${f.hidden.length} hidden tag${f.hidden.length === 1 ? '' : 's'} stay hidden.` : null}
        </EmptyState>
      ) : (
        <div className={s.console} role="log" aria-label="Log lines">
          <VirtualList
            count={rows.length}
            rowHeight={embed ? 64 : 24}
            getKey={(i) => rows[i].id}
            follow={follow}
            onFollowChange={setFollow}
            expanded={openIndex >= 0 ? { index: openIndex, height: openH } : null}
            scrollToIndex={openIndex >= 0 ? openIndex : null}
            renderRow={(i) => {
              const l = rows[i];
              const isOpen = i === openIndex;
              return (
                <LogLine
                  entry={l}
                  phone={embed}
                  open={isOpen}
                  onToggle={() => (isOpen ? setOpenId(null) : open(l))}
                  onMeasure={isOpen ? setOpenH : undefined}
                  onTag={(e) => {
                    e.stopPropagation();
                    setTagMenu({ tag: l.tag, x: e.clientX, y: e.clientY });
                  }}
                />
              );
            }}
          />
        </div>
      )}

      {tagMenu &&
        (embed ? (
          <Sheet title={tagMenu.tag} onClose={() => setTagMenu(null)}>
            {tagActions(tagMenu.tag).map((a, i) => (
              <SheetItem
                key={i}
                icon={<KIcon name={i === 0 ? 'search' : i === 1 ? 'eye' : 'copy'} size={18} />}
                label={a.label}
                onClick={() => {
                  setTagMenu(null);
                  a.onPick();
                }}
              />
            ))}
          </Sheet>
        ) : (
          <PointMenu x={tagMenu.x} y={tagMenu.y} label={`Tag ${tagMenu.tag}`} items={tagActions(tagMenu.tag)} onClose={() => setTagMenu(null)} />
        ))}

      {options && (
        <Sheet title="Log options" onClose={() => setOptions(false)}>
          <SheetSection>
            <Text variant="label">Show</Text>
          </SheetSection>
          {KINDS.map((k) => (
            <SheetItem
              key={k.id}
              icon={<KIcon name={f.kinds[k.id] ? 'check' : 'dot'} size={16} />}
              label={k.label}
              right={f.kinds[k.id] ? 'On' : 'Off'}
              onClick={() => filterStore.set({ kinds: { ...f.kinds, [k.id]: !f.kinds[k.id] } })}
            />
          ))}
          {f.hidden.length > 0 && (
            <>
              <SheetSection>
                <Text variant="label">Hidden tags</Text>
              </SheetSection>
              {f.hidden.map((t) => (
                <SheetItem key={t} icon={<KIcon name="eye" size={16} />} label={t} right="Show" onClick={() => setHidden(f.hidden.filter((x) => x !== t))} />
              ))}
            </>
          )}
          <SheetSection>
            <Text variant="meta">{count}. Tap a line’s tag to show only it or hide it.</Text>
          </SheetSection>
          {view.kind === 'live' && (
            <SheetItem
              icon={<KIcon name="trash" size={18} />}
              label="Clear logs"
              danger
              onClick={() => {
                setOptions(false);
                void clear();
              }}
            />
          )}
        </Sheet>
      )}
    </div>
  );
}

function LogLine({
  entry: l,
  phone,
  open,
  onToggle,
  onMeasure,
  onTag,
}: {
  entry: LogEntry;
  phone: boolean;
  open: boolean;
  onToggle: () => void;
  onMeasure?: (h: number) => void;
  onTag: (e: MouseEvent) => void;
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
  const tint = l.level === 'W' ? s.warn : l.level === 'E' || l.level === 'A' ? s.error : '';
  const attrs = Object.entries(l.attributes);
  const first = l.message.split('\n', 1)[0];
  const tag = (
    <button type="button" className={s.tag} onClick={onTag} onContextMenu={(e) => (e.preventDefault(), onTag(e))} title={`${l.tag}: show only or hide`}>
      {l.tag}
    </button>
  );
  const level = (
    <span className={s.level} style={{ color: CON_COLOR[l.level] }} title={LEVEL_NAME[l.level]}>
      {l.level}
    </span>
  );
  return (
    <div ref={ref} className={[s.line, tint, open && s.open].filter(Boolean).join(' ')}>
      {phone ? (
        <div className={s.head2} onClick={onToggle} role="button" aria-expanded={open} tabIndex={-1}>
          <div className={s.meta}>
            <span className={s.time}>{fmtClock(l.ts)}</span>
            {level}
            {tag}
            {l.throwable && <span className={s.flag}>✕ stack</span>}
          </div>
          <div className={s.msg2}>
            {l.message}
            {l.kind === 'event' && attrs.length > 0 && <span className={s.attrs}> {attrs.map(([k, v]) => `${k}=${v}`).join(' ')}</span>}
          </div>
        </div>
      ) : (
        <div className={s.head} onClick={onToggle} role="button" aria-expanded={open} tabIndex={-1}>
          <span className={s.time}>{fmtClock(l.ts)}</span>
          {level}
          {tag}
          <span className={s.msg}>
            {first}
            {l.kind === 'event' && attrs.length > 0 && (
              <span className={s.attrs}>
                {' '}
                {attrs
                  .slice(0, 4)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(' ')}
                {attrs.length > 4 ? ' …' : ''}
              </span>
            )}
          </span>
          {l.throwable && <span className={s.flag}>✕ stack</span>}
        </div>
      )}
      {open && <LogDetail entry={l} />}
    </div>
  );
}

function LogDetail({ entry: l }: { entry: LogEntry }) {
  const attrs = Object.entries(l.attributes);
  const text = () =>
    [`${fmtClock(l.ts)} ${l.level}/${l.tag}: ${l.message}`, ...attrs.map(([k, v]) => `  ${k}=${v}`), l.throwable ?? ''].filter(Boolean).join('\n');
  return (
    <div className={s.detail}>
      <div className={s.detailMeta}>
        <span>{l.kind === 'event' ? 'Analytics event' : l.kind === 'logcat' ? 'Logcat' : 'Killcam.log'}</span>·<span>thread {l.thread ?? 'not recorded'}</span>·
        <span>screen {l.screen ?? 'not recorded'}</span>·<span>seq {l.seq}</span>
        <button
          type="button"
          className={s.tag}
          style={{ width: 'auto', marginLeft: 'auto' }}
          onClick={async () => {
            if (await copyText(text())) toast('Log line copied', 'ok');
          }}
        >
          Copy
        </button>
      </div>
      {(l.message.includes('\n') || l.message.length > 100) && <pre className={s.full}>{l.message}</pre>}
      {attrs.length > 0 && (
        <dl className={s.kv}>
          {attrs.map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {l.throwable && (
        <div className={s.stack}>
          <StackLines text={l.throwable} />
        </div>
      )}
    </div>
  );
}
