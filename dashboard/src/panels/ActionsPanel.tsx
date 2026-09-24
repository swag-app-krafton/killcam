import { useMemo, useState } from 'react';
import { Button, Card, ChipButton, EmptyState, Grid, Row, SectionTitle, Stack, Text } from '@/design';
import { api, enc, errorMessage } from '../api/client';
import type { ActionInfo, ActionResult } from '../api/types';
import { TextInput } from '../kit/controls';
import { plural } from '../lib/format';
import { useAsync } from '../lib/hooks';
import { load, save } from '../lib/storage';
import { confirmDialog, toast } from '../state/ui';

const EXAMPLES = ['swagpay://scan', 'upi://pay?pa=chaiwala.ramesh@ybl&pn=RAMESH%20KUMAR&am=45.00&cu=INR'];
const RECENT_KEY = 'killcam.deeplinks';

/** Actions that end the session or wipe state ask first. */
const risky = (a: ActionInfo) => /danger|destructive/i.test(a.group ?? '') || /crash|wipe|clear.?data|logout|log out/i.test(`${a.id} ${a.label}`);

export function ActionsPanel() {
  const actions = useAsync((sig) => api.get<ActionInfo[]>('actions', undefined, sig), []);
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
    if (risky(a) && !(await confirmDialog({ title: `${a.label}?`, message: a.description ?? 'This changes the running app.', confirmLabel: a.label, danger: true }))) return;
    setRunning(a.id);
    try {
      const r = await api.post<ActionResult>(`actions/${enc(a.id)}`);
      setResults((x) => ({ ...x, [a.id]: r }));
      toast(r.message ?? (r.ok ? `${a.label}: done` : `${a.label}: it did not work`), r.ok ? 'ok' : 'error');
    } catch (e) {
      const r = { ok: false, message: errorMessage(e) };
      setResults((x) => ({ ...x, [a.id]: r }));
      toast(`${a.label}: ${r.message}`, 'error');
    } finally {
      setRunning(null);
    }
  };

  return (
    <Stack as="section" gap={28}>
      <DeepLink />
      {actions.error ? (
        <EmptyState title="Could not load the actions" actions={<Button variant="outline" onClick={actions.reload}>Try again</Button>}>
          {errorMessage(actions.error)}
        </EmptyState>
      ) : !actions.data ? (
        <EmptyState>Loading actions…</EmptyState>
      ) : !actions.data.length ? (
        <EmptyState title="No actions registered">
          Register buttons from the app, for example Killcam.registerAction("Expire session", group = "Session") {'{'} … {'}'}, and they appear here.
        </EmptyState>
      ) : (
        groups.map(([group, list]) => (
          <Stack key={group} as="section" gap={14}>
            <SectionTitle aside={plural(list.length, 'action')}>{group}</SectionTitle>
            <Grid min={300} gap={12}>
              {list.map((a) => {
                const r = results[a.id];
                return (
                  <Card
                    key={a.id}
                    title={a.label}
                    hint={a.description ? <span style={{ overflowWrap: 'anywhere' }}>{a.description}</span> : undefined}
                    edge={risky(a) ? { side: 'left', color: 'var(--fail)', width: 3 } : undefined}
                    actions={
                      <Button variant="secondary" size="sm" onClick={() => run(a)} disabled={running === a.id}>
                        {running === a.id ? 'Running…' : 'Run'}
                      </Button>
                    }
                  >
                    {r ? (
                      <Text variant="small" tone={r.ok ? 'pass' : 'fail'}>
                        {r.ok ? '✓' : '✕'} {r.message ?? (r.ok ? 'Done' : 'It did not work')}
                      </Text>
                    ) : (
                      <Text variant="meta">{risky(a) ? 'Asks before it runs.' : 'Runs on the app’s main thread.'}</Text>
                    )}
                  </Card>
                );
              })}
            </Grid>
          </Stack>
        ))
      )}
    </Stack>
  );
}

function DeepLink() {
  const [uri, setUri] = useState('');
  const [recent, setRecent] = useState<string[]>(() => load<string[]>(RECENT_KEY, []));
  const [last, setLast] = useState<ActionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const launch = async (u = uri) => {
    const value = u.trim();
    if (!value) return;
    setBusy(true);
    try {
      const r = await api.post<ActionResult>('deeplink', { uri: value });
      setLast(r);
      toast(r.message ?? (r.ok ? 'Opened' : 'Nothing handled it'), r.ok ? 'ok' : 'error');
      const next = [value, ...recent.filter((x) => x !== value)].slice(0, 8);
      setRecent(next);
      save(RECENT_KEY, next);
    } catch (e) {
      toast(`Could not open the link: ${errorMessage(e)}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Open a deep link" hint="Starts the app’s handler for a URI, as if another app had opened it.">
      <Stack gap={12}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void launch();
          }}
        >
          <Row gap={8}>
            <TextInput mono value={uri} placeholder="swagpay://… or upi://pay?pa=…" onChange={(e) => setUri(e.target.value)} aria-label="Deep link URI" />
            <Button type="submit" variant="primary" size="sm" disabled={busy || !uri.trim()}>
              Open
            </Button>
          </Row>
        </form>
        <Row gap={6} wrap>
          <Text variant="meta">{recent.length ? 'Recent:' : 'Try:'}</Text>
          {(recent.length ? recent : EXAMPLES).map((c) => (
            <ChipButton key={c} onClick={() => setUri(c)} title={c} style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {c}
            </ChipButton>
          ))}
        </Row>
        {last && (
          <Text variant="small" tone={last.ok ? 'pass' : 'fail'}>
            {last.ok ? '✓' : '✕'} {last.message ?? (last.ok ? 'Opened' : 'Nothing handled it')}
          </Text>
        )}
      </Stack>
    </Card>
  );
}
