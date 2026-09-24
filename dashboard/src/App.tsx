import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, authStore, enc, errorMessage, submitPin } from './api/client';
import { liveStore, reloadSessions } from './api/live';
import type { KillcamStatus, SessionSummary, TimelineEvent } from './api/types';
import { Icon } from './components/Icon';
import { DialogHost, IconButton, Toasts } from './components/ui';
import { fmtDateTime, fmtDuration, isNetworkError, shortClass } from './lib/format';
import { useHotkeys } from './lib/hooks';
import { ActionsPanel } from './panels/ActionsPanel';
import { CrashesPanel } from './panels/CrashesPanel';
import { DevicePanel } from './panels/DevicePanel';
import { FlagsPanel } from './panels/FlagsPanel';
import { LogsPanel } from './panels/LogsPanel';
import { MocksPanel } from './panels/MocksPanel';
import { NetworkPanel } from './panels/NetworkPanel';
import { RemoteConfigPanel } from './panels/RemoteConfigPanel';
import { ReplayPanel } from './panels/ReplayPanel';
import { StoragePanel } from './panels/StoragePanel';
import { appStore, setNavCollapsed, setTheme } from './state/app';
import { navigate, useRoute, type Panel } from './state/router';
import { forgetBundle, useSessionView } from './state/session';
import { useStore } from './state/store';
import { confirmDialog, promptDialog, toast } from './state/ui';

interface NavItem {
  id: Panel;
  label: string;
  icon: string;
  session?: boolean;
}

const NAV: NavItem[] = [
  { id: 'network', label: 'Network', icon: 'network', session: true },
  { id: 'logs', label: 'Logs', icon: 'logs', session: true },
  { id: 'crashes', label: 'Crashes', icon: 'skull', session: true },
  { id: 'replay', label: 'Replay', icon: 'replay', session: true },
  { id: 'mocks', label: 'Mocks', icon: 'mocks' },
  { id: 'flags', label: 'Flags', icon: 'flag' },
  { id: 'remote-config', label: 'Remote Config', icon: 'cloud' },
  { id: 'storage', label: 'Storage', icon: 'storage' },
  { id: 'device', label: 'Device', icon: 'device' },
  { id: 'actions', label: 'Actions', icon: 'bolt' },
];

const PANELS: Record<Panel, () => ReactNode> = {
  network: () => <NetworkPanel />,
  logs: () => <LogsPanel />,
  crashes: () => <CrashesPanel />,
  replay: () => <ReplayPanel />,
  mocks: () => <MocksPanel />,
  flags: () => <FlagsPanel />,
  'remote-config': () => <RemoteConfigPanel />,
  storage: () => <StoragePanel />,
  device: () => <DevicePanel />,
  actions: () => <ActionsPanel />,
};

export function App() {
  const route = useRoute();
  const embed = useStore(appStore, (s) => s.embed);
  const devtools = useStore(appStore, (s) => s.devtools);
  const navCollapsed = useStore(appStore, (s) => s.navCollapsed);
  const needPin = useStore(authStore, (s) => s.needPin);

  useHotkeys({
    '/': () => {
      const el = document.querySelector<HTMLInputElement>('.main [data-search]');
      el?.focus();
      el?.select();
    },
  });

  useEffect(() => {
    const label = NAV.find((n) => n.id === route.panel)?.label ?? '';
    document.title = `${label} · Killcam`;
  }, [route.panel]);

  return (
    <div className={['app', embed ? 'embed' : '', devtools ? 'devtools' : '', navCollapsed && !embed ? 'nav-collapsed' : ''].filter(Boolean).join(' ')}>
      <TopBar />
      <Banners />
      <div className="shell">
        <Nav active={route.panel} />
        <main className="main" id="main">
          {PANELS[route.panel]()}
        </main>
      </div>
      <Toasts />
      <DialogHost />
      {needPin && <PinScreen />}
    </div>
  );
}

// ---------------------------------------------------------------- top bar --

function TopBar() {
  const info = useStore(liveStore, (s) => s.info);
  const status = useStore(liveStore, (s) => s.status);
  const conn = useStore(liveStore, (s) => s.conn);
  const theme = useStore(appStore, (s) => s.theme);
  const embed = useStore(appStore, (s) => s.embed);
  const devtools = useStore(appStore, (s) => s.devtools);
  const selected = useStore(appStore, (s) => s.selected);
  const recording = conn === 'open' && status != null && !status.capturePaused;

  const togglePause = async () => {
    if (!status) return;
    try {
      liveStore.set({ status: await api.post<KillcamStatus>('capture', { paused: !status.capturePaused }) });
      toast(status.capturePaused ? 'Capture resumed' : 'Capture paused: nothing new is recorded', 'info');
    } catch (e) {
      toast(`Could not ${status.capturePaused ? 'resume' : 'pause'}: ${errorMessage(e)}`, 'error');
    }
  };

  const mark = async () => {
    const label = await promptDialog({
      title: 'Mark this moment',
      message: 'Drops a flag on the live timeline so it is easy to find in the replay.',
      placeholder: 'What happened? e.g. “Pay button did nothing”',
      confirmLabel: 'Mark',
    });
    if (label == null) return;
    try {
      await api.post<TimelineEvent>('timeline/mark', { label: label.trim() || 'Marked moment' });
      toast('Moment marked', 'ok');
    } catch (e) {
      toast(`Mark failed: ${errorMessage(e)}`, 'error');
    }
  };

  const saveSession = async () => {
    const label = await promptDialog({
      title: 'Save session',
      message: 'Snapshots the live session (network, logs, timeline, screenshots) to the device so it survives restarts and can be exported.',
      placeholder: 'Label, e.g. “Pay stuck on PIN screen”',
      confirmLabel: 'Save',
    });
    if (label == null) return;
    try {
      const s = await api.post<SessionSummary>('sessions', { label: label.trim() });
      await reloadSessions();
      toast(`Saved “${s.label ?? 'session'}”`, 'ok');
    } catch (e) {
      toast(`Save failed: ${errorMessage(e)}`, 'error');
    }
  };

  const exportHref = `api/sessions/${enc(selected)}/export`;

  return (
    <header className="topbar">
      {devtools ? (
        <span className={recording ? 'rec-dot on' : 'rec-dot'} title={recording ? 'Recording' : 'Not recording'} />
      ) : (
        <a className="brand" href="#/replay" aria-label="Killcam">
          <span className={recording ? 'rec-dot on' : 'rec-dot'} aria-hidden />
          <span className="wordmark">KILLCAM</span>
        </a>
      )}
      {info && (
        <div className="app-id" title={`${info.packageName} · ${info.deviceName}`}>
          <b>{info.appName}</b>
          <span className="muted">
            {' '}
            {info.versionName} ({info.versionCode}) · {info.buildType}
          </span>
          <span className="app-device muted"> · {info.deviceName}</span>
        </div>
      )}
      <span className="grow" />
      <SessionSelector />
      <ConnIndicator />
      <div className="topbar-actions">
        <IconButton
          icon={status?.capturePaused ? 'play' : 'pause'}
          label={status?.capturePaused ? 'Resume capture' : 'Pause capture'}
          onClick={togglePause}
          disabled={!status || conn !== 'open'}
          active={status?.capturePaused}
          showLabel={!embed}
          className="hide-sm-label"
        />
        <IconButton icon="mark" label="Mark moment" onClick={mark} disabled={conn !== 'open'} showLabel={!embed} className="hide-sm-label" />
        <IconButton icon="save" label="Save session" onClick={saveSession} disabled={conn !== 'open'} showLabel={!embed} className="hide-sm-label" />
        {!embed && (
          <a className="btn btn-icon" href={exportHref} download aria-label="Export bug bundle (.zip)" title="Export bug bundle (.zip): session.json, HAR, screenshots">
            <Icon name="package" />
          </a>
        )}
        <IconButton icon={theme === 'dark' ? 'sun' : 'moon'} label={theme === 'dark' ? 'Light theme' : 'Dark theme'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
      </div>
    </header>
  );
}

function ConnIndicator() {
  const conn = useStore(liveStore, (s) => s.conn);
  const label = conn === 'open' ? 'Connected' : conn === 'connecting' ? 'Connecting…' : 'Offline';
  return (
    <span className={`conn conn-${conn}`} title={conn === 'open' ? 'Live stream connected' : conn === 'connecting' ? 'Connecting to the app…' : 'Disconnected, retrying'} role="status">
      <span className="conn-dot" />
      <span className="conn-label">{label}</span>
    </span>
  );
}

function sessionTitle(s: SessionSummary): string {
  if (s.live) return 'Live session';
  if (s.label) return s.label;
  if (s.crash) return `Crash: ${shortClass(s.crash.exception)}`;
  return 'Saved session';
}

function SessionSelector() {
  const sessions = useStore(liveStore, (s) => s.sessions);
  const selected = useStore(appStore, (s) => s.selected);
  const route = useRoute();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = selected === 'live' ? (sessions?.find((s) => s.live) ?? null) : (sessions?.find((s) => s.id === selected) ?? null);
  const choose = (key: string) => {
    setOpen(false);
    appStore.set({ selected: key });
    const onSessionPanel = NAV.find((n) => n.id === route.panel)?.session;
    if (!onSessionPanel) navigate('replay');
    else if (route.parts.length) navigate(route.panel);
  };
  const remove = async (s: SessionSummary) => {
    if (!(await confirmDialog({ title: `Delete “${sessionTitle(s)}”?`, message: 'Deletes the saved session and its screenshots from the device.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api.del(`sessions/${enc(s.id)}`);
      forgetBundle(s.id);
      if (selected === s.id) appStore.set({ selected: 'live' });
      await reloadSessions();
    } catch (e) {
      toast(`Delete failed: ${errorMessage(e)}`, 'error');
    }
  };

  const isLive = selected === 'live';
  const crash = !isLive && current?.reason === 'crash';
  return (
    <div className="session-sel" ref={ref}>
      <button
        type="button"
        className={['btn', 'session-btn', isLive ? 'is-live' : 'is-saved', crash ? 'is-crash' : ''].join(' ')}
        onClick={() => {
          if (!open) void reloadSessions();
          setOpen(!open);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Session"
      >
        {isLive ? <span className="live-dot" /> : <Icon name={crash ? 'skull' : 'save'} size={14} />}
        <span className="session-btn-label">{isLive ? 'Live' : current ? sessionTitle(current) : 'Saved session'}</span>
        <Icon name="chevron-down" size={13} />
      </button>
      {open && (
        <div className="menu session-menu" role="listbox" aria-label="Sessions">
          {!sessions ? (
            <div className="menu-empty">Loading…</div>
          ) : (
            sessions.map((s) => {
              const key = s.live ? 'live' : s.id;
              const dur = (s.endMs ?? Date.now()) - s.startMs;
              return (
                <div key={s.id} role="option" aria-selected={key === selected} className={['menu-item', key === selected ? 'sel' : '', s.reason === 'crash' ? 'crash' : ''].join(' ')} onClick={() => choose(key)}>
                  <span className="menu-icon">{s.live ? <span className="live-dot" /> : <Icon name={s.reason === 'crash' ? 'skull' : 'save'} size={15} />}</span>
                  <span className="menu-text">
                    <span className="menu-title">
                      {sessionTitle(s)}
                      {s.reason === 'crash' && <span className="badge badge-fatal">CRASH</span>}
                    </span>
                    <span className="menu-sub tnum">
                      {fmtDateTime(s.startMs)} · {fmtDuration(dur)} · {s.screenshotCount} shots · {s.eventCount} events
                      {s.appVersion ? ` · ${s.appVersion}` : ''}
                    </span>
                  </span>
                  {!s.live && (
                    <span
                      className="menu-del"
                      onClick={(e) => {
                        e.stopPropagation();
                        void remove(s);
                      }}
                    >
                      <IconButton icon="trash" label={`Delete ${sessionTitle(s)}`} />
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- banners --

function Banners() {
  const conn = useStore(liveStore, (s) => s.conn);
  const loaded = useStore(liveStore, (s) => s.loaded);
  const selected = useStore(appStore, (s) => s.selected);
  const view = useSessionView();
  const [showDown, setShowDown] = useState(false);
  // Don't flash the banner on a quick reconnect.
  useEffect(() => {
    if (conn !== 'down') return setShowDown(false);
    const t = setTimeout(() => setShowDown(true), 1200);
    return () => clearTimeout(t);
  }, [conn]);
  return (
    <>
      {showDown && (
        <div className="banner banner-down" role="alert">
          <span className="spinner sm" />
          <span>
            <b>Disconnected from the app, retrying…</b> It may have been killed, crashed or restarted. {loaded ? 'Data below is from before the drop.' : ''}
          </span>
        </div>
      )}
      {selected !== 'live' && (
        <div className={view.crash ? 'banner banner-saved crash' : 'banner banner-saved'}>
          <Icon name={view.crash ? 'skull' : 'save'} size={15} />
          <span className="banner-text">
            Viewing saved session <b>{view.summary ? sessionTitle(view.summary) : selected}</b>
            {view.summary && <span className="muted"> · {fmtDateTime(view.summary.startMs)}</span>} (read-only). Mocks, Flags, Storage, Device and Actions still act on the live app.
          </span>
          <button type="button" className="btn sm" onClick={() => appStore.set({ selected: 'live' })}>
            <span className="live-dot" />
            <span>Back to live</span>
          </button>
        </div>
      )}
    </>
  );
}

// -------------------------------------------------------------------- nav --

function Nav({ active }: { active: Panel }) {
  const view = useSessionView();
  const mocks = useStore(liveStore, (s) => s.mocks);
  const flags = useStore(liveStore, (s) => s.flags);
  const embed = useStore(appStore, (s) => s.embed);
  const collapsed = useStore(appStore, (s) => s.navCollapsed);
  const netErrors = useMemo(() => view.network.filter(isNetworkError).length, [view.network]);
  const badges: Partial<Record<Panel, { n: number | string; tone?: 'err' | 'accent' } | null>> = {
    network: view.network.length ? { n: view.network.length, tone: netErrors ? 'err' : undefined } : null,
    logs: view.logs.length ? { n: view.logs.length > 999 ? `${Math.floor(view.logs.length / 1000)}k` : view.logs.length } : null,
    crashes: view.crashes.length ? { n: view.crashes.length, tone: view.sessionCrashes.length ? 'err' : undefined } : null,
    mocks: mocks?.some((m) => m.enabled) ? { n: mocks.filter((m) => m.enabled).length, tone: 'accent' } : null,
    flags: flags?.some((f) => f.override != null) ? { n: flags.filter((f) => f.override != null).length, tone: 'accent' } : null,
  };
  const saved = view.kind === 'saved';
  return (
    <nav className="nav" aria-label="Panels">
      {!embed && <div className="nav-group">{saved ? 'Saved session' : 'Session'}</div>}
      {NAV.map((n, i) => {
        const b = badges[n.id];
        return (
          <span key={n.id} className="nav-slot">
            {!embed && i === 4 && <div className="nav-group">Live app</div>}
            <a href={`#/${n.id}`} className={n.id === active ? 'nav-item on' : 'nav-item'} aria-current={n.id === active ? 'page' : undefined} title={n.label}>
              <Icon name={n.icon} size={17} />
              <span className="nav-label">{n.label}</span>
              {b && <span className={`nav-badge ${b.tone ?? ''}`}>{b.n}</span>}
            </a>
          </span>
        );
      })}
      {!embed && (
        <button
          type="button"
          className="nav-item nav-collapse"
          onClick={() => setNavCollapsed(!collapsed)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <Icon name="sidebar" size={17} />
          <span className="nav-label">Collapse</span>
        </button>
      )}
    </nav>
  );
}

// -------------------------------------------------------------------- pin --

function PinScreen() {
  const busy = useStore(authStore, (s) => s.busy);
  const error = useStore(authStore, (s) => s.error);
  const [pin, setPin] = useState('');
  const submit = async () => {
    if (pin.length < 4) return;
    if (!(await submitPin(pin))) setPin('');
  };
  return (
    <div className="pin-screen" role="dialog" aria-modal="true" aria-label="Enter PIN">
      <form
        className="pin-card"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="brand big">
          <span className="rec-dot on" />
          <span className="wordmark">KILLCAM</span>
        </div>
        <h1>Enter the Killcam PIN</h1>
        <p className="muted">You are connecting over Wi-Fi. The PIN is shown in the app’s Killcam notification / settings on the device.</p>
        <input
          className="input pin-input mono"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          aria-label="PIN"
          placeholder="••••••"
        />
        {error && <div className="text-error">{error}</div>}
        <button type="submit" className="btn primary full" disabled={busy || pin.length < 4}>
          <Icon name="lock" size={14} />
          <span>{busy ? 'Checking…' : 'Unlock'}</span>
        </button>
        <p className="muted small">Over USB (adb forward) no PIN is needed.</p>
      </form>
    </div>
  );
}
