import { useEffect } from 'react';
import { liveStore, reloadInfo } from '../api/live';
import { Icon } from '../components/Icon';
import { CopyButton, IconButton, KeyValueTable, Loading } from '../components/ui';
import { fmtDateTime } from '../lib/format';
import { useStore } from '../state/store';

export function DevicePanel() {
  const info = useStore(liveStore, (s) => s.info);
  const status = useStore(liveStore, (s) => s.status);
  useEffect(() => {
    reloadInfo().catch(() => undefined);
  }, []);
  if (!info) return <div className="panel"><Loading /></div>;

  const asText = () =>
    [
      `${info.appName} ${info.versionName} (${info.versionCode}) ${info.buildType}`,
      info.deviceName,
      `Killcam ${info.killcamVersion} · session ${info.sessionId}`,
      '',
      ...info.sections.flatMap((s) => [`[${s.title}]`, ...s.items.map((i) => `${i.label}: ${i.value}`), '']),
    ].join('\n');

  const port = status?.port ?? 8090;
  return (
    <div className="panel">
      <div className="toolbar">
        <div className="toolbar-title">
          <Icon name="device" />
          <span>Device &amp; app</span>
        </div>
        <span className="grow" />
        <CopyButton text={asText} label="Copy as text" showLabel />
        <IconButton icon="refresh" label="Refresh" onClick={() => reloadInfo().catch(() => undefined)} />
      </div>
      <div className="scroll pad">
        <div className="cards">
          <section className="card card-hero">
            <div className="hero-app">
              <div className="hero-icon">{info.appName.slice(0, 1)}</div>
              <div>
                <h2>{info.appName}</h2>
                <div className="muted mono">{info.packageName}</div>
              </div>
            </div>
            <KeyValueTable
              rows={[
                ['Version', `${info.versionName} (${info.versionCode})`],
                ['Build type', info.buildType],
                ['Device', info.deviceName],
                ['Session', <span className="break">{info.sessionId}</span>],
                ['Session started', fmtDateTime(info.sessionStartMs, true)],
                ['Killcam', info.killcamVersion],
              ]}
            />
          </section>
          <section className="card">
            <h3>
              <Icon name={status?.remote ? 'wifi' : 'usb'} size={14} /> Connection
            </h3>
            <KeyValueTable
              rows={[
                ['You are on', status ? (status.remote ? 'Wi-Fi (PIN)' : 'USB / loopback') : '—'],
                ['Port', String(port)],
                ['Wi-Fi sharing', status ? (status.wifiEnabled ? 'on' : 'off') : '—'],
                [
                  'Wi-Fi URL',
                  status?.wifiUrl ? (
                    <span className="inline-copy">
                      <span className="break">{status.wifiUrl}</span>
                      <CopyButton text={status.wifiUrl} label="Copy Wi-Fi URL" />
                    </span>
                  ) : (
                    <span className="muted">off</span>
                  ),
                ],
                ['Capture', status ? (status.capturePaused ? 'paused' : 'recording') : '—'],
              ]}
            />
            <div className="howto">
              <div className="muted small">From a laptop over USB:</div>
              <div className="inline-copy">
                <code className="mono">adb forward tcp:{port} tcp:{port}</code>
                <CopyButton text={`adb forward tcp:${port} tcp:${port}`} label="Copy adb command" />
              </div>
              <div className="muted small">
                then open <span className="mono">http://localhost:{port}</span>
              </div>
            </div>
          </section>
          {info.sections.map((s) => (
            <section key={s.title} className="card">
              <h3>{s.title}</h3>
              <KeyValueTable rows={s.items.map((i) => [i.label, <span className="break">{i.value}</span>])} />
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
