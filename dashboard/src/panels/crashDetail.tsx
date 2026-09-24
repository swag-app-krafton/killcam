import { Banner, Button, DescriptionList, Row, Stack, StatusPill, Text } from '@/design';
import { api, enc, errorMessage } from '../api/client';
import { liveStore } from '../api/live';
import type { Crash, CrashSummary } from '../api/types';
import { StackBlock, blamedFrame } from '../kit/console';
import { fmtClock, fmtDateTime, shortClass } from '../lib/format';
import { useAsync } from '../lib/hooks';
import { focusReplay } from '../state/app';
import { navigate } from '../state/router';
import { sessionKeyFor, type SessionView } from '../state/session';
import { useStore } from '../state/store';

/** Open Replay on the 15 s before a crash and play them. */
export function replayCrash(crash: CrashSummary, view: SessionView): void {
  const key = view.kind === 'live' ? sessionKeyFor(crash.sessionId) : view.key;
  focusReplay(key, crash.ts, true);
  navigate('replay');
}

export function FatalPill({ fatal }: { fatal: boolean }) {
  return <StatusPill tone={fatal ? 'fail' : 'warn'}>{fatal ? 'Fatal' : 'Non-fatal'}</StatusPill>;
}

/** A crash in full: what, where, when, and the stack with the app's frames marked. */
export function CrashBody({ crash, view, showReplay = true }: { crash: CrashSummary; view: SessionView; showReplay?: boolean }) {
  const liveId = useStore(liveStore, (x) => x.sessionId);
  const saved = view.fullCrashes?.find((c) => c.id === crash.id) ?? null;
  const { data, error, loading } = useAsync<Crash | null>(
    (signal) => (saved ? Promise.resolve(saved) : api.get<Crash>(`crashes/${enc(crash.id)}`, undefined, signal)),
    [crash.id, saved],
  );
  const culprit = data ? blamedFrame(data.stackTrace) : null;
  const where = view.kind === 'saved' || crash.sessionId === liveId ? 'This session' : 'An earlier session';
  return (
    <Stack gap={16}>
      <Row gap={8} wrap>
        <FatalPill fatal={crash.fatal} />
        <Text variant="mono" tone="primary" breakAnywhere>
          {crash.exception}
        </Text>
      </Row>
      {crash.message && (
        <Text as="p" variant="lead" tone="primary">
          {crash.message}
        </Text>
      )}
      <DescriptionList
        min={240}
        items={[
          { term: 'When', value: `${fmtDateTime(crash.ts)} · ${fmtClock(crash.ts)}` },
          { term: 'Thread', value: crash.thread, mono: true },
          { term: 'Screen', value: crash.screen },
          { term: 'Session', value: where },
          { term: 'First app frame', value: culprit, mono: true },
        ]}
      />
      {showReplay && (
        <Row gap={8} wrap>
          <Button variant="primary" size="sm" onClick={() => replayCrash(crash, view)} title="Open Replay on the 15 s before this crash and play them">
            Replay the last 15 s
          </Button>
          <Text variant="caption">Screens, taps, calls and logs up to the moment it {crash.fatal ? 'crashed' : 'was recorded'}.</Text>
        </Row>
      )}
      {loading && !data ? (
        <Text variant="small" tone="muted">
          Loading the stack trace…
        </Text>
      ) : error ? (
        <Banner tone="fail" title="Could not load the stack trace">
          {errorMessage(error)}
        </Banner>
      ) : data ? (
        <StackBlock text={data.stackTrace} label={`Stack trace · ${shortClass(crash.exception)}`} />
      ) : null}
    </Stack>
  );
}
