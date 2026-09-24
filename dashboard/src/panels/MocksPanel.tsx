import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, EmptyState, FlushCard, Row, Segmented, Spacer, Stack, StatusPill, Switch, Table, TableEmptyRow, Text, numCell } from '@/design';
import { api, enc, errorMessage } from '../api/client';
import { liveStore, reloadMocks } from '../api/live';
import type { MatchType, MockAction, MockFailure, MockRule, MockRuleInput } from '../api/types';
import { tryParseJson } from '../kit/console';
import { FormField, IconBtn, MethodTag, SelectInput, TextArea, TextInput } from '../kit/controls';
import { KeyValueEditor } from '../kit/editors';
import { KDialog } from '../kit/overlays';
import { fmt, fmtBytes, plural } from '../lib/format';
import { compilePattern } from '../lib/match';
import { appStore } from '../state/app';
import { useStore } from '../state/store';
import { confirmDialog, toast } from '../state/ui';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const MATCH: { value: MatchType; label: string; hint: string }[] = [
  { value: 'contains', label: 'Contains', hint: 'The URL contains the pattern.' },
  { value: 'exact', label: 'Exact', hint: 'The whole URL, query included, equals the pattern.' },
  { value: 'glob', label: 'Glob', hint: 'The whole URL matches, where * is any run of characters and ? is one character.' },
  { value: 'regex', label: 'Regex', hint: 'A regular expression found anywhere in the URL. Anchor it with ^…$ for a full match.' },
];
const FAILURES: { value: MockFailure; label: string }[] = [
  { value: 'timeout', label: 'Time out (SocketTimeoutException)' },
  { value: 'no_network', label: 'No network (UnknownHostException)' },
  { value: 'connection_reset', label: 'Connection reset (SocketException)' },
];
const QUICK = [200, 201, 204, 400, 401, 402, 403, 404, 429, 500, 503];

function emptyRule(): MockRuleInput {
  return { name: '', enabled: true, method: null, urlPattern: '', matchType: 'contains', action: 'respond', status: 200, headers: [{ name: 'content-type', value: 'application/json' }], body: '{\n  \n}', delayMs: 0, failure: 'timeout' };
}
const toInput = ({ id: _i, hits: _h, createdMs: _c, ...input }: MockRule): MockRuleInput => input;

function answer(r: MockRule): string {
  if (r.action === 'respond') return `Responds ${r.status}${r.body ? ` · ${fmtBytes(new Blob([r.body]).size)}` : ''}${r.delayMs ? ` after ${fmt(r.delayMs)} ms` : ''}`;
  if (r.action === 'delay') return `Waits ${fmt(r.delayMs)} ms, then makes the real call`;
  return `Fails: ${FAILURES.find((f) => f.value === r.failure)?.label.split(' (')[0].toLowerCase() ?? r.failure}${r.delayMs ? ` after ${fmt(r.delayMs)} ms` : ''}`;
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
          A rule answers matching calls with a canned response, adds latency, or fails them, without touching the backend. Start one here, or open a call in Network and choose Mock this.
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
                    {r.urlPattern}
                  </Text>
                </Row>
                <Text variant="meta">
                  {answer(r)} · {plural(r.hits, 'hit')}
                </Text>
                <Row gap={4}>
                  <Switch checked={r.enabled} label={r.enabled ? 'On' : 'Off'} onChange={(on) => update(r, { enabled: on })} />
                  <Spacer />
                  <Button variant="secondary" size="sm" onClick={() => edit(r)}>
                    Edit
                  </Button>
                </Row>
              </Stack>
            </div>
          ))}
        </FlushCard>
      ) : (
        <FlushCard title="Rules" hint="In the order they are tried. Hits count the calls a rule answered.">
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
                        <Badge>{r.matchType}</Badge>
                        <Text variant="mono" truncate title={r.urlPattern}>
                          {r.urlPattern}
                        </Text>
                      </Row>
                    </Stack>
                  </td>
                  <td>
                    <Text variant="small">{answer(r)}</Text>
                  </td>
                  <td className={numCell}>{fmt(r.hits)}</td>
                  <td>
                    <Row gap={6}>
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
  const set = (p: Partial<MockRuleInput>) => setR((x) => ({ ...x, ...p }));
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
    if (!r.urlPattern.trim()) return setErr('A URL pattern is required.');
    if (compiled.error) return setErr(`The regex is not valid: ${compiled.error}`);
    setSaving(true);
    try {
      const body: MockRuleInput = { ...r, name: r.name.trim() || `${r.method ?? 'Any'} ${r.urlPattern}`, headers: r.headers.filter((h) => h.name.trim()), status: Number(r.status) || 200, delayMs: Math.max(0, Number(r.delayMs) || 0) };
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
          <Row gap={12} align="end" wrap>
            <FormField label="Method">
              <SelectInput value={r.method ?? ''} onChange={(x) => set({ method: x.target.value || null })} style={{ width: 140 }}>
                <option value="">Any</option>
                {METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </SelectInput>
            </FormField>
            <FormField label="Match the URL by" group>
              <Segmented<MatchType> label="Match type" value={r.matchType} onChange={(v) => set({ matchType: v })} options={MATCH.map(({ value, label }) => ({ value, label }))} />
            </FormField>
          </Row>
          <FormField label="URL pattern" hint={compiled.error ? undefined : MATCH.find((m) => m.value === r.matchType)?.hint}>
            <TextInput
              mono
              value={r.urlPattern}
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
            ]}
          />
          {r.action === 'respond' && (
            <>
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
              <FormField label="After" group>
                <Row gap={6}>
                  <TextInput mono type="number" min={0} step={100} value={r.delayMs} onChange={(x) => set({ delayMs: Number(x.target.value) })} style={{ width: 110 }} />
                  <Text variant="small">ms</Text>
                </Row>
              </FormField>
            </Row>
          )}
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
