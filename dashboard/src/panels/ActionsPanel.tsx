import { useMemo, useState } from 'react';
import { api, enc, errorMessage } from '../api/client';
import type { ActionInfo, ActionResult } from '../api/types';
import { Icon } from '../components/Icon';
import { EmptyState, IconButton, Loading } from '../components/ui';
import { useAsync } from '../lib/hooks';
import { load, save } from '../lib/storage';
import { confirmDialog, toast } from '../state/ui';

const EXAMPLES = ['swagpay://scan', 'upi://pay?pa=chaiwala.ramesh@ybl&pn=RAMESH%20KUMAR&am=45.00&cu=INR'];

function isDangerous(a: ActionInfo): boolean {
  return /danger|destructive/i.test(a.group ?? '') || /crash|wipe|clear.?data|logout|log out/i.test(`${a.id} ${a.label}`);
}

export function ActionsPanel() {
  const actions = useAsync((s) => api.get<ActionInfo[]>('actions', undefined, s), []);
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ActionResult>>({});

  const groups = useMemo(() => {
    const m = new Map<string, ActionInfo[]>();
    for (const a of actions.data ?? []) {
      const g = a.group ?? 'General';
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(a);
    }
    return [...m.entries()];
  }, [actions.data]);

  const run = async (a: ActionInfo) => {
    if (isDangerous(a) && !(await confirmDialog({ title: `${a.label}?`, message: a.description ?? 'This affects the running app.', confirmLabel: a.label, danger: true }))) return;
    setRunning(a.id);
    try {
      const r = await api.post<ActionResult>(`actions/${enc(a.id)}`);
      setResults((x) => ({ ...x, [a.id]: r }));
      toast(r.message ?? (r.ok ? `${a.label}: done` : `${a.label}: failed`), r.ok ? 'ok' : 'error');
    } catch (e) {
      const r = { ok: false, message: errorMessage(e) };
      setResults((x) => ({ ...x, [a.id]: r }));
      toast(`${a.label}: ${r.message}`, 'error');
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="panel">
      <div className="toolbar">
        <div className="toolbar-title">
          <Icon name="bolt" />
          <span>Actions</span>
        </div>
        <span className="grow" />
        <IconButton icon="refresh" label="Reload actions" onClick={actions.reload} />
      </div>
      <div className="scroll pad">
        <DeepLink />
        {actions.error ? (
          <EmptyState icon="warning" tone="error" title="Could not load actions">
            {errorMessage(actions.error)}
          </EmptyState>
        ) : !actions.data ? (
          <Loading />
        ) : !actions.data.length ? (
          <EmptyState icon="bolt" title="No actions registered">
            Register debug actions from the app (expire session, reset onboarding, …) and they show up here.
          </EmptyState>
        ) : (
          groups.map(([group, list]) => (
            <section key={group} className={/danger/i.test(group) ? 'action-group danger-zone' : 'action-group'}>
              <h3>{group}</h3>
              <div className="action-grid">
                {list.map((a) => {
                  const r = results[a.id];
                  return (
                    <div key={a.id} className={isDangerous(a) ? 'action-card danger' : 'action-card'}>
                      <div className="action-text">
                        <b>{a.label}</b>
                        {a.description && <span className="muted">{a.description}</span>}
                        {r && (
                          <span className={r.ok ? 'action-result ok' : 'action-result err'}>
                            <Icon name={r.ok ? 'check' : 'warning'} size={12} /> {r.message ?? (r.ok ? 'Done' : 'Failed')}
                          </span>
                        )}
                      </div>
                      <button type="button" className={isDangerous(a) ? 'btn danger' : 'btn'} onClick={() => run(a)} disabled={running === a.id}>
                        {running === a.id ? 'Running…' : 'Run'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function DeepLink() {
  const [uri, setUri] = useState('');
  const [recent, setRecent] = useState<string[]>(() => load<string[]>('killcam.deeplinks', []));
  const [last, setLast] = useState<ActionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const launch = async (u = uri) => {
    const value = u.trim();
    if (!value) return;
    setBusy(true);
    try {
      const r = await api.post<ActionResult>('deeplink', { uri: value });
      setLast(r);
      toast(r.message ?? (r.ok ? 'Opened' : 'Not handled'), r.ok ? 'ok' : 'error');
      const next = [value, ...recent.filter((x) => x !== value)].slice(0, 8);
      setRecent(next);
      save('killcam.deeplinks', next);
    } catch (e) {
      toast(`Deep link failed: ${errorMessage(e)}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  const chips = recent.length ? recent : EXAMPLES;
  return (
    <section className="action-group">
      <h3>Deep link</h3>
      <form
        className="deeplink"
        onSubmit={(e) => {
          e.preventDefault();
          void launch();
        }}
      >
        <input className="input mono" value={uri} placeholder="swagpay://… or upi://pay?pa=…" onChange={(e) => setUri(e.target.value)} aria-label="Deep link URI" spellCheck={false} />
        <button type="submit" className="btn primary" disabled={busy || !uri.trim()}>
          <Icon name="link" size={14} />
          <span>Launch</span>
        </button>
      </form>
      <div className="chips wrap">
        <span className="muted small">{recent.length ? 'Recent:' : 'Try:'}</span>
        {chips.map((c) => (
          <button key={c} type="button" className="chip mono" onClick={() => setUri(c)} onDoubleClick={() => launch(c)} title="Click to edit, double-click to launch">
            {c.length > 60 ? c.slice(0, 57) + '…' : c}
          </button>
        ))}
      </div>
      {last && (
        <div className={last.ok ? 'action-result ok' : 'action-result err'}>
          <Icon name={last.ok ? 'check' : 'warning'} size={12} /> {last.message ?? (last.ok ? 'Opened' : 'Not handled')}
        </div>
      )}
    </section>
  );
}
