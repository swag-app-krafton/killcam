import { useMemo, useState } from 'react';
import { EmptyState, ExpandableTable, FlushCard, Grid, KpiTile, Segmented, Stack, Text, type ExpandableColumn } from '@/design';
import { liveStore } from '../api/live';
import type { CrashSummary } from '../api/types';
import { fmt, fmtAgo, fmtDateTime, shortClass } from '../lib/format';
import { appStore } from '../state/app';
import { navigate, routePath, useRoute } from '../state/router';
import { useSessionView } from '../state/session';
import { useStore } from '../state/store';
import { CrashBody, FatalPill } from './crashDetail';

type Filter = 'all' | 'fatal' | 'nonfatal';

/** Crashes, after swagperf's Stability page: tiles, then a table whose rows
 *  open on the stack. */
export function CrashesPanel() {
  const view = useSessionView();
  const route = useRoute();
  const embed = useStore(appStore, (x) => x.embed);
  const liveId = useStore(liveStore, (x) => x.sessionId);
  const [filter, setFilter] = useState<Filter>('all');
  const openId = route.parts[0] ?? null;
  const rows = useMemo(() => view.crashes.filter((c) => (filter === 'all' ? true : filter === 'fatal' ? c.fatal : !c.fatal)), [view.crashes, filter]);
  const fatal = view.crashes.filter((c) => c.fatal);
  const nonFatal = view.crashes.length - fatal.length;
  const here = (c: CrashSummary) => view.kind === 'saved' || c.sessionId === liveId;
  const last = view.crashes[0] ?? null;

  if (view.status === 'loading' && !view.crashes.length) return <EmptyState>Loading crashes…</EmptyState>;
  if (!view.crashes.length) {
    return (
      <EmptyState title="No crashes recorded">
        {view.kind === 'live'
          ? 'Fatal crashes, and the errors the app records with Killcam.recordException(), appear here, from this session and earlier ones. A crash also saves its session, so it can be replayed.'
          : 'Nothing crashed in this saved session.'}
      </EmptyState>
    );
  }

  const columns: ExpandableColumn[] = embed
    ? [
        { key: 'ex', label: 'Exception', width: 'minmax(0, 1fr)' },
        { key: 'fatal', label: 'Kind', width: '96px' },
      ]
    : [
        { key: 'when', label: 'When', width: '130px' },
        { key: 'ex', label: 'Exception', width: 'minmax(220px, 2fr)' },
        { key: 'fatal', label: 'Kind', width: '110px' },
        { key: 'session', label: 'Session', width: '150px' },
        { key: 'screen', label: 'Screen', width: 'minmax(130px, 1fr)' },
      ];

  return (
    <Stack as="section" gap={20}>
      {!embed && (
        <Grid min={180} gap={12}>
          <KpiTile label="Fatal crashes" help="The app's process died on an uncaught exception." value={fmt(fatal.length)} note={`${fmt(fatal.filter(here).length)} in ${view.kind === 'live' ? 'this session' : 'the session in view'}`} />
          <KpiTile label="Non-fatal errors" help="Exceptions the app caught and recorded with Killcam.recordException()." value={fmt(nonFatal)} />
          <KpiTile label="Sessions with a crash" help="Distinct app sessions that ended in a fatal crash." value={fmt(new Set(fatal.map((c) => c.sessionId)).size)} />
          <KpiTile label="Latest" value={last ? fmtAgo(last.ts) : null} note={last ? `${shortClass(last.exception)} · ${fmtDateTime(last.ts)}` : undefined} />
        </Grid>
      )}
      <FlushCard
        title="Crashes and errors"
        hint={view.kind === 'live' ? 'This session and earlier ones, newest first. Open a row for its stack; the app’s own frames are marked.' : 'From the saved session, newest first.'}
        aside={
          <Segmented<Filter>
            label="Kind"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: `All · ${fmt(view.crashes.length)}` },
              { value: 'fatal', label: `Fatal · ${fmt(fatal.length)}` },
              { value: 'nonfatal', label: `Non-fatal · ${fmt(nonFatal)}` },
            ]}
          />
        }
      >
        {rows.length === 0 ? (
          <div style={{ padding: 24 }}>
            <Text variant="body">Nothing of this kind.</Text>
          </div>
        ) : (
          <ExpandableTable
            label="Crashes"
            minWidth={embed ? 0 : 760}
            columns={columns}
            rows={rows}
            rowKey={(c) => c.id}
            rowAttrs={(c) => ({ 'data-hl': `crash:${c.id}` })}
            toggleLabel={(c) => `${shortClass(c.exception)} at ${fmtDateTime(c.ts, true)}`}
            openKey={openId}
            onToggle={(k) => navigate(openId === k ? 'crashes' : routePath('crashes', k), { replace: true })}
            cells={(c) =>
              embed
                ? [
                    <Stack key="e" gap={2}>
                      <Text variant="body" tone="primary" weight={600} truncate>
                        {shortClass(c.exception)}
                      </Text>
                      <Text variant="meta" truncate>
                        {fmtAgo(c.ts)} · {c.screen ?? 'no screen'}
                      </Text>
                    </Stack>,
                    <FatalPill key="f" fatal={c.fatal} />,
                  ]
                : [
                    <Text key="w" variant="small" nowrap title={fmtDateTime(c.ts, true)}>
                      {fmtAgo(c.ts)}
                    </Text>,
                    <Stack key="e" gap={2}>
                      <Text variant="body" tone="primary" weight={600} truncate>
                        {shortClass(c.exception)}
                      </Text>
                      <Text variant="meta" truncate>
                        {c.message ?? c.exception}
                      </Text>
                    </Stack>,
                    <FatalPill key="f" fatal={c.fatal} />,
                    <Text key="s" variant="small">
                      {here(c) ? 'This session' : 'An earlier session'}
                    </Text>,
                    <Text key="sc" variant="small" truncate>
                      {c.screen ?? '–'}
                    </Text>,
                  ]
            }
            detail={(c) => <CrashBody crash={c} view={view} />}
          />
        )}
      </FlushCard>
    </Stack>
  );
}
