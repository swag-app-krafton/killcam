import { useMemo, useState } from 'react';
import { api, enc, errorMessage } from '../api/client';
import { liveStore } from '../api/live';
import type { Crash, CrashSummary } from '../api/types';
import { Icon } from '../components/Icon';
import { SplitView } from '../components/SplitView';
import { StackTrace } from '../components/StackTrace';
import { CopyButton, EmptyState, IconButton, Loading, Segmented } from '../components/ui';
import { fmtAgo, fmtClock, fmtDateTime, shortClass } from '../lib/format';
import { listStep, useAsync, useHotkeys } from '../lib/hooks';
import { focusReplay } from '../state/app';
import { navigate, routePath, useRoute } from '../state/router';
import { sessionKeyFor, useSessionView, type SessionView } from '../state/session';
import { useStore } from '../state/store';

type Filter = 'all' | 'fatal' | 'nonfatal';

/** The first app frame, e.g. "PayFlowViewModel.kt:212", to name the culprit. */
function blame(stack: string): string | null {
  const m = /at\s+com\.swag\.[\w.$]+\(([^)]+)\)/.exec(stack);
  return m ? m[1] : null;
}

export function watchKillcam(crash: CrashSummary, view: SessionView): void {
  const key = view.kind === 'live' ? sessionKeyFor(crash.sessionId) : view.key;
  focusReplay(key, crash.ts, true);
  navigate('replay');
}

export function CrashesPanel() {
  const view = useSessionView();
  const route = useRoute();
  const liveId = useStore(liveStore, (s) => s.sessionId);
  const [filter, setFilter] = useState<Filter>('all');
  const selectedId = route.parts[0] ?? null;
  const rows = useMemo(
    () => view.crashes.filter((c) => (filter === 'all' ? true : filter === 'fatal' ? c.fatal : !c.fatal)),
    [view.crashes, filter],
  );
  const selIndex = rows.findIndex((c) => c.id === selectedId);
  const selected = view.crashes.find((c) => c.id === selectedId) ?? null;
  const select = (c: CrashSummary | undefined) => c && navigate(routePath('crashes', c.id), { replace: !!selectedId });
  const close = () => navigate('crashes');
  useHotkeys({
    j: () => select(listStep(rows, selIndex, 1)),
    ArrowDown: () => select(listStep(rows, selIndex, 1)),
    k: () => select(listStep(rows, selIndex, -1)),
    ArrowUp: () => select(listStep(rows, selIndex, -1)),
    Escape: () => selectedId && close(),
  });

  const sessionLabel = (c: CrashSummary) =>
    view.kind === 'saved' ? 'This session' : c.sessionId === liveId ? 'This session' : 'Previous session';

  const list = (
    <div className="list-pane">
      <div className="toolbar">
        <Segmented<Filter>
          label="Crash filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `All ${view.crashes.length}` },
            { value: 'fatal', label: 'Fatal' },
            { value: 'nonfatal', label: 'Non-fatal' },
          ]}
        />
        <span className="grow" />
        <span className="count muted">{view.kind === 'live' ? 'This session and earlier ones' : 'Saved session'}</span>
      </div>
      {view.status === 'loading' && !view.crashes.length ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState icon="skull" title={view.crashes.length ? 'Nothing matches this filter' : 'No crashes. GG.'}>
          {view.crashes.length ? null : 'Fatal crashes and recorded non-fatals from this and earlier sessions show up here.'}
        </EmptyState>
      ) : (
        <div className="crash-list scroll" role="listbox" aria-label="Crashes">
          {rows.map((c) => (
            <button
              type="button"
              key={c.id}
              role="option"
              aria-selected={c.id === selectedId}
              className={['crash-item', c.fatal ? 'fatal' : 'nonfatal', c.id === selectedId ? 'sel' : ''].join(' ')}
              onClick={() => (c.id === selectedId ? close() : select(c))}
            >
              <span className="crash-icon">
                <Icon name={c.fatal ? 'skull' : 'bug'} size={18} />
              </span>
              <span className="crash-main">
                <span className="crash-ex">{shortClass(c.exception)}</span>
                <span className="crash-msg">{c.message ?? c.exception}</span>
                <span className="crash-meta">
                  <span className={c.fatal ? 'badge badge-fatal' : 'badge badge-nonfatal'}>{c.fatal ? 'FATAL' : 'NON-FATAL'}</span>
                  <span className={sessionLabel(c) === 'This session' ? 'badge' : 'badge badge-dim'}>{sessionLabel(c)}</span>
                  {c.screen && <span className="muted">on {c.screen}</span>}
                </span>
              </span>
              <span className="crash-when tnum" title={fmtDateTime(c.ts, true)}>
                {fmtAgo(c.ts)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="panel">
      <SplitView
        storageKey="crashes"
        initial={0.6}
        open={!!selected}
        list={list}
        detail={selected && <CrashDetail key={selected.id} crash={selected} view={view} onClose={close} sessionLabel={sessionLabel(selected)} />}
      />
    </div>
  );
}

export function CrashDetail({
  crash,
  view,
  onClose,
  sessionLabel,
  hideWatch,
}: {
  crash: CrashSummary;
  view: SessionView;
  onClose: () => void;
  sessionLabel?: string;
  hideWatch?: boolean;
}) {
  const saved = view.fullCrashes?.find((c) => c.id === crash.id) ?? null;
  const { data, error, loading } = useAsync<Crash | null>(
    (signal) => (saved ? Promise.resolve(saved) : api.get<Crash>(`crashes/${enc(crash.id)}`, undefined, signal)),
    [crash.id, saved],
  );
  const culprit = data ? blame(data.stackTrace) : null;
  return (
    <div className="detail">
      <div className="detail-head">
        <IconButton icon="back" label="Close detail" onClick={onClose} className="detail-back" />
        <span className={crash.fatal ? 'crash-head-icon fatal' : 'crash-head-icon'}>
          <Icon name={crash.fatal ? 'skull' : 'bug'} size={18} />
        </span>
        <div className="detail-title">
          <b>{shortClass(crash.exception)}</b>
        </div>
        {data && <CopyButton text={data.stackTrace} label="Copy stack trace" />}
        {!hideWatch && (
          <button type="button" className="btn primary sm" onClick={() => watchKillcam(crash, view)} title="Replay the moments before this crash">
            <Icon name="replay" size={14} />
            <span>Watch killcam</span>
          </button>
        )}
        <IconButton icon="x" label="Close detail (Esc)" onClick={onClose} className="detail-close" />
      </div>
      <div className="detail-body">
        <div className="crash-summary">
          <div className="mono crash-fqcn">{crash.exception}</div>
          {crash.message && <div className="crash-message">{crash.message}</div>}
          <div className="crash-facts">
            <span className={crash.fatal ? 'badge badge-fatal' : 'badge badge-nonfatal'}>{crash.fatal ? 'FATAL' : 'NON-FATAL'}</span>
            {sessionLabel && <span className="badge">{sessionLabel}</span>}
            <span>
              <Icon name="clock" size={13} /> {fmtDateTime(crash.ts)} · {fmtClock(crash.ts)}
            </span>
            <span>
              thread <b className="mono">{crash.thread}</b>
            </span>
            {crash.screen && (
              <span>
                screen <b>{crash.screen}</b>
              </span>
            )}
            {culprit && (
              <span>
                blamed frame <b className="mono text-accent">{culprit}</b>
              </span>
            )}
          </div>
        </div>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <EmptyState icon="warning" tone="error" title="Could not load the stack trace">
            {errorMessage(error)}
          </EmptyState>
        ) : data ? (
          <StackTrace text={data.stackTrace} />
        ) : null}
      </div>
    </div>
  );
}
