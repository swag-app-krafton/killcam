import { useEffect, useState } from 'react';
import { Button, CodeBlock, Segmented, Spinner, Stack, StatusPill, Swatch, Switch, Text } from '@/design';
import { liveStore, reloadSessions } from '../api/live';
import { IconBtn } from '../kit/controls';
import { KIcon } from '../kit/Icon';
import { Sheet, SheetItem, SheetSection } from '../kit/overlays';
import { copyText } from '../lib/clipboard';
import { fmtDateTime, plural } from '../lib/format';
import { callNative, hasNative, nativeConnection, onNativeEvent, type NativeConnection } from '../lib/native';
import { appStore, setTheme } from '../state/app';
import { navigate, replaceRoute, useRoute, type Panel } from '../state/router';
import { useSessionView } from '../state/session';
import { useStore } from '../state/store';
import { toast } from '../state/ui';
import { markMoment, saveSession, sessionReason, sessionTitle, toggleCapture } from './actions';
import { SCREENS, TAB_IDS, screenOf } from './routes';
import s from './Shell.module.css';

/** The phone window's one bar: brand, the session in view, Mark, the
 *  overflow sheet, and Close when the Android bridge is there. */
export function EmbedTopBar() {
  const [sheet, setSheet] = useState<null | 'menu' | 'connect' | 'sessions'>(null);
  const conn = useStore(liveStore, (x) => x.conn);
  const status = useStore(liveStore, (x) => x.status);
  const view = useSessionView();
  const recording = conn === 'open' && status && !status.capturePaused;
  const label = view.kind === 'live' ? 'Live' : view.summary ? sessionTitle(view.summary) : 'Saved session';
  return (
    <header className={s.etop}>
      <div className={s.etopMark} aria-label="Killcam">
        KC
      </div>
      <button type="button" className={s.sessionBtn} onClick={() => setSheet('sessions')} aria-label={`Session: ${label}. Change session`}>
        {view.kind === 'live' ? (
          <Swatch color={conn !== 'open' ? 'var(--warn)' : recording ? 'var(--fail)' : 'var(--tx3)'} shape="circle" pulse={conn !== 'open' || !!recording} />
        ) : view.crash ? (
          <KIcon name="skull" size={14} />
        ) : (
          <KIcon name="save" size={14} />
        )}
        <span className={s.sessionBtnText}>{label}</span>
        <KIcon name="chevron-down" size={12} />
      </button>
      <span style={{ flex: 1 }} />
      <Button variant="secondary" size="sm" onClick={markMoment} disabled={conn !== 'open'} style={{ height: 40 }}>
        <KIcon name="mark" size={14} />
        Mark
      </Button>
      <IconBtn icon="more" label="More actions" size="lg" onClick={() => setSheet('menu')} />
      {hasNative() && <IconBtn icon="x" label="Close Killcam" size="lg" onClick={() => callNative((b) => b.close())} />}
      {(sheet === 'menu' || sheet === 'connect') && <OverflowSheet page={sheet} setPage={setSheet} onClose={() => setSheet(null)} />}
      {sheet === 'sessions' && <SessionSheet onClose={() => setSheet(null)} />}
    </header>
  );
}

function OverflowSheet({ page, setPage, onClose }: { page: 'menu' | 'connect'; setPage: (p: 'menu' | 'connect') => void; onClose: () => void }) {
  const status = useStore(liveStore, (x) => x.status);
  const info = useStore(liveStore, (x) => x.info);
  const conn = useStore(liveStore, (x) => x.conn);
  const theme = useStore(appStore, (x) => x.theme);
  const native = hasNative();
  const then = (fn: () => void) => () => {
    onClose();
    fn();
  };
  if (page === 'connect') return <ConnectSheet onBack={() => setPage('menu')} onClose={onClose} />;
  return (
    <Sheet title="Killcam" onClose={onClose}>
      {info && (
        <SheetSection>
          <Text variant="meta">
            {info.appName} {info.versionName} ({info.versionCode}) · {info.buildType} · {info.deviceName}
          </Text>
        </SheetSection>
      )}
      <SheetItem
        icon={<KIcon name={status?.capturePaused ? 'play' : 'pause'} size={18} />}
        label={status?.capturePaused ? 'Resume capture' : 'Pause capture'}
        hint={status?.capturePaused ? 'Paused: nothing new is recorded.' : 'Recording calls, logs, screens and taps.'}
        onClick={then(toggleCapture)}
        disabled={conn !== 'open' || !status}
      />
      <SheetItem icon={<KIcon name="save" size={18} />} label="Save session" hint="Keep this session on the device, to replay or export later." onClick={then(saveSession)} disabled={conn !== 'open'} />
      {native && (
        <SheetItem
          icon={<KIcon name="package" size={18} />}
          label="Share bug bundle"
          hint="Zip the session (calls, logs, screenshots) and share it."
          onClick={then(() => callNative((b) => b.shareBundle()))}
        />
      )}
      <SheetItem
        icon={<KIcon name="usb" size={18} />}
        label="Connect a laptop"
        hint={status?.wifiEnabled ? 'Wi-Fi sharing is on' : 'Over USB, or share over Wi-Fi'}
        onClick={() => setPage('connect')}
        right={<KIcon name="chevron-right" size={14} />}
      />
      <SheetItem
        icon={<KIcon name={theme === 'dark' ? 'moon' : 'sun'} size={18} />}
        label="Theme"
        right={
          <Segmented
            label="Colour theme"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
            ]}
          />
        }
      />
    </Sheet>
  );
}

/** "Connect a laptop": the USB command, and Wi-Fi sharing with its URL and PIN. */
function ConnectSheet({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const status = useStore(liveStore, (x) => x.status);
  const native = hasNative();
  const [conn, setConn] = useState<NativeConnection | null>(() => nativeConnection());
  const [pending, setPending] = useState(false);
  useEffect(
    () =>
      onNativeEvent('connection', () => {
        setConn(nativeConnection());
        setPending(false);
      }),
    [],
  );
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => {
      setConn(nativeConnection());
      setPending(false);
    }, 8000);
    return () => clearTimeout(t);
  }, [pending]);
  const port = conn?.port || status?.port || 8090;
  const usb = conn?.usbCommand || `adb forward tcp:${port} tcp:${port}`;
  const wifiOn = conn ? conn.wifiEnabled : !!status?.wifiEnabled;
  const url = conn ? conn.wifiUrl : (status?.wifiUrl ?? null);
  const pin = conn?.pin ?? null;
  const copy = async (text: string, what: string) => {
    if ((await copyText(text)) && !native) toast(`${what} copied`, 'ok');
  };
  return (
    <Sheet
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: -12 }}>
          <IconBtn icon="back" label="Back" size="lg" onClick={onBack} />
          Connect a laptop
        </span>
      }
      onClose={onClose}
    >
      <SheetSection>
        <Stack gap={20}>
          <Stack gap={8}>
            <Text as="h3" variant="heading-sm">
              Over USB
            </Text>
            <Text variant="small">Plug the phone in, run this on the laptop, then open http://localhost:{port}.</Text>
            <CodeBlock lang="On the laptop" code={usb} onCopy={(c) => void copy(c, 'Command')} />
          </Stack>
          <Stack gap={8}>
            <Text as="h3" variant="heading-sm">
              Over Wi-Fi
            </Text>
            <Stack direction="row" gap={8} align="center">
              {native ? (
                <Switch
                  checked={wifiOn}
                  label={pending ? 'Switching…' : 'Share over Wi-Fi'}
                  onChange={(on) => {
                    setPending(true);
                    if (!callNative((b) => b.setWifiSharing(on))) setPending(false);
                  }}
                />
              ) : (
                <StatusPill tone={wifiOn ? 'pass' : 'neutral'}>{wifiOn ? 'On' : 'Off'}</StatusPill>
              )}
              {pending && <Spinner />}
            </Stack>
            <Text variant="small">
              {native
                ? 'The laptop and the phone need the same network. Anyone with the address and the PIN can see this app’s traffic, so turn it off when you are done.'
                : 'Wi-Fi sharing is switched on and off from the phone.'}
            </Text>
            {wifiOn && url && (
              <Stack gap={12}>
                <Stack gap={4}>
                  <Text variant="label">Address</Text>
                  <Stack direction="row" gap={8} align="center" wrap>
                    <Text variant="mono" tone="primary" breakAnywhere>
                      {url}
                    </Text>
                    <Button variant="outline" onClick={() => void copy(url, 'Address')}>
                      Copy
                    </Button>
                  </Stack>
                </Stack>
                {pin && (
                  <Stack gap={4}>
                    <Text variant="label">PIN</Text>
                    <Stack direction="row" gap={12} align="center" wrap>
                      <span className={s.pin} aria-label={`PIN ${pin.split('').join(' ')}`}>
                        {pin.replace(/(\d{3})(?=\d)/g, '$1 ')}
                      </span>
                      <Button variant="outline" onClick={() => void copy(pin, 'PIN')}>
                        Copy
                      </Button>
                    </Stack>
                  </Stack>
                )}
              </Stack>
            )}
          </Stack>
        </Stack>
      </SheetSection>
    </Sheet>
  );
}

function SessionSheet({ onClose }: { onClose: () => void }) {
  const sessions = useStore(liveStore, (x) => x.sessions) ?? [];
  const selected = useStore(appStore, (x) => x.selected);
  useEffect(() => {
    void reloadSessions();
  }, []);
  const pick = (key: string) => {
    appStore.set({ selected: key });
    onClose();
  };
  return (
    <Sheet title="Session" onClose={onClose}>
      <SheetSection>
        <Text variant="small">Replay, Network, Logs and Crashes show the session picked here.</Text>
      </SheetSection>
      {sessions.map((x) => {
        const key = x.live ? 'live' : x.id;
        const r = sessionReason(x);
        return (
          <SheetItem
            key={x.id}
            icon={<KIcon name={x.live ? 'dot' : x.reason === 'crash' ? 'skull' : 'save'} size={18} />}
            label={x.live ? 'Live session · follow live' : sessionTitle(x)}
            hint={`${fmtDateTime(x.startMs)} · ${plural(x.screenshotCount, 'screenshot')} · ${plural(x.eventCount, 'event')}`}
            right={<StatusPill tone={r.tone}>{r.word}</StatusPill>}
            active={key === selected}
            onClick={() => pick(key)}
          />
        );
      })}
    </Sheet>
  );
}

/** Thumb-reach navigation: the four busiest screens and More. */
export function BottomTabs() {
  const { panel } = useRoute();
  const [more, setMore] = useState(false);
  const inMore = !TAB_IDS.includes(panel);
  const go = (id: Panel) => navigate(id, { replace: true });
  return (
    <>
      <nav className={s.tabs} aria-label="Screens">
        {TAB_IDS.map((id) => {
          const sc = screenOf(id);
          return (
            <button key={id} type="button" className={s.tab} aria-current={id === panel ? 'page' : undefined} onClick={() => go(id)}>
              <KIcon name={sc.icon} size={20} />
              <span>{sc.label}</span>
            </button>
          );
        })}
        <button type="button" className={s.tab} aria-current={inMore ? 'page' : undefined} onClick={() => setMore(true)} aria-haspopup="dialog">
          <KIcon name="more" size={20} />
          <span>{inMore ? screenOf(panel).label : 'More'}</span>
        </button>
      </nav>
      {more && <MoreSheet onClose={() => setMore(false)} />}
    </>
  );
}

function MoreSheet({ onClose }: { onClose: () => void }) {
  const { panel } = useRoute();
  const pick = (id: Panel) => {
    replaceRoute(id);
    onClose();
  };
  return (
    <Sheet title="More" onClose={onClose}>
      {SCREENS.filter((x) => !TAB_IDS.includes(x.id)).map((x) => (
        <SheetItem key={x.id} icon={<KIcon name={x.icon} size={18} />} label={x.label} hint={x.hint} active={x.id === panel} onClick={() => pick(x.id)} />
      ))}
      <SheetItem
        icon={<KIcon name="device" size={18} />}
        label="Session details"
        hint="The app build, the device and the runtime."
        onClick={() => {
          onClose();
          appStore.set({ detailsOpen: true });
        }}
      />
    </Sheet>
  );
}

/** The phone's compact notices: a saved session in view, or a dropped connection. */
export function EmbedStrips() {
  const conn = useStore(liveStore, (x) => x.conn);
  const view = useSessionView();
  const { panel } = useRoute();
  return (
    <>
      {conn === 'down' && (
        <div className={`${s.strip} ${s.stripWarn}`} role="alert">
          <Spinner size={12} />
          Disconnected from the app, retrying…
        </div>
      )}
      {view.kind === 'saved' && screenOf(panel).session && (
        <div className={s.strip}>
          <span style={{ flex: 1, minWidth: 0 }}>Saved session, read-only</span>
          <Button variant="outline" onClick={() => appStore.set({ selected: 'live' })}>
            Go to live
          </Button>
        </div>
      )}
    </>
  );
}
