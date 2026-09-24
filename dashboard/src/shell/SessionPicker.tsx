import { useCallback, useEffect, useState } from 'react';
import { Button, FieldButton, Popover, Row, RowAction, SortTh, Spacer, StatusPill, Table, Text, numCell, useSort } from '@/design';
import { liveStore, reloadSessions } from '../api/live';
import type { SessionSummary } from '../api/types';
import { fmt, fmtDateTime } from '../lib/format';
import { appStore } from '../state/app';
import { useRoute } from '../state/router';
import { useStore } from '../state/store';
import { sessionDuration, sessionReason, sessionTitle } from './actions';
import s from './Shell.module.css';

type Key = 'title' | 'start' | 'duration' | 'reason' | 'shots' | 'events';
const COLS: { key: Key; label: string; num?: boolean }[] = [
  { key: 'title', label: 'Session' },
  { key: 'start', label: 'Started' },
  { key: 'duration', label: 'Length', num: true },
  { key: 'reason', label: 'Ended' },
  { key: 'shots', label: 'Screenshots', num: true },
  { key: 'events', label: 'Events', num: true },
];
const RANK = { Live: 0, Saved: 1, Crashed: 2 };

/** Pick the session every Analyse screen shows: like swagperf's Run picker,
 *  a field in the top bar opening a sortable table, with "Follow live". */
export function SessionPicker() {
  const [open, setOpen] = useState(false);
  const sessions = useStore(liveStore, (x) => x.sessions) ?? [];
  const selected = useStore(appStore, (x) => x.selected);
  const { key: navKey } = useRoute();
  // A page change closes it, like any menu.
  useEffect(() => setOpen(false), [navKey]);
  const get = useCallback((r: SessionSummary, k: Key): number | string | null => {
    switch (k) {
      case 'title':
        return sessionTitle(r);
      case 'start':
        return r.startMs;
      case 'duration':
        return (r.endMs ?? Date.now()) - r.startMs;
      case 'reason':
        return RANK[sessionReason(r).word as keyof typeof RANK];
      case 'shots':
        return r.screenshotCount;
      case 'events':
        return r.eventCount;
    }
  }, []);
  const { sorted, sort, toggle } = useSort(sessions, get, { key: 'start', dir: 'desc' });
  const following = selected === 'live';
  const current = following ? null : sessions.find((x) => x.id === selected);
  const pick = (key: string) => {
    appStore.set({ selected: key });
    setOpen(false);
  };
  const value = following ? 'Live · following' : current ? `${sessionTitle(current)} · ${fmtDateTime(current.startMs)}` : 'Saved session';
  return (
    <span className={s.pickerWrap}>
      <FieldButton
        label="Session"
        value={value}
        open={open}
        onClick={() => {
          if (!open) void reloadSessions();
          setOpen(!open);
        }}
        title="Choose the session the Analyse screens show"
      />
      <Popover open={open} onClose={() => setOpen(false)} width={760} align="start" maxHeight={480}>
        <Row gap={8} wrap className={s.pickerHead}>
          <Text variant="small">
            {sessions.length} session{sessions.length === 1 ? '' : 's'}. Sort by any column; pick one to show it on Replay, Network, Logs and Crashes.
          </Text>
          <Spacer />
          <Button variant="outline" disabled={following} onClick={() => pick('live')}>
            {following ? 'Following live' : 'Follow live'}
          </Button>
        </Row>
        <div className={s.pickerScroll}>
          <Table minWidth={640} density="dense" stickyHeader label="Sessions">
            <thead>
              <tr>
                {COLS.map((c) => (
                  <SortTh key={c.key} label={c.label} sortKey={c.key} sort={sort} onSort={toggle} align={c.num ? 'right' : 'left'} />
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const key = r.live ? 'live' : r.id;
                const reason = sessionReason(r);
                return (
                  <tr key={r.id} aria-current={key === selected || undefined}>
                    <td>
                      <RowAction onClick={() => pick(key)} aria-label={`Show ${sessionTitle(r)}`}>
                        {sessionTitle(r)}
                      </RowAction>
                    </td>
                    <td>
                      <Text variant="small" nowrap>
                        {fmtDateTime(r.startMs)}
                      </Text>
                    </td>
                    <td className={numCell}>{sessionDuration(r)}</td>
                    <td>
                      <StatusPill tone={reason.tone}>{reason.word}</StatusPill>
                    </td>
                    <td className={numCell}>{fmt(r.screenshotCount)}</td>
                    <td className={numCell}>{fmt(r.eventCount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      </Popover>
    </span>
  );
}
