import { useCallback, useEffect, useState } from 'react';

/**
 * Killcam inside React Native DevTools.
 *
 * Rozenite panels only see the JavaScript runtime. Killcam runs in the native
 * process and already serves its dashboard over HTTP, so this panel embeds
 * that dashboard: native Compose screens, OkHttp traffic, logcat, crashes,
 * replay, MMKV and Remote Config sit next to Rozenite's own JS-side panels.
 *
 * The device's Killcam port is reached through `adb forward`, the same way
 * Metro is reached through `adb reverse`.
 */

type Probe = 'checking' | 'up' | 'down';

const STORAGE_KEY = 'killcam.devtools.port';
const DEFAULT_PORT = 8090;
const COLORS = {
  bg: '#0f1012',
  surface: '#17181b',
  border: '#2a2c31',
  text: '#e8e8ea',
  muted: '#8d9099',
  accent: '#f2a900',
  rec: '#ff3b3b',
};

function readPort(): number {
  try {
    const stored = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isInteger(stored) && stored > 0 && stored < 65536 ? stored : DEFAULT_PORT;
  } catch {
    return DEFAULT_PORT;
  }
}

function savePort(port: number) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(port));
  } catch {
    // Storage can be unavailable in DevTools frames; the default still works.
  }
}

/** An opaque no-cors fetch resolves iff something answers on the port. */
async function probe(port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 1500);
    await fetch(`http://localhost:${port}/api/status`, {
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    window.clearTimeout(timer);
    return true;
  } catch {
    return false;
  }
}

export default function KillcamPanel() {
  const [port, setPort] = useState(readPort);
  const [draft, setDraft] = useState(String(readPort()));
  const [state, setState] = useState<Probe>('checking');
  const [frameKey, setFrameKey] = useState(0);
  const [copied, setCopied] = useState(false);

  const check = useCallback(async () => {
    setState((await probe(port)) ? 'up' : 'down');
  }, [port]);

  useEffect(() => {
    setState('checking');
    void check();
  }, [check]);

  // While disconnected, keep looking: the app may still be installing or restarting.
  useEffect(() => {
    if (state !== 'down') return undefined;
    const timer = window.setInterval(() => void check(), 3000);
    return () => window.clearInterval(timer);
  }, [state, check]);

  const applyPort = () => {
    const next = Number(draft);
    if (!Number.isInteger(next) || next <= 0 || next > 65535) return;
    savePort(next);
    setPort(next);
  };

  const command = `adb forward tcp:${port} tcp:${port}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const url = `http://localhost:${port}/`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: COLORS.bg, color: COLORS.text, font: '13px system-ui, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderBottom: `1px solid ${COLORS.border}`, background: COLORS.surface }}>
        <span style={{ color: COLORS.rec }} aria-hidden>●</span>
        <strong style={{ letterSpacing: '0.12em' }}>KILLCAM</strong>
        <span style={{ color: COLORS.muted }}>localhost:</span>
        <input
          aria-label="Killcam port"
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
          onBlur={applyPort}
          onKeyDown={(e) => e.key === 'Enter' && applyPort()}
          style={{ width: 56, background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}`, borderRadius: 4, padding: '2px 6px', fontFamily: 'ui-monospace, monospace' }}
        />
        <span style={{ color: state === 'up' ? '#3ecf8e' : state === 'down' ? COLORS.rec : COLORS.muted }}>
          {state === 'up' ? 'connected' : state === 'down' ? 'not reachable' : 'checking…'}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => setFrameKey((k) => k + 1)} style={buttonStyle}>Reload</button>
        <a href={url} target="_blank" rel="noreferrer" style={{ ...buttonStyle, textDecoration: 'none' }}>Open in browser ↗</a>
      </div>

      {state === 'up' ? (
        <iframe
          key={`${port}-${frameKey}`}
          title="Killcam dashboard"
          src={`${url}?embed=devtools`}
          style={{ flex: 1, border: 0, width: '100%' }}
        />
      ) : (
        <div style={{ padding: 24, maxWidth: 640, lineHeight: 1.6 }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Connect to Killcam on the device</h2>
          <ol style={{ paddingLeft: 18, color: COLORS.muted }}>
            <li>Run a debug build with <code>Killcam.install()</code> (it logs the port on start).</li>
            <li>
              Forward the port:{' '}
              <code style={{ color: COLORS.accent }}>{command}</code>{' '}
              <button type="button" onClick={copy} style={buttonStyle}>{copied ? 'Copied' : 'Copy'}</button>
            </li>
            <li>This panel connects automatically.</li>
          </ol>
          <p style={{ color: COLORS.muted }}>
            JS-only state (react-native-mmkv, AsyncStorage, TanStack Query, Redux) lives in Rozenite's own
            panels; Killcam covers the native side: Compose screens, OkHttp, logcat, crashes and replay,
            SharedPreferences, SQLite, native MMKV and Firebase Remote Config.
          </p>
        </div>
      )}
    </div>
  );
}

const buttonStyle = {
  background: COLORS.bg,
  color: COLORS.text,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 4,
  padding: '3px 10px',
  font: 'inherit',
  cursor: 'pointer',
} as const;
