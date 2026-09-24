import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, EmptyState, FlushCard, Row, SearchInput, Segmented, SortTh, Stack, StatusPill, Table, TableEmptyRow, Text, numCell, selectedRow, useSort } from '@/design';
import { liveStore, reloadSessions } from '../api/live';
import type { SessionSummary } from '../api/types';
import { IconBtn } from '../kit/controls';
import { fmt, fmtDateTime, plural } from '../lib/format';
import { appStore } from '../state/app';
import { navigate } from '../state/router';
import { useStore } from '../state/store';
import { deleteSession, exportHref, sessionDuration, sessionReason, sessionTitle } from '../shell/actions';

type Kind = 'all' | 'live' | 'crash' | 'manual';
type Key = 'title' | 'start' | 'length' | 'reason' | 'version' | 'shots' | 'events';
const COLS: { key: Key; label: string; num?: boolean }[] = [
  { key: 'title', label: 'Session' },
  { key: 'start', label: 'Started' },
  { key: 'length', label: 'Length', num: true },
  { key: 'reason', label: 'Ended' },
  { key: 'version', label: 'App version' },
  { key: 'shots', label: 'Screenshots', num: true },
  { key: 'events', label: 'Events', num: true },
];
const RANK = { Live: 0, Saved: 1, Crashed: 2 };

function download(href: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Every session, after swagperf's History: open one to show it on the
 *  Analyse screens, export it, or delete it. */
export function SessionsPanel() {
  const sessions = useStore(liveStore, (x) => x.sessions);
  const selected = useStore(appStore, (x) => x.selected);
  const embed = useStore(appStore, (x) => x.embed);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  useEffect(() => {
    void reloadSessions();
  }, []);
  const all = useMemo(() => sessions ?? [], [sessions]);
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return all.filter((x) => {
      if (kind === 'live' && !x.live) return false;
      if (kind === 'crash' && x.reason !== 'crash') return false;
      if (kind === 'manual' && (x.live || x.reason !== 'manual')) return false;
      return !n || [sessionTitle(x), x.id, x.appVersion, fmtDateTime(x.startMs)].some((v) => v.toLowerCase().includes(n));
    });
  }, [all, q, kind]);
  const get = useCallback((x: SessionSummary, k: Key): number | string | null => {
    switch (k) {
      case 'title':
        return sessionTitle(x);
      case 'start':
        return x.startMs;
      case 'length':
        return (x.endMs ?? Date.now()) - x.startMs;
      case 'reason':
        return RANK[sessionReason(x).word as keyof typeof RANK];
      case 'version':
        return x.appVersion;
      case 'shots':
        return x.screenshotCount;
      case 'events':
        return x.eventCount;
    }
  }, []);
  const { sorted, sort, toggle } = useSort(filtered, get, { key: 'start', dir: 'desc' });
  const open = (x: SessionSummary) => {
    appStore.set({ selected: x.live ? 'live' : x.id });
    navigate('replay');
  };
  if (!sessions) return <EmptyState>Loading sessions…</EmptyState>;
  const counts = { live: all.filter((x) => x.live).length, crash: all.filter((x) => x.reason === 'crash').length, manual: all.filter((x) => !x.live && x.reason === 'manual').length };
  const key = (x: SessionSummary) => (x.live ? 'live' : x.id);

  return (
    <Stack as="section" gap={20}>
      <Row gap={10} wrap>
        <SearchInput label="Search sessions" placeholder="Search label, date or version" value={q} onChange={setQ} />
        <Segmented<Kind>
          label="Kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: 'All' },
            { value: 'live', label: 'Live' },
            { value: 'crash', label: `Crashed · ${fmt(counts.crash)}` },
            { value: 'manual', label: `Saved · ${fmt(counts.manual)}` },
          ]}
        />
        <Text variant="small" tone="muted">
          {fmt(filtered.length)} of {plural(all.length, 'session')}
        </Text>
      </Row>
      {all.length <= 1 && (
        <EmptyState title="No saved sessions yet" align="start">
          A crash saves its session automatically. To keep one yourself, choose Save session in the top bar (or in the menu on the phone).
        </EmptyState>
      )}
      <FlushCard>
        {embed ? (
          sorted.length === 0 ? (
            <div style={{ padding: 16 }}>
              <Text variant="small">No sessions match.</Text>
            </div>
          ) : (
            sorted.map((x) => {
              const r = sessionReason(x);
              return (
                <div key={x.id} data-hl={`session:${x.id}`} style={{ padding: '12px 16px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <Row gap={8}>
                    <Text variant="body" tone="primary" weight={600} truncate grow>
                      {sessionTitle(x)}
                    </Text>
                    <StatusPill tone={r.tone}>{r.word}</StatusPill>
                  </Row>
                  <Text variant="meta">
                    {fmtDateTime(x.startMs)} · {sessionDuration(x)} · {plural(x.screenshotCount, 'screenshot')}
                  </Text>
                  <Row gap={8}>
                    <Button variant="secondary" size="sm" disabled={key(x) === selected} onClick={() => open(x)}>
                      {key(x) === selected ? 'In view' : 'Open'}
                    </Button>
                    {!x.live && <IconBtn icon="trash" size="lg" label={`Delete ${sessionTitle(x)}`} onClick={() => void deleteSession(x)} />}
                  </Row>
                </div>
              );
            })
          )
        ) : (
          <Table minWidth={1080} label="Sessions">
            <thead>
              <tr>
                {COLS.map((c) => (
                  <SortTh key={c.key} label={c.label} sortKey={c.key} sort={sort} onSort={toggle} align={c.num ? 'right' : 'left'} />
                ))}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && <TableEmptyRow colSpan={COLS.length + 1}>No sessions match these filters.</TableEmptyRow>}
              {sorted.map((x) => {
                const r = sessionReason(x);
                const inView = key(x) === selected;
                return (
                  <tr key={x.id} data-hl={`session:${x.id}`} className={inView ? selectedRow : undefined} aria-current={inView || undefined}>
                    <td style={{ maxWidth: 320 }}>
                      <Stack gap={2}>
                        <Text variant="body" tone="primary" weight={700} truncate>
                          {sessionTitle(x)}
                        </Text>
                        <Text variant="meta" truncate>
                          {x.id}
                        </Text>
                      </Stack>
                    </td>
                    <td>
                      <Text variant="body" nowrap>
                        {fmtDateTime(x.startMs)}
                      </Text>
                    </td>
                    <td className={numCell}>{sessionDuration(x)}</td>
                    <td>
                      <StatusPill tone={r.tone}>{r.word}</StatusPill>
                    </td>
                    <td>
                      <Text variant="body">{x.appVersion || 'not recorded'}</Text>
                    </td>
                    <td className={numCell}>{fmt(x.screenshotCount)}</td>
                    <td className={numCell}>{fmt(x.eventCount)}</td>
                    <td>
                      <Row gap={6}>
                        <Button variant="mini" disabled={inView} onClick={() => open(x)} title={inView ? 'The Analyse screens show this session' : 'Show this session on Replay, Network, Logs and Crashes'}>
                          {inView ? 'In view' : 'Open'}
                        </Button>
                        <Button variant="mini" onClick={() => download(exportHref(x.live ? 'live' : x.id))} title="Download a bug bundle: session.json, network.har and screenshots">
                          Export
                        </Button>
                        {!x.live && <IconBtn icon="trash" label={`Delete ${sessionTitle(x)}`} onClick={() => void deleteSession(x)} />}
                      </Row>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </FlushCard>
    </Stack>
  );
}
