import { Badge, Banner, Button, CodeBlock, DescriptionList, Row, Stack, Text, type Description } from '@/design';
import { liveStore } from '../api/live';
import { KDialog } from '../kit/overlays';
import { copyText } from '../lib/clipboard';
import { fmtDateTime } from '../lib/format';
import { nativeConnection } from '../lib/native';
import { appStore } from '../state/app';
import { bundleStore, useSessionView } from '../state/session';
import { useStore } from '../state/store';
import { toast } from '../state/ui';
import { detailsText } from './actions';

/** Everything about the session in view: the app build, the device, the
 *  runtime and what the app adds, plus how to connect. (Was the Device page.) */
export function SessionDetailsDialog() {
  const open = useStore(appStore, (x) => x.detailsOpen);
  const selected = useStore(appStore, (x) => x.selected);
  const info = useStore(liveStore, (x) => x.info);
  const status = useStore(liveStore, (x) => x.status);
  const savedApp = useStore(bundleStore, (x) => (selected === 'live' ? undefined : x.entries[selected]?.bundle?.app));
  const view = useSessionView();
  const live = view.kind === 'live';
  const app = live ? info : (savedApp ?? null);
  const close = () => appStore.set({ detailsOpen: false });
  const nat = open && live ? nativeConnection() : null;
  const port = nat?.port || status?.port || 8090;
  const connection: Description[] = live
    ? [
        { term: 'You are connected over', value: status ? (status.remote ? 'Wi-Fi, with the PIN' : 'USB or the phone itself') : null },
        { term: 'Port', value: String(port) },
        { term: 'Wi-Fi sharing', value: status ? (status.wifiEnabled ? 'On' : 'Off') : null },
        { term: 'Wi-Fi address', value: status?.wifiUrl ?? (status ? 'Off' : null), mono: !!status?.wifiUrl },
        { term: 'Capture', value: status ? (status.capturePaused ? 'Paused' : 'Recording') : null },
      ]
    : [];
  return (
    <KDialog
      open={open}
      onClose={close}
      title="Session details"
      subtitle={app ? `${app.appName} ${app.versionName} · ${app.deviceName} · started ${fmtDateTime(app.sessionStartMs)}` : undefined}
    >
      <Stack gap={24}>
        <Row gap={8} wrap>
          <Text variant="label">Recorded from</Text>
          <Badge tone="c1">{live ? 'The running app' : 'The saved session'}</Badge>
          <Row grow justify="end">
            <Button
              variant="outline"
              disabled={!app}
              onClick={async () => {
                if (app && (await copyText(detailsText(app, live ? status : null)))) toast('Session details copied', 'ok');
              }}
            >
              Copy details
            </Button>
          </Row>
        </Row>
        {!app && (
          <Banner tone="neutral" title="Details not recorded">
            {live ? 'The app has not answered yet.' : 'This saved session was stored without its app and device details.'}
          </Banner>
        )}
        {live && (
          <Stack as="section" gap={8}>
            <Text as="h3" variant="heading-sm">
              Connection
            </Text>
            <DescriptionList items={connection} />
            <CodeBlock lang="From a laptop over USB, then open localhost" code={`adb forward tcp:${port} tcp:${port}\nopen http://localhost:${port}`} onCopy={(c) => void copyText(c)} />
          </Stack>
        )}
        {app && (
          <Stack as="section" gap={8}>
            <Text as="h3" variant="heading-sm">
              Session
            </Text>
            <DescriptionList
              items={[
                { term: 'Session', value: app.sessionId, mono: true },
                { term: 'Started', value: fmtDateTime(app.sessionStartMs, true) },
                { term: 'Killcam', value: app.killcamVersion },
                { term: 'Package', value: app.packageName, mono: true },
              ]}
            />
          </Stack>
        )}
        {app?.sections.map((sec) => (
          <Stack as="section" key={sec.title} gap={8}>
            <Text as="h3" variant="heading-sm">
              {sec.title}
            </Text>
            <DescriptionList items={sec.items.map((i) => ({ term: i.label, value: i.value }))} />
          </Stack>
        ))}
      </Stack>
    </KDialog>
  );
}
