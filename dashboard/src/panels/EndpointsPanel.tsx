import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, EmptyState, FlushCard, Row, SearchInput, Segmented, Spacer, Stack, Table, Text, numCell } from '@/design';
import { api, errorMessage } from '../api/client';
import { liveStore, reloadEndpoints } from '../api/live';
import type { Endpoint, EndpointInput, EndpointSource, MatchType, MockAction, MockRuleInput } from '../api/types';
import { CopyAction, FormField, IconBtn, MethodTag, SelectInput, TextArea, TextInput } from '../kit/controls';
import { KDialog } from '../kit/overlays';
import { discover, endpointFromDiscovered, endpointMatcher, type Discovered } from '../lib/endpoints';
import { fmt, plural } from '../lib/format';
import { compilePattern } from '../lib/match';
import { appStore } from '../state/app';
import { navigate } from '../state/router';
import { useStore } from '../state/store';
import { confirmDialog, toast } from '../state/ui';
import { emptyRule } from './MocksPanel';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const CATALOGUE_PATH = 'app/src/debug/assets/killcam-endpoints.json';
const SOURCE: Record<EndpointSource, { label: string; hint: string }> = {
  repo: { label: 'Repo', hint: 'From killcam-endpoints.json in the app repo' },
  code: { label: 'Code', hint: 'Registered in app code with Killcam.registerEndpoint' },
  dashboard: { label: 'This phone', hint: 'Added or edited here and stored on this phone' },
};
const MATCH: { value: MatchType; label: string }[] = [
  { value: 'contains', label: 'Contains' },
  { value: 'exact', label: 'Exact' },
  { value: 'glob', label: 'Glob' },
  { value: 'regex', label: 'Regex' },
];

/** Opens the rule editor in Mocks, aimed at this endpoint. */
export function ruleForEndpoint(e: Endpoint, action: MockAction): void {
  const kind = action === 'breakpoint' ? 'breakpoint' : action === 'fail' ? 'DNS failure' : 'mock';
  const input: MockRuleInput = {
    ...emptyRule(),
    name: `${e.name ?? e.key}: ${kind}`,
    endpoint: e.key,
    method: e.method,
    urlPattern: e.urlPattern,
    matchType: e.matchType,
    action,
    failure: 'dns_failure',
  };
  appStore.set({ mockDraft: { input, testUrl: '' } });
  navigate('mocks');
}

const toInput = (e: Endpoint): EndpointInput => ({
  key: e.key,
  name: e.name,
  method: e.method,
  urlPattern: e.urlPattern === e.key ? null : e.urlPattern,
  matchType: e.matchType,
  group: e.group,
  description: e.description,
});

export function EndpointsPanel() {
  const endpoints = useStore(liveStore, (x) => x.endpoints);
  const network = useStore(liveStore, (x) => x.network);
  const embed = useStore(appStore, (x) => x.embed);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<{ input: EndpointInput; isNew: boolean } | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!endpoints) reloadEndpoints().catch(() => undefined);
  }, [endpoints]);

  const stats = useMemo(() => {
    const out = new Map<string, { calls: number; errors: number }>();
    for (const e of endpoints ?? []) {
      const m = endpointMatcher(e);
      let calls = 0;
      let errors = 0;
      for (const c of network) {
        if (!m(c.method, c.url)) continue;
        calls++;
        if (c.state === 'failed' || (c.status ?? 0) >= 400) errors++;
      }
      out.set(e.key, { calls, errors });
    }
    return out;
  }, [endpoints, network]);
  const discovered = useMemo(() => (endpoints ? discover(network, endpoints).slice(0, 30) : []), [endpoints, network]);
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const m = new Map<string, Endpoint[]>();
    for (const e of endpoints ?? []) {
      if (needle && ![e.key, e.name, e.group, e.description, e.method].some((v) => v?.toLowerCase().includes(needle))) continue;
      m.set(e.group, [...(m.get(e.group) ?? []), e]);
    }
    return [...m.entries()];
  }, [endpoints, q]);

  if (!endpoints) return <EmptyState>Loading endpoints…</EmptyState>;
  const unexported = endpoints.filter((e) => e.unexported).length;
  const add = () => setEditing({ input: { key: '', matchType: 'contains' }, isNew: true });
  const remove = async (e: Endpoint) => {
    if (!(await confirmDialog({ title: `Remove ${e.key} from this phone?`, message: 'Rules made for it keep working; they hold their own copy of the match.', confirmLabel: 'Remove', danger: true }))) return;
    try {
      await api.del('endpoints', { key: e.key });
      await reloadEndpoints();
    } catch (err) {
      toast(`Could not remove the endpoint: ${errorMessage(err)}`, 'error');
    }
  };
  const register = (d: Discovered) => setEditing({ input: { ...endpointFromDiscovered(d), name: null, group: null, description: null }, isNew: true });

  return (
    <Stack as="section" gap={20}>
      <Row gap={10} wrap>
        <Text variant="small" tone="muted">
          {plural(endpoints.length, 'endpoint')} in the catalogue{unexported ? `, ${fmt(unexported)} not in the repo yet` : ''}.
        </Text>
        <Spacer />
        {!embed && <SearchInput value={q} onChange={setQ} placeholder="Filter endpoints" label="Filter endpoints" />}
        <Button variant="secondary" size="sm" onClick={() => setExporting(true)}>
          Export for the repo{unexported ? ` (${fmt(unexported)} new)` : ''}
        </Button>
        <Button variant="primary" size="sm" onClick={add}>
          Add endpoint
        </Button>
      </Row>

      {endpoints.length === 0 && discovered.length === 0 && (
        <EmptyState title="No endpoints yet" actions={<Button variant="outline" onClick={add}>Add endpoint</Button>}>
          The catalogue names the app's APIs, such as /page/fetch or /data/sync, so mocks, failures and breakpoints can target them. Ship killcam-endpoints.json as a debug asset, call Killcam.registerEndpoint, or add them here.
        </EmptyState>
      )}

      {groups.map(([group, list]) => (
        <FlushCard key={group} title={group} hint={plural(list.length, 'endpoint')}>
          {embed ? (
            list.map((e) => <EndpointCard key={e.key} e={e} calls={stats.get(e.key)} onEdit={() => setEditing({ input: toInput(e), isNew: false })} onRemove={() => remove(e)} />)
          ) : (
            <Table minWidth={920} label={`${group} endpoints`}>
              <thead>
                {/* Fixed widths, so the columns line up from one group's table to the next. */}
                <tr>
                  <th style={{ width: 90 }}>Method</th>
                  <th>Endpoint</th>
                  <th style={{ width: 200 }}>Source</th>
                  <th className={numCell} style={{ width: 80 }}>
                    Calls
                  </th>
                  <th className={numCell} style={{ width: 80 }}>
                    Errors
                  </th>
                  <th aria-label="Actions" style={{ width: 360 }} />
                </tr>
              </thead>
              <tbody>
                {list.map((e) => {
                  const st = stats.get(e.key);
                  return (
                    <tr key={e.key} data-hl={`endpoint:${e.key}`}>
                      <td>{e.method ? <MethodTag method={e.method} /> : <Text variant="meta">Any</Text>}</td>
                      <td style={{ maxWidth: 380 }}>
                        <Stack gap={4}>
                          <Text variant="mono" tone="primary" weight={600} truncate title={`${e.matchType}: ${e.urlPattern}`}>
                            {e.key}
                          </Text>
                          {(e.name || e.description) && (
                            <Text variant="small" tone="muted" truncate>
                              {[e.name, e.description].filter(Boolean).join(' · ')}
                            </Text>
                          )}
                        </Stack>
                      </td>
                      <td>
                        <Row gap={6}>
                          <Badge title={SOURCE[e.source].hint}>{SOURCE[e.source].label}</Badge>
                          {e.unexported && (
                            <Badge tone="accent" title="Export the catalogue and commit it to share this endpoint">
                              Not in repo
                            </Badge>
                          )}
                        </Row>
                      </td>
                      <td className={numCell}>{fmt(st?.calls ?? 0)}</td>
                      <td className={numCell}>{fmt(st?.errors ?? 0)}</td>
                      <td>
                        <Row gap={6}>
                          <Button variant="mini" onClick={() => ruleForEndpoint(e, 'fail')} title="New rule that makes this endpoint fail">
                            Fail…
                          </Button>
                          <Button variant="mini" onClick={() => ruleForEndpoint(e, 'respond')} title="New rule that answers with a canned response or an API error">
                            Mock…
                          </Button>
                          <Button variant="mini" onClick={() => ruleForEndpoint(e, 'breakpoint')} title="New rule that pauses calls so you can inspect and edit them">
                            Breakpoint…
                          </Button>
                          <Button variant="mini" onClick={() => setEditing({ input: toInput(e), isNew: false })}>
                            Edit
                          </Button>
                          {e.source === 'dashboard' && <IconBtn icon="trash" label={`Remove ${e.key}`} onClick={() => void remove(e)} />}
                        </Row>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </FlushCard>
      ))}

      {discovered.length > 0 && (
        <FlushCard title="Seen in traffic, not in the catalogue" hint="Paths with ids collapsed to *. Register one to target it by name.">
          {embed ? (
            discovered.map((d) => (
              <Row key={`${d.method} ${d.host}${d.path}`} gap={8} style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
                <MethodTag method={d.method} />
                <Stack gap={2} grow>
                  <Text variant="mono" truncate>
                    {d.path}
                  </Text>
                  <Text variant="meta">
                    {d.host} · {plural(d.calls, 'call')}
                  </Text>
                </Stack>
                <Button variant="secondary" size="sm" onClick={() => register(d)}>
                  Register
                </Button>
              </Row>
            ))
          ) : (
            <Table minWidth={720} label="Uncatalogued paths">
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Path</th>
                  <th>Host</th>
                  <th className={numCell}>Calls</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {discovered.map((d) => (
                  <tr key={`${d.method} ${d.host}${d.path}`}>
                    <td>
                      <MethodTag method={d.method} />
                    </td>
                    <td>
                      <Text variant="mono" truncate title={d.sampleUrl}>
                        {d.path}
                      </Text>
                    </td>
                    <td>
                      <Text variant="small" tone="muted">
                        {d.host}
                      </Text>
                    </td>
                    <td className={numCell}>{fmt(d.calls)}</td>
                    <td>
                      <Button variant="mini" onClick={() => register(d)}>
                        Register…
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </FlushCard>
      )}

      {editing && <EndpointEditor initial={editing.input} isNew={editing.isNew} onClose={() => setEditing(null)} />}
      {exporting && <ExportDialog unexported={unexported} onClose={() => setExporting(false)} />}
    </Stack>
  );
}

function EndpointCard({ e, calls, onEdit, onRemove }: { e: Endpoint; calls?: { calls: number; errors: number }; onEdit: () => void; onRemove: () => void }) {
  return (
    <div data-hl={`endpoint:${e.key}`} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
      <Row gap={8}>
        {e.method ? <MethodTag method={e.method} /> : <Text variant="meta">Any</Text>}
        <Text variant="mono" tone="primary" weight={600} truncate>
          {e.key}
        </Text>
      </Row>
      <Text variant="meta">
        {[e.name, SOURCE[e.source].label, e.unexported ? 'not in repo' : null, plural(calls?.calls ?? 0, 'call'), plural(calls?.errors ?? 0, 'error')].filter(Boolean).join(' · ')}
      </Text>
      <Row gap={4} wrap>
        <Button variant="secondary" size="sm" onClick={() => ruleForEndpoint(e, 'fail')}>
          Fail
        </Button>
        <Button variant="secondary" size="sm" onClick={() => ruleForEndpoint(e, 'respond')}>
          Mock
        </Button>
        <Button variant="secondary" size="sm" onClick={() => ruleForEndpoint(e, 'breakpoint')}>
          Breakpoint
        </Button>
        <Spacer />
        <Button variant="quiet" size="sm" onClick={onEdit}>
          Edit
        </Button>
        {e.source === 'dashboard' && <IconBtn icon="trash" size="lg" label={`Remove ${e.key}`} onClick={onRemove} />}
      </Row>
    </div>
  );
}

function EndpointEditor({ initial, isNew, onClose }: { initial: EndpointInput; isNew: boolean; onClose: () => void }) {
  const [e, setE] = useState<EndpointInput>(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const network = useStore(liveStore, (x) => x.network);
  const set = (p: Partial<EndpointInput>) => setE((x) => ({ ...x, ...p }));
  const pattern = e.urlPattern?.trim() || e.key.trim();
  const compiled = useMemo(() => compilePattern(e.matchType ?? 'contains', pattern), [e.matchType, pattern]);
  const matches = useMemo(
    () => (pattern && !compiled.error ? network.filter((c) => (!e.method || c.method === e.method) && compiled.test(c.url)).length : 0),
    [network, compiled, pattern, e.method],
  );

  const save = async () => {
    setErr(null);
    if (!e.key.trim()) return setErr('A key is required, for example /page/fetch.');
    if (compiled.error) return setErr(`The regex is not valid: ${compiled.error}`);
    setSaving(true);
    try {
      await api.put('endpoints', { ...e, key: e.key.trim(), urlPattern: e.urlPattern?.trim() || null });
      await reloadEndpoints();
      toast(isNew ? 'Endpoint added. Export the catalogue to share it.' : 'Endpoint saved on this phone', 'ok');
      onClose();
    } catch (x) {
      setErr(errorMessage(x));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KDialog
      open
      onClose={onClose}
      title={isNew ? 'Add endpoint' : `Endpoint ${initial.key}`}
      subtitle="Stored on this phone and marked “Not in repo” until the catalogue is exported and committed."
      width={680}
    >
      <Stack gap={20}>
        <Row gap={12} align="end" wrap>
          <FormField label="Key" grow>
            <TextInput mono value={e.key} placeholder="/page/fetch" readOnly={!isNew} onChange={(x) => set({ key: x.target.value })} />
          </FormField>
          <FormField label="Method">
            <SelectInput value={e.method ?? ''} onChange={(x) => set({ method: x.target.value || null })} style={{ width: 120 }}>
              <option value="">Any</option>
              {METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </SelectInput>
          </FormField>
          <FormField label="Group">
            <TextInput value={e.group ?? ''} placeholder={e.key.split(/[/.?]/).find(Boolean) ?? 'page'} onChange={(x) => set({ group: x.target.value || null })} style={{ width: 140 }} />
          </FormField>
        </Row>
        <Row gap={12} align="end" wrap>
          <FormField label="Name" grow>
            <TextInput value={e.name ?? ''} placeholder="Fetch page" onChange={(x) => set({ name: x.target.value || null })} />
          </FormField>
          <FormField label="Description" grow>
            <TextInput value={e.description ?? ''} onChange={(x) => set({ description: x.target.value || null })} />
          </FormField>
        </Row>
        <FormField label="Match the URL by" group>
          <Segmented<MatchType> label="Match type" value={e.matchType ?? 'contains'} onChange={(v) => set({ matchType: v })} options={MATCH} />
        </FormField>
        <FormField label="URL pattern" hint={compiled.error ? undefined : `Defaults to the key. Matches ${plural(matches, 'captured call')} this session.`}>
          <TextInput mono value={e.urlPattern ?? ''} invalid={!!compiled.error} placeholder={e.key || '/page/fetch'} onChange={(x) => set({ urlPattern: x.target.value })} />
        </FormField>
        {compiled.error && (
          <Text variant="small" tone="fail">
            ✕ {compiled.error}
          </Text>
        )}
        {err && (
          <Text variant="small" tone="fail">
            ✕ {err}
          </Text>
        )}
        <Row gap={8}>
          <Spacer />
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : isNew ? 'Add endpoint' : 'Save endpoint'}
          </Button>
        </Row>
      </Stack>
    </KDialog>
  );
}

/** Same as Network's HAR export: the server's Content-Disposition names the file. */
function download() {
  const a = document.createElement('a');
  a.href = 'api/endpoints/export?download=1';
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function ExportDialog({ unexported, onClose }: { unexported: number; onClose: () => void }) {
  const [json, setJson] = useState<string | null>(null);
  useEffect(() => {
    api.text('endpoints/export').then(setJson, (e) => setJson(`// ${errorMessage(e)}`));
  }, []);
  return (
    <KDialog
      open
      onClose={onClose}
      title="Export the endpoint catalogue"
      subtitle={unexported ? `${plural(unexported, 'endpoint')} not in the repo yet.` : 'The repo catalogue is up to date.'}
      width={760}
    >
      <Stack gap={16}>
        <Text as="p" variant="body">
          Commit this file to the app repo at <code>{CATALOGUE_PATH}</code> (any debug asset path works) and open a pull request. The next debug build
          ships it to everyone. With the phone on USB, <code>scripts/pull-endpoints.sh {CATALOGUE_PATH}</code> writes it in place.
        </Text>
        <TextArea mono rows={16} readOnly value={json ?? 'Loading…'} />
        <Row gap={8}>
          <Spacer />
          {json && <CopyAction text={json} label="Copy the catalogue" />}
          <Button variant="primary" size="sm" onClick={download}>
            Download killcam-endpoints.json
          </Button>
        </Row>
      </Stack>
    </KDialog>
  );
}
