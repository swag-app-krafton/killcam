import { useEffect, useMemo, useState } from 'react';
import { api, enc, errorMessage } from '../api/client';
import { liveStore, reloadMocks } from '../api/live';
import type { Header, MatchType, MockAction, MockFailure, MockRule, MockRuleInput } from '../api/types';
import { tryParseJson } from '../components/JsonTree';
import { Icon } from '../components/Icon';
import { MethodTag } from '../components/StatusPill';
import { EmptyState, IconButton, Loading, Modal, Segmented, Switch } from '../components/ui';
import { fmtBytes } from '../lib/format';
import { compilePattern } from '../lib/match';
import { appStore } from '../state/app';
import { useStore } from '../state/store';
import { confirmDialog, toast } from '../state/ui';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const MATCH_TYPES: { value: MatchType; label: string; title: string }[] = [
  { value: 'contains', label: 'Contains', title: 'The URL contains the pattern' },
  { value: 'exact', label: 'Exact', title: 'The whole URL (with query) equals the pattern' },
  { value: 'glob', label: 'Glob', title: 'Whole-URL wildcard: * any characters, ? one character' },
  { value: 'regex', label: 'Regex', title: 'A regular expression found anywhere in the URL' },
];
const FAILURES: { value: MockFailure; label: string }[] = [
  { value: 'timeout', label: 'Timeout (SocketTimeoutException)' },
  { value: 'no_network', label: 'No network (UnknownHostException)' },
  { value: 'connection_reset', label: 'Connection reset (SocketException)' },
];
const QUICK_STATUS = [200, 201, 204, 400, 401, 402, 403, 404, 429, 500, 503];

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
  };
}

function toInput(r: MockRule): MockRuleInput {
  const { id: _id, hits: _hits, createdMs: _c, ...input } = r;
  return input;
}

function actionSummary(r: MockRule): string {
  if (r.action === 'respond') return `→ ${r.status}${r.body ? ` · ${fmtBytes(new Blob([r.body]).size)}` : ''}${r.delayMs ? ` after ${r.delayMs} ms` : ''}`;
  if (r.action === 'delay') return `delay ${r.delayMs} ms, then real call`;
  return `fail: ${r.failure.replace('_', ' ')}${r.delayMs ? ` after ${r.delayMs} ms` : ''}`;
}

export function MocksPanel() {
  const mocks = useStore(liveStore, (s) => s.mocks);
  const draft = useStore(appStore, (s) => s.mockDraft);
  const [editing, setEditing] = useState<{ id: string | null; input: MockRuleInput; testUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // "Mock this" from Network hands us a prefilled draft.
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
      toast(`Update failed: ${errorMessage(e)}`, 'error');
    }
  };

  const move = async (index: number, delta: number) => {
    if (!mocks) return;
    const ids = mocks.map((m) => m.id);
    const j = index + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    setBusy(true);
    // Optimistic: show the new order right away; the server answer (or SSE) wins.
    liveStore.set({ mocks: ids.map((id) => mocks.find((m) => m.id === id)!) });
    try {
      liveStore.set({ mocks: await api.put<MockRule[]>('mocks', ids) });
    } catch (e) {
      toast(`Reorder failed: ${errorMessage(e)}`, 'error');
      await reloadMocks().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: MockRule) => {
    if (!(await confirmDialog({ title: `Delete “${r.name}”?`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api.del(`mocks/${enc(r.id)}`);
      await reloadMocks();
      toast('Rule deleted', 'ok');
    } catch (e) {
      toast(`Delete failed: ${errorMessage(e)}`, 'error');
    }
  };

  const enabledCount = mocks?.filter((m) => m.enabled).length ?? 0;

  return (
    <div className="panel">
      <div className="list-pane">
        <div className="toolbar">
          <div className="toolbar-title">
            <Icon name="mocks" />
            <span>Mock rules</span>
            {mocks && <span className="muted">{enabledCount} of {mocks.length} enabled · first enabled match wins</span>}
          </div>
          <span className="grow" />
          <button type="button" className="btn primary" onClick={() => setEditing({ id: null, input: emptyRule(), testUrl: '' })}>
            <Icon name="plus" size={14} />
            <span>New rule</span>
          </button>
        </div>
        <div className="scroll pad">
          {!mocks ? (
            <Loading />
          ) : mocks.length === 0 ? (
            <EmptyState icon="mocks" title="No mock rules">
              Rewrite responses, add latency or simulate failures without touching the backend. Create one here, or open a call in Network
              and hit <b>Mock this</b>.
            </EmptyState>
          ) : (
            <ol className="rules">
              {mocks.map((r, i) => (
                <li key={r.id} className={r.enabled ? 'rule' : 'rule disabled'}>
                  <div className="rule-order">
                    <IconButton icon="chevron-up" label={`Move “${r.name}” up`} size={14} disabled={busy || i === 0} onClick={() => move(i, -1)} />
                    <span className="tnum">{i + 1}</span>
                    <IconButton icon="chevron-down" label={`Move “${r.name}” down`} size={14} disabled={busy || i === mocks.length - 1} onClick={() => move(i, 1)} />
                  </div>
                  <Switch checked={r.enabled} label={r.enabled ? 'Disable rule' : 'Enable rule'} onChange={(v) => update(r, { enabled: v })} />
                  <button type="button" className="rule-main" onClick={() => setEditing({ id: r.id, input: toInput(r), testUrl: '' })}>
                    <span className="rule-name">{r.name}</span>
                    <span className="rule-match mono">
                      {r.method ? <MethodTag method={r.method} /> : <span className="method method-any">ANY</span>}
                      <span className="badge">{r.matchType}</span>
                      <span className="rule-pattern" title={r.urlPattern}>
                        {r.urlPattern}
                      </span>
                    </span>
                  </button>
                  <span className={`rule-action action-${r.action}`}>{actionSummary(r)}</span>
                  <span className="rule-hits tnum" title="Times this rule matched">
                    {r.hits} {r.hits === 1 ? 'hit' : 'hits'}
                  </span>
                  <div className="rule-btns">
                    <IconButton icon="edit" label="Edit rule" onClick={() => setEditing({ id: r.id, input: toInput(r), testUrl: '' })} />
                    <IconButton icon="trash" label="Delete rule" onClick={() => remove(r)} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
      {editing && (
        <MockEditor
          id={editing.id}
          initial={editing.input}
          initialTestUrl={editing.testUrl}
          onClose={() => setEditing(null)}
          onDelete={editing.id ? () => mocks && remove(mocks.find((m) => m.id === editing.id)!).then(() => setEditing(null)) : undefined}
        />
      )}
    </div>
  );
}

function MockEditor({
  id,
  initial,
  initialTestUrl,
  onClose,
  onDelete,
}: {
  id: string | null;
  initial: MockRuleInput;
  initialTestUrl: string;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const [r, setR] = useState<MockRuleInput>(initial);
  const [testUrl, setTestUrl] = useState(initialTestUrl || (initial.matchType === 'exact' ? initial.urlPattern : ''));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const network = useStore(liveStore, (s) => s.network);
  const set = (p: Partial<MockRuleInput>) => setR((x) => ({ ...x, ...p }));

  const compiled = useMemo(() => compilePattern(r.matchType, r.urlPattern), [r.matchType, r.urlPattern]);
  const testResult = testUrl && r.urlPattern && !compiled.error ? compiled.test(testUrl) : null;
  const matched = useMemo(() => {
    if (!r.urlPattern || compiled.error) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (let i = network.length - 1; i >= 0 && out.length < 50; i--) {
      const c = network[i];
      if ((r.method == null || c.method === r.method) && compiled.test(c.url) && !seen.has(c.url)) {
        seen.add(c.url);
        out.push(`${c.method} ${c.url}`);
      }
    }
    return out;
  }, [network, compiled, r.method, r.urlPattern]);

  const contentType = r.headers.find((h) => h.name.toLowerCase() === 'content-type')?.value ?? '';
  const looksJson = contentType.includes('json') || /^\s*[[{]/.test(r.body);
  const jsonValid = r.body.trim() === '' || tryParseJson(r.body, 'application/json') !== undefined;

  const save = async () => {
    setErr(null);
    if (!r.urlPattern.trim()) return setErr('A URL pattern is required.');
    if (compiled.error) return setErr(`Invalid regex: ${compiled.error}`);
    setSaving(true);
    try {
      const body: MockRuleInput = {
        ...r,
        name: r.name.trim() || `${r.method ?? 'ANY'} ${r.urlPattern}`,
        headers: r.headers.filter((h) => h.name.trim()),
        status: Number(r.status) || 200,
        delayMs: Math.max(0, Number(r.delayMs) || 0),
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

  const setHeader = (i: number, p: Partial<Header>) => set({ headers: r.headers.map((h, j) => (j === i ? { ...h, ...p } : h)) });

  return (
    <Modal
      title={id ? 'Edit mock rule' : 'New mock rule'}
      onClose={onClose}
      width={720}
      className="mock-editor"
      footer={
        <>
          {onDelete && (
            <button type="button" className="btn danger" onClick={onDelete}>
              <Icon name="trash" size={14} />
              <span>Delete</span>
            </button>
          )}
          <span className="grow" />
          {err && <span className="text-error form-error">{err}</span>}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : id ? 'Save' : 'Create rule'}
          </button>
        </>
      }
    >
      <div className="form">
        <div className="form-row">
          <label className="field grow">
            <span>Name</span>
            <input className="input" value={r.name} placeholder="e.g. Pay: insufficient funds" onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="field field-inline">
            <span>Enabled</span>
            <Switch checked={r.enabled} onChange={(v) => set({ enabled: v })} label="Enabled" />
          </label>
        </div>

        <fieldset className="fieldset">
          <legend>Match</legend>
          <div className="form-row">
            <label className="field">
              <span>Method</span>
              <select className="select" value={r.method ?? ''} onChange={(e) => set({ method: e.target.value || null })}>
                <option value="">Any</option>
                {METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <div className="field">
              <span>Match type</span>
              <Segmented<MatchType> label="Match type" value={r.matchType} onChange={(v) => set({ matchType: v })} options={MATCH_TYPES} />
            </div>
          </div>
          <label className="field">
            <span>URL pattern</span>
            <input
              className={compiled.error ? 'input mono invalid' : 'input mono'}
              value={r.urlPattern}
              placeholder={r.matchType === 'glob' ? 'https://api.swag.gg/v1/upi/*' : r.matchType === 'regex' ? '/v1/contacts\\?page=\\d+' : '/v1/upi/pay'}
              onChange={(e) => set({ urlPattern: e.target.value })}
              spellCheck={false}
            />
            {compiled.error && <small className="text-error">{compiled.error}</small>}
          </label>
          <label className="field">
            <span>Test a URL</span>
            <div className="test-url">
              <input
                className="input mono"
                value={testUrl}
                placeholder="https://api.swag.gg/v1/upi/pay"
                onChange={(e) => setTestUrl(e.target.value)}
                spellCheck={false}
              />
              {testResult != null && (
                <span className={testResult ? 'test-ok' : 'test-no'}>
                  <Icon name={testResult ? 'check' : 'x'} size={14} /> {testResult ? 'matches' : 'no match'}
                </span>
              )}
            </div>
          </label>
          {r.urlPattern && !compiled.error && (
            <div className="matched">
              {matched.length ? (
                <>
                  <span className="muted">Matches {matched.length === 50 ? '50+' : matched.length} captured URL{matched.length === 1 ? '' : 's'}:</span>
                  <ul className="mono">
                    {matched.slice(0, 4).map((u) => (
                      <li key={u} title={u}>
                        {u}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <span className="muted">Matches none of the captured calls.</span>
              )}
            </div>
          )}
        </fieldset>

        <fieldset className="fieldset">
          <legend>Action</legend>
          <Segmented<MockAction>
            label="Action"
            value={r.action}
            onChange={(v) => set({ action: v })}
            options={[
              { value: 'respond', label: 'Respond', title: 'Return this response instead of calling the server' },
              { value: 'delay', label: 'Delay', title: 'Wait, then make the real call' },
              { value: 'fail', label: 'Fail', title: 'Throw a network error' },
            ]}
          />
          {r.action === 'respond' && (
            <>
              <div className="form-row">
                <label className="field">
                  <span>Status</span>
                  <input className="input mono status-input" type="number" min={100} max={599} value={r.status} onChange={(e) => set({ status: Number(e.target.value) })} />
                </label>
                <div className="field grow">
                  <span>Quick pick</span>
                  <div className="chips wrap">
                    {QUICK_STATUS.map((s) => (
                      <button key={s} type="button" className={r.status === s ? 'chip on' : 'chip'} onClick={() => set({ status: s })}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="field">
                  <span>Delay (ms)</span>
                  <input className="input mono" type="number" min={0} step={100} value={r.delayMs} onChange={(e) => set({ delayMs: Number(e.target.value) })} />
                </label>
              </div>
              <div className="field">
                <span>Headers</span>
                <div className="headers-edit">
                  {r.headers.map((h, i) => (
                    <div className="header-row" key={i}>
                      <input className="input mono" placeholder="name" value={h.name} onChange={(e) => setHeader(i, { name: e.target.value })} aria-label="Header name" />
                      <input className="input mono" placeholder="value" value={h.value} onChange={(e) => setHeader(i, { value: e.target.value })} aria-label="Header value" />
                      <IconButton icon="x" label="Remove header" onClick={() => set({ headers: r.headers.filter((_, j) => j !== i) })} />
                    </div>
                  ))}
                  <button type="button" className="link-btn" onClick={() => set({ headers: [...r.headers, { name: '', value: '' }] })}>
                    + Add header
                  </button>
                </div>
              </div>
              <div className="field">
                <span className="field-head">
                  Body
                  {looksJson && (
                    <span className={jsonValid ? 'test-ok' : 'test-no'}>
                      <Icon name={jsonValid ? 'check' : 'warning'} size={13} /> {jsonValid ? 'valid JSON' : 'invalid JSON'}
                    </span>
                  )}
                  <span className="grow" />
                  {looksJson && (
                    <button
                      type="button"
                      className="link-btn"
                      disabled={!jsonValid || !r.body.trim()}
                      onClick={() => set({ body: JSON.stringify(JSON.parse(r.body), null, 2) })}
                    >
                      Format
                    </button>
                  )}
                </span>
                <textarea
                  className="input mono body-edit"
                  value={r.body}
                  spellCheck={false}
                  rows={12}
                  onChange={(e) => set({ body: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Tab') {
                      e.preventDefault();
                      const el = e.currentTarget;
                      const s = el.selectionStart;
                      const v = el.value.slice(0, s) + '  ' + el.value.slice(el.selectionEnd);
                      set({ body: v });
                      requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
                    }
                  }}
                />
              </div>
            </>
          )}
          {r.action === 'delay' && (
            <label className="field">
              <span>Delay before the real call (ms)</span>
              <input className="input mono" type="number" min={0} step={100} value={r.delayMs} onChange={(e) => set({ delayMs: Number(e.target.value) })} />
            </label>
          )}
          {r.action === 'fail' && (
            <div className="form-row">
              <label className="field grow">
                <span>Failure</span>
                <select className="select" value={r.failure} onChange={(e) => set({ failure: e.target.value as MockFailure })}>
                  {FAILURES.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>After (ms)</span>
                <input className="input mono" type="number" min={0} step={100} value={r.delayMs} onChange={(e) => set({ delayMs: Number(e.target.value) })} />
              </label>
            </div>
          )}
        </fieldset>
      </div>
    </Modal>
  );
}
