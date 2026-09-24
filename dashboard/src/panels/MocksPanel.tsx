import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, EmptyState, FlushCard, Row, Segmented, Spacer, Stack, StatusPill, Switch, Table, TableEmptyRow, Text, numCell } from '@/design';
import { api, enc, errorMessage } from '../api/client';
import { liveStore, reloadMocks } from '../api/live';
import type { BreakOn, Endpoint, Header, MatchType, MockAction, MockFailure, MockRule, MockRuleInput } from '../api/types';
import { tryParseJson } from '../kit/console';
import { FormField, IconBtn, MethodTag, SelectInput, TextArea, TextInput } from '../kit/controls';
import { KeyValueEditor } from '../kit/editors';
import { KDialog } from '../kit/overlays';
import { fmt, fmtBytes, plural } from '../lib/format';
import { compilePattern } from '../lib/match';
import { appStore } from '../state/app';
import { useStore } from '../state/store';
import { confirmDialog, toast } from '../state/ui';
import { NetworkConditionsCard } from './NetworkConditions';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const MATCH: { value: MatchType; label: string; hint: string }[] = [
  { value: 'contains', label: 'Contains', hint: 'The URL contains the pattern.' },
  { value: 'exact', label: 'Exact', hint: 'The whole URL, query included, equals the pattern.' },
  { value: 'glob', label: 'Glob', hint: 'The whole URL matches, where * is any run of characters and ? is one character.' },
  { value: 'regex', label: 'Regex', hint: 'A regular expression found anywhere in the URL. Anchor it with ^…$ for a full match.' },
];
/** Each thrown the way Android throws it, with the same wording. */
const FAILURES: { value: MockFailure; label: string; short: string; hint: string }[] = [
  { value: 'dns_failure', label: 'DNS cannot resolve (UnknownHostException)', short: 'DNS failure', hint: 'Unable to resolve host "…": No address associated with hostname. No connectivity, or DNS lost after a network switch.' },
  { value: 'network_switch', label: 'Network switch mid-response (SocketException)', short: 'network switch', hint: 'The real call goes out and its headers arrive, then the body aborts with "Software caused connection abort", as when the phone moves between Wi-Fi and mobile data.' },
  { value: 'connection_refused', label: 'Connection refused (ConnectException)', short: 'connection refused', hint: 'Failed to connect to host/port. The server is down or the port is closed.' },
  { value: 'connect_timeout', label: 'Connect timeout (SocketTimeoutException)', short: 'connect timeout', hint: 'Failed to connect after 10000 ms. An unreachable host or a captive portal.' },
  { value: 'timeout', label: 'Read timeout (SocketTimeoutException)', short: 'read timeout', hint: 'Connected, but the server is too slow to answer.' },
  { value: 'connection_reset', label: 'Connection reset (SocketException)', short: 'connection reset', hint: 'The server or something in between closed the socket.' },
  { value: 'unexpected_eof', label: 'Unexpected end of stream (IOException)', short: 'unexpected end of stream', hint: 'The server closed a reused connection before answering.' },
  { value: 'ssl_handshake', label: 'TLS handshake failure (SSLHandshakeException)', short: 'TLS handshake failure', hint: 'Certificate pinning or trust failure, for example behind a corporate proxy.' },
  { value: 'no_network', label: 'No network (UnknownHostException)', short: 'no network', hint: 'The same exception as a DNS failure; kept for older rules.' },
];
const QUICK = [200, 201, 204, 400, 401, 402, 403, 404, 429, 500, 502, 503, 504];

const JSON_TYPE: Header = { name: 'content-type', value: 'application/json' };
const pretty = (v: unknown) => JSON.stringify(v, null, 2);
/** One click to a realistic API error: fills the Respond fields. */
const TEMPLATES: { label: string; hint: string; apply: Partial<MockRuleInput> }[] = [
  { label: '500 server error', hint: 'Internal server error with a JSON error body', apply: { status: 500, delayMs: 0, headers: [JSON_TYPE], body: pretty({ error: { code: 'INTERNAL', message: 'Something went wrong' } }) } },
  { label: '503 unavailable', hint: 'Maintenance or overload, with Retry-After', apply: { status: 503, delayMs: 0, headers: [JSON_TYPE, { name: 'Retry-After', value: '30' }], body: pretty({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Try again later' } }) } },
  { label: '429 rate limited', hint: 'Too many requests, with Retry-After', apply: { status: 429, delayMs: 0, headers: [JSON_TYPE, { name: 'Retry-After', value: '10' }], body: pretty({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }) } },
  { label: '401 session expired', hint: 'An expired token: the app should refresh it or sign out', apply: { status: 401, delayMs: 0, headers: [JSON_TYPE], body: pretty({ error: 'token_expired' }) } },
  {
    label: '502 HTML page',
    hint: 'A gateway error page: HTML where the app expects JSON',
    apply: { status: 502, delayMs: 0, headers: [{ name: 'content-type', value: 'text/html' }], body: '<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>nginx</center></body></html>' },
  },
  { label: '504 after 30 s', hint: 'A gateway timeout that arrives after a long wait', apply: { status: 504, delayMs: 30_000, headers: [JSON_TYPE], body: pretty({ error: { code: 'GATEWAY_TIMEOUT', message: 'Upstream timed out' } }) } },
  { label: 'Malformed JSON', hint: '200 with a cut-off JSON body, to test parse-error handling', apply: { status: 200, delayMs: 0, headers: [JSON_TYPE], body: '{"status":"SUCCESS","data":{"items":[{"id":1,"na' } },
  { label: 'Empty 200', hint: '200 with an empty body where JSON is expected', apply: { status: 200, delayMs: 0, headers: [JSON_TYPE], body: '' } },
];

export function emptyRule(): MockRuleInput {
  return {
    name: '',
    enabled: true,
    method: null,
    urlPattern: '',
    matchType: 'contains',
    action: 'respond',
    status: 200,
    headers: [{ name: 'content-type', value: 'application/json' }],
    body: '{\n  \n}',
    delayMs: 0,
    failure: 'timeout',
    dropAfterBytes: 0,
    times: 0,
    probability: 100,
    endpoint: null,
    breakOn: 'request',
  };
}
const toInput = ({ id: _i, hits: _h, createdMs: _c, ...input }: MockRule): MockRuleInput => input;

function answer(r: MockRule): string {
  const share = r.probability < 100 ? ` · ${fmt(r.probability)}% of calls` : '';
  return baseAnswer(r) + share;
}

function baseAnswer(r: MockRule): string {
  if (r.action === 'breakpoint') return `Pauses ${r.breakOn === 'both' ? 'the request and the response' : r.breakOn === 'request' ? 'before sending' : 'before the app reads the response'}`;
  if (r.action === 'respond') return `Responds ${r.status}${r.body ? ` · ${fmtBytes(new Blob([r.body]).size)}` : ''}${r.delayMs ? ` after ${fmt(r.delayMs)} ms` : ''}`;
  if (r.action === 'delay') return `Waits ${fmt(r.delayMs)} ms, then makes the real call`;
  if (r.failure === 'network_switch') return `Drops the connection after ${fmtBytes(r.dropAfterBytes)} of the body`;
  return `Fails: ${FAILURES.find((f) => f.value === r.failure)?.short ?? r.failure}${r.delayMs ? ` after ${fmt(r.delayMs)} ms` : ''}`;
}

/** "2 of 3 used" for a rule limited by times, else the plain hit count. */
function hits(r: MockRule): string {
  if (r.times > 0) return `${fmt(Math.min(r.hits, r.times))} of ${fmt(r.times)} used`;
  return plural(r.hits, 'hit');
}

export function MocksPanel() {
  const mocks = useStore(liveStore, (x) => x.mocks);
  const draft = useStore(appStore, (x) => x.mockDraft);
  const embed = useStore(appStore, (x) => x.embed);
  const [editing, setEditing] = useState<{ id: string | null; input: MockRuleInput; testUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // "Mock this" in Network hands over a prefilled rule.
  useEffect(() => {
    if (draft) {
      setEditing({ id: null, input: draft.input, testUrl: draft.testUrl });
      appStore.set({ mockDraft: null });
    }
  }, [draft]);
  useEffect(() => {
    if (!mocks) reloadMocks().catch(() => undefined);
  }, [mocks]);

  const update = async (r: MockRule, patch: Partial<MockRuleInput>) => {
    try {
      await api.put<MockRule>(`mocks/${enc(r.id)}`, { ...toInput(r), ...patch });
      await reloadMocks();
    } catch (e) {
      toast(`Could not update the rule: ${errorMessage(e)}`, 'error');
    }
  };
  const move = async (index: number, delta: number) => {
    if (!mocks) return;
    const ids = mocks.map((m) => m.id);
    const j = index + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    setBusy(true);
    liveStore.set({ mocks: ids.map((id) => mocks.find((m) => m.id === id)!) });
    try {
      liveStore.set({ mocks: await api.put<MockRule[]>('mocks', ids) });
    } catch (e) {
      toast(`Could not reorder the rules: ${errorMessage(e)}`, 'error');
      await reloadMocks().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };
  const rearm = async (r: MockRule) => {
    try {
      await api.post<MockRule>(`mocks/${enc(r.id)}/reset`);
      await reloadMocks();
    } catch (e) {
      toast(`Could not reset the rule: ${errorMessage(e)}`, 'error');
    }
  };
  const remove = async (r: MockRule) => {
    if (!(await confirmDialog({ title: `Delete “${r.name}”?`, message: 'Calls it matched go to the server again.', confirmLabel: 'Delete rule', danger: true }))) return false;
    try {
      await api.del(`mocks/${enc(r.id)}`);
      await reloadMocks();
      toast('Rule deleted', 'ok');
      return true;
    } catch (e) {
      toast(`Could not delete the rule: ${errorMessage(e)}`, 'error');
      return false;
    }
  };
  const edit = (r: MockRule) => setEditing({ id: r.id, input: toInput(r), testUrl: '' });

  if (!mocks) return <EmptyState>Loading rules…</EmptyState>;
  const enabled = mocks.filter((m) => m.enabled).length;

  return (
    <Stack as="section" gap={20}>
      <NetworkConditionsCard />
      <Row gap={10} wrap>
        <Text variant="small" tone="muted">
          {plural(mocks.length, 'rule')}, {fmt(enabled)} enabled. The first enabled rule that matches a call answers it.
        </Text>
        <Spacer />
        <Button variant="primary" size="sm" onClick={() => setEditing({ id: null, input: emptyRule(), testUrl: '' })}>
          New rule
        </Button>
      </Row>
      {mocks.length === 0 ? (
        <EmptyState title="No mock rules" actions={<Button variant="outline" onClick={() => setEditing({ id: null, input: emptyRule(), testUrl: '' })}>New rule</Button>}>
          A rule answers matching calls with a canned response or an API error, adds latency, fails them the way real networks do, or pauses them so you can edit them, without touching the backend. Start one here, pick an endpoint in Endpoints, or open a call in Network and choose Mock this.
        </EmptyState>
      ) : embed ? (
        <FlushCard>
          {mocks.map((r, i) => (
            <div key={r.id} data-hl={`mock:${r.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 8px 10px 12px', borderBottom: '1px solid var(--line)', opacity: r.enabled ? 1 : 0.6 }}>
              <Stack gap={0}>
                <IconBtn icon="chevron-up" size="lg" label={`Move ${r.name} up`} disabled={busy || i === 0} onClick={() => move(i, -1)} />
                <IconBtn icon="chevron-down" size="lg" label={`Move ${r.name} down`} disabled={busy || i === mocks.length - 1} onClick={() => move(i, 1)} />
              </Stack>
              <Stack gap={4} grow>
                <Text variant="body" tone="primary" weight={600} truncate>
                  {i + 1}. {r.name}
                </Text>
                <Row gap={6}>
                  {r.method ? <MethodTag method={r.method} /> : <Text variant="meta">Any</Text>}
                  <Text variant="mono" truncate>
                    {r.endpoint ?? r.urlPattern}
                  </Text>
                </Row>
                <Text variant="meta">
                  {answer(r)} · {hits(r)}
                </Text>
                <Row gap={4}>
                  <Switch checked={r.enabled} label={r.enabled ? 'On' : 'Off'} onChange={(on) => update(r, { enabled: on })} />
                  <Spacer />
                  {r.hits > 0 && (
                    <Button variant="quiet" size="sm" onClick={() => rearm(r)}>
                      Reset hits
                    </Button>
                  )}
                  <Button variant="secondary" size="sm" onClick={() => edit(r)}>
                    Edit
                  </Button>
                </Row>
              </Stack>
            </div>
          ))}
        </FlushCard>
      ) : (
        <FlushCard title="Rules" hint="In the order they are tried. Hits count the calls a rule answered; a rule limited to its first calls lets later ones through.">
          <Table minWidth={920} label="Mock rules">
            <thead>
              <tr>
                <th>Order</th>
                <th>On</th>
                <th>Rule</th>
                <th>Answer</th>
                <th className={numCell}>Hits</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {mocks.length === 0 && <TableEmptyRow colSpan={6}>No rules.</TableEmptyRow>}
              {mocks.map((r, i) => (
                <tr key={r.id} data-hl={`mock:${r.id}`}>
                  <td>
                    <Row gap={2}>
                      <Text variant="small" tone="muted" nowrap>
                        {String(i + 1).padStart(2, '0')}
                      </Text>
                      <IconBtn icon="chevron-up" size="sm" label={`Move ${r.name} up`} disabled={busy || i === 0} onClick={() => move(i, -1)} />
                      <IconBtn icon="chevron-down" size="sm" label={`Move ${r.name} down`} disabled={busy || i === mocks.length - 1} onClick={() => move(i, 1)} />
                    </Row>
                  </td>
                  <td>
                    <Switch checked={r.enabled} label={r.enabled ? 'On' : 'Off'} onChange={(on) => update(r, { enabled: on })} />
                  </td>
                  <td style={{ maxWidth: 420 }}>
                    <Stack gap={4}>
                      <Text variant="body" tone={r.enabled ? 'primary' : 'muted'} weight={600}>
                        {r.name}
                      </Text>
                      <Row gap={8}>
                        {r.method ? <MethodTag method={r.method} /> : <Text variant="meta">Any method</Text>}
                        {r.endpoint ? <Badge tone="accent" title={`Endpoint ${r.endpoint}`}>Endpoint</Badge> : <Badge>{r.matchType}</Badge>}
                        <Text variant="mono" truncate title={r.urlPattern}>
                          {r.urlPattern}
                        </Text>
                      </Row>
                    </Stack>
                  </td>
                  <td>
                    <Text variant="small">{answer(r)}</Text>
                  </td>
                  <td className={numCell}>{r.times > 0 ? hits(r) : fmt(r.hits)}</td>
                  <td>
                    <Row gap={6}>
                      {r.hits > 0 && (
                        <IconBtn icon="refresh" label={r.times > 0 ? `Re-arm ${r.name}` : `Reset the hits of ${r.name}`} onClick={() => void rearm(r)} />
                      )}
                      <Button variant="mini" onClick={() => edit(r)}>
                        Edit
                      </Button>
                      <IconBtn icon="trash" label={`Delete ${r.name}`} onClick={() => void remove(r)} />
                    </Row>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </FlushCard>
      )}
      {editing && (
        <MockEditor
          id={editing.id}
          initial={editing.input}
          initialTestUrl={editing.testUrl}
          onClose={() => setEditing(null)}
          onDelete={
            editing.id
              ? async () => {
                  const r = mocks.find((m) => m.id === editing.id);
                  if (r && (await remove(r))) setEditing(null);
                }
              : undefined
          }
        />
      )}
    </Stack>
  );
}

function MockEditor({ id, initial, initialTestUrl, onClose, onDelete }: { id: string | null; initial: MockRuleInput; initialTestUrl: string; onClose: () => void; onDelete?: () => void }) {
  const [r, setR] = useState<MockRuleInput>(initial);
  const [testUrl, setTestUrl] = useState(initialTestUrl || (initial.matchType === 'exact' ? initial.urlPattern : ''));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const network = useStore(liveStore, (x) => x.network);
  const endpoints = useStore(liveStore, (x) => x.endpoints);
  const endpointGroups = useMemo(() => {
    const m = new Map<string, Endpoint[]>();
    for (const e of endpoints ?? []) m.set(e.group, [...(m.get(e.group) ?? []), e]);
    return [...m.entries()];
  }, [endpoints]);
  const set = (p: Partial<MockRuleInput>) => setR((x) => ({ ...x, ...p }));
  const pickEndpoint = (key: string) => {
    const e = endpoints?.find((x) => x.key === key);
    if (!e) return set({ endpoint: null });
    set({ endpoint: e.key, method: e.method, urlPattern: e.urlPattern, matchType: e.matchType, name: r.name || e.name || e.key });
  };
  const compiled = useMemo(() => compilePattern(r.matchType, r.urlPattern), [r.matchType, r.urlPattern]);
  const test = testUrl && r.urlPattern && !compiled.error ? compiled.test(testUrl) : null;
  const matched = useMemo(() => {
    if (!r.urlPattern || compiled.error) return [];
    const out = new Set<string>();
    for (let i = network.length - 1; i >= 0 && out.size < 50; i--) {
      const c = network[i];
      if ((r.method == null || c.method === r.method) && compiled.test(c.url)) out.add(`${c.method} ${c.url}`);
    }
    return [...out];
  }, [network, compiled, r.method, r.urlPattern]);
  const type = r.headers.find((h) => h.name.toLowerCase() === 'content-type')?.value ?? '';
  const looksJson = type.includes('json') || /^\s*[[{]/.test(r.body);
  const jsonOk = r.body.trim() === '' || tryParseJson(r.body, 'application/json') !== undefined;

  const save = async () => {
    setErr(null);
    if (!r.endpoint && !r.urlPattern.trim()) return setErr('Pick an endpoint or enter a URL pattern.');
    if (compiled.error) return setErr(`The regex is not valid: ${compiled.error}`);
    setSaving(true);
    try {
      const body: MockRuleInput = {
        ...r,
        name: r.name.trim() || `${r.method ?? 'Any'} ${r.endpoint ?? r.urlPattern}`,
        headers: r.headers.filter((h) => h.name.trim()),
        status: Number(r.status) || 200,
        delayMs: Math.max(0, Number(r.delayMs) || 0),
        dropAfterBytes: Math.max(0, Number(r.dropAfterBytes) || 0),
        times: Math.max(0, Math.floor(Number(r.times) || 0)),
        probability: Math.min(100, Math.max(1, Math.floor(Number(r.probability) || 100))),
      };
      if (id) await api.put<MockRule>(`mocks/${enc(id)}`, body);
      else await api.post<MockRule>('mocks', body);
      await reloadMocks();
      toast(id ? 'Rule saved' : 'Rule created', 'ok');
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KDialog open onClose={onClose} title={id ? 'Edit mock rule' : 'New mock rule'} subtitle="Applies to the running app as soon as it is saved." width={760}>
      <Stack gap={24}>
        <Row gap={12} align="end" wrap>
          <FormField label="Name" grow>
            <TextInput value={r.name} placeholder="For example “Pay: insufficient funds”" onChange={(x) => set({ name: x.target.value })} />
          </FormField>
          <Switch checked={r.enabled} onChange={(on) => set({ enabled: on })} label={r.enabled ? 'Enabled' : 'Disabled'} />
        </Row>

        <Stack as="section" gap={12}>
          <Text as="h3" variant="heading-sm">
            Match
          </Text>
          <FormField label="Endpoint" hint={r.endpoint ? 'The method and pattern come from the endpoint catalogue. Choose “Custom URL pattern” to edit them.' : undefined}>
            <SelectInput value={r.endpoint ?? ''} onChange={(x) => pickEndpoint(x.target.value)}>
              <option value="">Custom URL pattern</option>
              {endpointGroups.map(([group, list]) => (
                <optgroup key={group} label={group}>
                  {list.map((e) => (
                    <option key={e.key} value={e.key}>
                      {e.method ?? 'Any'} {e.key}
                      {e.name ? ` · ${e.name}` : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </SelectInput>
          </FormField>
          <Row gap={12} align="end" wrap>
            <FormField label="Method">
              <SelectInput value={r.method ?? ''} disabled={!!r.endpoint} onChange={(x) => set({ method: x.target.value || null })} style={{ width: 140 }}>
                <option value="">Any</option>
                {METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </SelectInput>
            </FormField>
            <FormField label="Match the URL by" group>
              <Segmented<MatchType> label="Match type" value={r.matchType} onChange={(v) => !r.endpoint && set({ matchType: v })} options={MATCH.map(({ value, label }) => ({ value, label }))} />
            </FormField>
          </Row>
          <FormField label="URL pattern" hint={compiled.error ? undefined : MATCH.find((m) => m.value === r.matchType)?.hint}>
            <TextInput
              mono
              value={r.urlPattern}
              readOnly={!!r.endpoint}
              invalid={!!compiled.error}
              placeholder={r.matchType === 'glob' ? 'https://api.swag.gg/v1/upi/*' : r.matchType === 'regex' ? '/v1/contacts\\?page=\\d+' : '/v1/upi/pay'}
              onChange={(x) => set({ urlPattern: x.target.value })}
            />
          </FormField>
          {compiled.error && (
            <Text variant="small" tone="fail">
              ✕ {compiled.error}
            </Text>
          )}
          <FormField label="Try a URL" group>
            <Row gap={8}>
              <TextInput mono value={testUrl} placeholder="https://api.swag.gg/v1/upi/pay" onChange={(x) => setTestUrl(x.target.value)} />
              {test != null && <StatusPill tone={test ? 'pass' : 'fail'}>{test ? 'Matches' : 'No match'}</StatusPill>}
            </Row>
          </FormField>
          {r.urlPattern && !compiled.error && (
            <Text variant="small" tone="muted">
              {matched.length ? `Matches ${matched.length === 50 ? '50 or more' : fmt(matched.length)} captured URL${matched.length === 1 ? '' : 's'}, e.g. ${matched[0]}` : 'Matches none of the captured calls.'}
            </Text>
          )}
        </Stack>

        <Stack as="section" gap={12}>
          <Text as="h3" variant="heading-sm">
            Answer
          </Text>
          <Segmented<MockAction>
            label="Action"
            value={r.action}
            onChange={(v) => set({ action: v })}
            options={[
              { value: 'respond', label: 'Respond' },
              { value: 'delay', label: 'Delay' },
              { value: 'fail', label: 'Fail' },
              { value: 'breakpoint', label: 'Breakpoint' },
            ]}
          />
          {r.action === 'breakpoint' && (
            <>
              <FormField label="Pause" group>
                <Segmented<BreakOn>
                  label="Pause"
                  value={r.breakOn}
                  onChange={(v) => set({ breakOn: v })}
                  options={[
                    { value: 'request', label: 'Before sending' },
                    { value: 'response', label: 'Before the app reads the response' },
                    { value: 'both', label: 'Both' },
                  ]}
                />
              </FormField>
              <Text variant="small" tone="muted">
                Matching calls wait until you continue or fail them from the bar at the top of the dashboard, where you can edit them first. After 2 minutes they continue unchanged. The app's calling thread waits meanwhile.
              </Text>
            </>
          )}
          {r.action === 'respond' && (
            <>
              <FormField label="API error templates" group>
                <Row gap={4} wrap>
                  {TEMPLATES.map((t) => (
                    <Button key={t.label} variant="quiet" title={t.hint} onClick={() => set(t.apply)}>
                      {t.label}
                    </Button>
                  ))}
                </Row>
              </FormField>
              <Row gap={12} align="end" wrap>
                <FormField label="Status">
                  <TextInput mono type="number" min={100} max={599} value={r.status} onChange={(x) => set({ status: Number(x.target.value) })} style={{ width: 96 }} />
                </FormField>
                <FormField label="Common" grow group>
                  <Row gap={4} wrap>
                    {QUICK.map((st) => (
                      <Button key={st} variant={r.status === st ? 'inverse' : 'quiet'} onClick={() => set({ status: st })}>
                        {st}
                      </Button>
                    ))}
                  </Row>
                </FormField>
                <FormField label="Delay" group>
                  <Row gap={6}>
                    <TextInput mono type="number" min={0} step={100} value={r.delayMs} onChange={(x) => set({ delayMs: Number(x.target.value) })} style={{ width: 110 }} />
                    <Text variant="small">ms</Text>
                  </Row>
                </FormField>
              </Row>
              <FormField label="Headers" group>
                <KeyValueEditor rows={r.headers} onChange={(headers) => set({ headers })} addLabel="Add header" namePlaceholder="header" />
              </FormField>
              <FormField
                group
                label={
                  <Row gap={8}>
                    Body
                    {looksJson && <StatusPill tone={jsonOk ? 'pass' : 'fail'}>{jsonOk ? 'Valid JSON' : 'Not valid JSON'}</StatusPill>}
                    {looksJson && (
                      <Button variant="quiet" disabled={!jsonOk || !r.body.trim()} onClick={() => set({ body: JSON.stringify(JSON.parse(r.body), null, 2) })}>
                        Format
                      </Button>
                    )}
                  </Row>
                }
              >
                <TextArea
                  mono
                  rows={12}
                  value={r.body}
                  onChange={(x) => set({ body: x.target.value })}
                  onKeyDown={(x) => {
                    if (x.key === 'Tab') {
                      x.preventDefault();
                      const el = x.currentTarget;
                      const at = el.selectionStart;
                      set({ body: el.value.slice(0, at) + '  ' + el.value.slice(el.selectionEnd) });
                      requestAnimationFrame(() => el.setSelectionRange(at + 2, at + 2));
                    }
                  }}
                />
              </FormField>
            </>
          )}
          {r.action === 'delay' && (
            <FormField label="Wait before the real call" group>
              <Row gap={6}>
                <TextInput mono type="number" min={0} step={100} value={r.delayMs} onChange={(x) => set({ delayMs: Number(x.target.value) })} style={{ width: 130 }} />
                <Text variant="small">ms</Text>
              </Row>
            </FormField>
          )}
          {r.action === 'fail' && (
            <>
              <Row gap={12} align="end" wrap>
                <FormField label="Failure" grow>
                  <SelectInput value={r.failure} onChange={(x) => set({ failure: x.target.value as MockFailure })}>
                    {FAILURES.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </SelectInput>
                </FormField>
                {r.failure === 'network_switch' ? (
                  <FormField label="Drop after" group>
                    <Row gap={6}>
                      <TextInput
                        mono
                        type="number"
                        min={0}
                        step={1024}
                        value={r.dropAfterBytes}
                        aria-label="Drop after (bytes)"
                        onChange={(x) => set({ dropAfterBytes: Math.max(0, Number(x.target.value) || 0) })}
                        style={{ width: 110 }}
                      />
                      <Text variant="small">bytes of body</Text>
                    </Row>
                  </FormField>
                ) : (
                  <FormField label="After" group>
                    <Row gap={6}>
                      <TextInput mono type="number" min={0} step={100} value={r.delayMs} onChange={(x) => set({ delayMs: Number(x.target.value) })} style={{ width: 110 }} />
                      <Text variant="small">ms</Text>
                    </Row>
                  </FormField>
                )}
              </Row>
              <Text variant="small" tone="muted">
                {FAILURES.find((f) => f.value === r.failure)?.hint}
              </Text>
            </>
          )}
        </Stack>

        <Stack as="section" gap={12}>
          <Text as="h3" variant="heading-sm">
            When
          </Text>
          <Row gap={12} align="end" wrap>
            <FormField label="Only the first" hint="0 means every call." group>
              <Row gap={6}>
                <TextInput
                  mono
                  type="number"
                  min={0}
                  value={r.times}
                  aria-label="Only the first (calls)"
                  onChange={(x) => set({ times: Math.max(0, Math.floor(Number(x.target.value) || 0)) })}
                  style={{ width: 80 }}
                />
                <Text variant="small">calls</Text>
              </Row>
            </FormField>
            <FormField label="Share of calls" hint="The rest go to later rules or the real network." group>
              <Row gap={6}>
                <TextInput
                  mono
                  type="number"
                  min={1}
                  max={100}
                  value={r.probability}
                  aria-label="Share of calls (%)"
                  onChange={(x) => set({ probability: Math.min(100, Math.max(1, Math.floor(Number(x.target.value) || 1))) })}
                  style={{ width: 80 }}
                />
                <Text variant="small">%</Text>
              </Row>
            </FormField>
          </Row>
          <FormField label="Common" group>
            <Row gap={4} wrap>
              <Button variant={r.times === 0 && r.probability === 100 ? 'inverse' : 'quiet'} onClick={() => set({ times: 0, probability: 100 })}>
                Every call
              </Button>
              <Button variant={r.times === 1 && r.probability === 100 ? 'inverse' : 'quiet'} title="Fail the first attempt; the retry reaches the server" onClick={() => set({ times: 1, probability: 100 })}>
                Once, then the real call
              </Button>
              <Button variant={r.times === 0 && r.probability === 30 ? 'inverse' : 'quiet'} title="A flaky backend" onClick={() => set({ times: 0, probability: 30 })}>
                30% of calls
              </Button>
            </Row>
          </FormField>
          <Text variant="small" tone="muted">
            {r.times > 0 ? `Applies to the next ${plural(r.times, 'matching call')}, then lets calls through. ` : 'Applies to every matching call. '}
            {r.probability < 100 ? `Only ${fmt(r.probability)}% of them.` : ''}
          </Text>
        </Stack>

        {err && (
          <Text variant="small" tone="fail">
            ✕ {err}
          </Text>
        )}
        <Row gap={8} wrap>
          {onDelete && (
            <Button variant="secondary" size="sm" onClick={onDelete}>
              Delete rule
            </Button>
          )}
          <Spacer />
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : id ? 'Save rule' : 'Create rule'}
          </Button>
        </Row>
      </Stack>
    </KDialog>
  );
}
