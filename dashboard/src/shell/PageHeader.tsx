import { Badge, Banner, Button, Eyebrow, Icon, Row, Spacer, Stack, StatusPill, Text } from '@/design';
import { liveStore } from '../api/live';
import { fmtDateTime, fmtDuration, plural } from '../lib/format';
import { appStore } from '../state/app';
import { bundleStore, useSessionView } from '../state/session';
import { useStore } from '../state/store';
import { sessionTitle } from './actions';
import type { ScreenDef } from './routes';
import s from './Shell.module.css';

/** Every screen's header: where you are, what the page is for, and the
 *  session in view. */
export function PageHeader({ screen }: { screen: ScreenDef }) {
  return (
    <Row align="end" justify="between" gap={16} wrap>
      <Stack>
        <Eyebrow>{screen.group}</Eyebrow>
        <Text as="h1" variant="title" className={s.h1}>
          {screen.label}
        </Text>
        <Text as="p" variant="ui" tone="secondary" className={s.hint}>
          {screen.hint}
        </Text>
      </Stack>
      <SessionBox />
    </Row>
  );
}

const shortId = (id: string) => id.replace(/^ses_/, '').split('_').pop()?.slice(-6).toUpperCase() ?? id;

/** The session in view, on every screen (swagperf's run box): its id and
 *  state, the device and build, and the way to its full details. */
export function SessionBox() {
  const view = useSessionView();
  const info = useStore(liveStore, (x) => x.info);
  const status = useStore(liveStore, (x) => x.status);
  const conn = useStore(liveStore, (x) => x.conn);
  const selected = useStore(appStore, (x) => x.selected);
  const savedApp = useStore(bundleStore, (x) => (selected === 'live' ? undefined : x.entries[selected]?.bundle?.app));
  const live = view.kind === 'live';
  const app = live ? info : (savedApp ?? null);
  const sum = view.summary;
  const id = live ? (info?.sessionId ?? '') : selected;
  const length = view.startMs ? fmtDuration((view.endMs ?? Date.now()) - view.startMs) : null;
  return (
    <section className={s.box} aria-label="Session in view">
      <Stack gap={8}>
        <Row gap={8} wrap>
          <span className={s.boxId}>SESSION {shortId(id)}</span>
          {live ? (
            conn !== 'open' ? (
              <StatusPill tone="warn">Offline</StatusPill>
            ) : status?.capturePaused ? (
              <StatusPill tone="neutral">Paused</StatusPill>
            ) : (
              <StatusPill tone="pass">Recording</StatusPill>
            )
          ) : view.crash ? (
            <StatusPill tone="fail">Crashed</StatusPill>
          ) : (
            <StatusPill tone="neutral">Saved</StatusPill>
          )}
          <Spacer />
          {live ? (
            <Badge tone="c1">Live</Badge>
          ) : (
            <Button variant="quiet" onClick={() => appStore.set({ selected: 'live' })} title="Show the live session">
              Saved session · go to live
            </Button>
          )}
        </Row>
        <Stack gap={2}>
          <Text variant="small" tone="primary" weight={500} breakAnywhere>
            {app?.deviceName ?? 'Device not recorded'}
          </Text>
          <Text variant="small" breakAnywhere>
            {app ? `${app.appName} ${app.versionName} (${app.versionCode}) · ${app.buildType}` : 'App build not recorded'}
          </Text>
          <Text variant="meta">
            {view.startMs ? `Started ${fmtDateTime(view.startMs)}` : 'Not started'}
            {length ? ` · ${length}` : ''}
            {sum ? ` · ${plural(sum.screenshotCount, 'screenshot')}` : ''}
            {!live && sum ? ` · ${sessionTitle(sum)}` : ''}
          </Text>
        </Stack>
        <Row>
          <Button variant="outline" onClick={() => appStore.set({ detailsOpen: true })}>
            <Icon name="menu" size={12} />
            Session details
          </Button>
        </Row>
      </Stack>
    </section>
  );
}

/** Shown under the page header while the live stream is down. */
export function ConnectionBanner() {
  const conn = useStore(liveStore, (x) => x.conn);
  const loaded = useStore(liveStore, (x) => x.loaded);
  if (conn !== 'down') return null;
  return (
    <Banner tone="warn" title="Disconnected from the app, retrying">
      The app may have been closed, crashed or restarted. {loaded ? 'What is shown is from before the connection dropped.' : ''}
    </Banner>
  );
}
