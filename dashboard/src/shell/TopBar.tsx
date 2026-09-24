import { Button, Icon, IconButton, Swatch, Text } from '@/design';
import { liveStore } from '../api/live';
import { appStore, setTheme } from '../state/app';
import { useStore } from '../state/store';
import { exportHref, markMoment, saveSession, toggleCapture } from './actions';
import { SessionPicker } from './SessionPicker';
import s from './Shell.module.css';

function download(href: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Recording, paused or reconnecting: the recording pulse is never colour alone. */
export function CaptureStatus() {
  const conn = useStore(liveStore, (x) => x.conn);
  const status = useStore(liveStore, (x) => x.status);
  if (conn !== 'open')
    return (
      <span className={s.status} role="status">
        <Swatch color="var(--warn)" shape="circle" pulse />
        {conn === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
      </span>
    );
  return (
    <span className={s.status} role="status">
      {status?.capturePaused ? <Swatch color="var(--tx3)" shape="circle" /> : <Swatch color="var(--fail)" shape="circle" pulse />}
      {status?.capturePaused ? 'Paused' : 'Recording'}
    </span>
  );
}

/** The desktop top bar, after swagperf's: the product, then the one place a
 *  session is chosen, then the commands. */
export function TopBar({ narrow }: { narrow: boolean }) {
  const info = useStore(liveStore, (x) => x.info);
  const conn = useStore(liveStore, (x) => x.conn);
  const status = useStore(liveStore, (x) => x.status);
  const theme = useStore(appStore, (x) => x.theme);
  const devtools = useStore(appStore, (x) => x.devtools);
  const selected = useStore(appStore, (x) => x.selected);
  const offline = conn !== 'open';
  return (
    <header className={s.top}>
      {narrow && <IconButton icon="menu" label="Open navigation" outlined onClick={() => appStore.set({ drawerOpen: true })} />}
      {!devtools && (
        <div className={s.titleBlock}>
          <div className={s.title}>Swag Pay Killcam</div>
          <div className={s.subtitle}>
            {info ? (
              <>
                Live debugging of the running app · {info.appName} {info.versionName} ({info.versionCode}) {info.buildType} · {info.deviceName}
              </>
            ) : (
              <Text variant="meta">Connecting to the app…</Text>
            )}
          </div>
        </div>
      )}
      <div className={s.controls}>
        <SessionPicker />
        <CaptureStatus />
        <Button size="sm" onClick={toggleCapture} disabled={offline || !status}>
          {status?.capturePaused ? 'Resume capture' : 'Pause capture'}
        </Button>
        <Button variant="primary" size="sm" onClick={markMoment} disabled={offline}>
          Mark moment
        </Button>
        <Button size="sm" onClick={saveSession} disabled={offline}>
          Save session
        </Button>
        <Button variant="outline" onClick={() => download(exportHref(selected))} title="Download the session as a bug bundle: session.json, network.har and screenshots">
          Export .zip
        </Button>
        <Button size="sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle colour theme">
          <Icon name="contrast" size={14} />
          {theme === 'dark' ? 'Dark' : 'Light'}
        </Button>
      </div>
    </header>
  );
}
