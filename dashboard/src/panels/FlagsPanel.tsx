import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { liveStore, reloadFlags } from '../api/live';
import type { Flag } from '../api/types';
import { Icon } from '../components/Icon';
import { tryParseJson } from '../components/JsonTree';
import { Chip, EmptyState, IconButton, Loading, Modal, SearchInput, Switch } from '../components/ui';
import { navigate, useRoute } from '../state/router';
import { useStore } from '../state/store';
import { confirmDialog, toast } from '../state/ui';

async function setFlag(key: string, value: string): Promise<boolean> {
  try {
    const updated = await api.put<Flag>('flags', { key, value });
    // Apply locally right away; the SSE `flags` event will confirm.
    const flags = liveStore.get().flags;
    if (flags && updated?.key) liveStore.set({ flags: flags.map((f) => (f.key === updated.key ? updated : f)) });
    return true;
  } catch (e) {
    toast(`Could not set ${key}: ${errorMessage(e)}`, 'error');
    return false;
  }
}

async function resetFlag(key: string | null): Promise<void> {
  try {
    await api.del('flags', key ? { key } : undefined);
    await reloadFlags();
    toast(key ? `${key} reset` : 'All overrides cleared', 'ok');
  } catch (e) {
    toast(`Reset failed: ${errorMessage(e)}`, 'error');
  }
}

export function FlagsPanel() {
  const flags = useStore(liveStore, (s) => s.flags);
  // #/flags/<key> (from Remote Config's "Override") filters to that key and highlights it.
  const focusKey = useRoute().parts[0] ?? null;
  const [q, setQ] = useState(focusKey ?? '');
  useEffect(() => {
    if (focusKey) setQ(focusKey);
  }, [focusKey]);
  const [overridesOnly, setOverridesOnly] = useState(false);
  const [jsonEdit, setJsonEdit] = useState<Flag | null>(null);

  useEffect(() => {
    if (!flags) reloadFlags().catch(() => undefined);
  }, [flags]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (flags ?? []).filter(
      (f) =>
        (!overridesOnly || f.override != null) &&
        (!needle ||
          f.key.toLowerCase().includes(needle) ||
          (f.description ?? '').toLowerCase().includes(needle) ||
          f.value.toLowerCase().includes(needle)),
    );
    const map = new Map<string, Flag[]>();
    for (const f of list) {
      const g = f.group ?? 'Other';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(f);
    }
    return [...map.entries()].sort(([a], [b]) => (a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b)));
  }, [flags, q, overridesOnly]);

  const overrideCount = flags?.filter((f) => f.override != null).length ?? 0;

  return (
    <div className="panel">
      <div className="list-pane">
        <div className="toolbar">
          <SearchInput
            value={q}
            onChange={(v) => {
              setQ(v);
              if (focusKey && v !== focusKey) navigate('flags', { replace: true });
            }}
            placeholder="Search flags"
          />
          <Chip on={overridesOnly} onClick={() => setOverridesOnly(!overridesOnly)}>
            Overrides {overrideCount}
          </Chip>
          <span className="grow" />
          <span className="count">{flags?.length ?? 0} flags</span>
          <button
            type="button"
            className="btn"
            disabled={!overrideCount}
            onClick={async () => {
              if (await confirmDialog({ title: 'Reset all overrides?', message: `Clears ${overrideCount} local override${overrideCount === 1 ? '' : 's'}; flags fall back to remote or default values.`, confirmLabel: 'Reset all', danger: true }))
                void resetFlag(null);
            }}
          >
            <Icon name="refresh" size={14} />
            <span>Reset all overrides</span>
          </button>
        </div>
        <div className="scroll">
          {!flags ? (
            <Loading />
          ) : flags.length === 0 ? (
            <EmptyState icon="flag" title="No feature flags registered">
              The app has not registered a flag provider with Killcam.
            </EmptyState>
          ) : groups.length === 0 ? (
            <EmptyState icon="search" title="No flags match" />
          ) : (
            <div className="table-scroll">
              <table className="grid flags">
                <thead>
                  <tr>
                    <th>Flag</th>
                    <th>Type</th>
                    <th>Default</th>
                    <th>Remote</th>
                    <th className="col-value">Value</th>
                    <th>Source</th>
                    <th aria-label="Reset" />
                  </tr>
                </thead>
                {groups.map(([group, list]) => (
                  <tbody key={group}>
                    <tr className="group-row">
                      <th colSpan={7}>
                        {group} <span className="muted">{list.length}</span>
                      </th>
                    </tr>
                    {list.map((f) => (
                      <FlagRow key={f.key} flag={f} focused={f.key === focusKey} onEditJson={() => setJsonEdit(f)} />
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          )}
        </div>
      </div>
      {jsonEdit && <JsonFlagEditor flag={jsonEdit} onClose={() => setJsonEdit(null)} />}
    </div>
  );
}

function FlagRow({ flag: f, focused, onEditJson }: { flag: Flag; focused: boolean; onEditJson: () => void }) {
  const ref = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'center' });
  }, [focused]);
  return (
    <tr ref={ref} className={[f.override != null ? 'overridden' : '', focused ? 'focused' : ''].join(' ')}>
      <td className="flag-key">
        <span className="mono">{f.key}</span>
        {f.description && <small>{f.description}</small>}
      </td>
      <td>
        <span className="badge">{f.type}</span>
      </td>
      <td className="mono clip" title={f.defaultValue}>
        {f.defaultValue}
      </td>
      <td className="mono clip" title={f.remoteValue ?? undefined}>
        {f.remoteValue ?? <span className="muted">—</span>}
      </td>
      <td className="col-value">
        <FlagEditor flag={f} onEditJson={onEditJson} />
      </td>
      <td>
        <span className={`badge src-${f.source}`}>{f.source}</span>
      </td>
      <td>
        {f.override != null && <IconButton icon="refresh" label={`Reset ${f.key} override`} onClick={() => resetFlag(f.key)} />}
      </td>
    </tr>
  );
}

function FlagEditor({ flag: f, onEditJson }: { flag: Flag; onEditJson: () => void }) {
  const [draft, setDraft] = useState(f.value);
  useEffect(() => setDraft(f.value), [f.value]);
  if (f.type === 'boolean') {
    return (
      <span className="flag-bool">
        <Switch checked={f.value === 'true'} onChange={(v) => setFlag(f.key, String(v))} label={`${f.key}: ${f.value}`} />
        <span className="mono muted">{f.value}</span>
      </span>
    );
  }
  if (f.options && f.options.length) {
    return (
      <select className="select mono" value={f.value} onChange={(e) => setFlag(f.key, e.target.value)} aria-label={f.key}>
        {!f.options.includes(f.value) && <option value={f.value}>{f.value}</option>}
        {f.options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    );
  }
  if (f.type === 'json') {
    return (
      <button type="button" className="json-value mono" onClick={onEditJson} title="Edit JSON">
        <span className="clip">{f.value}</span>
        <Icon name="edit" size={13} />
      </button>
    );
  }
  const numeric = f.type === 'int' || f.type === 'double';
  const valid = !numeric || (f.type === 'int' ? /^-?\d+$/.test(draft.trim()) : draft.trim() !== '' && !Number.isNaN(Number(draft)));
  const commit = async () => {
    if (draft === f.value) return;
    if (!valid) {
      toast(`${f.key} expects ${f.type === 'int' ? 'an integer' : 'a number'}`, 'error');
      setDraft(f.value);
      return;
    }
    if (!(await setFlag(f.key, numeric ? draft.trim() : draft))) setDraft(f.value);
  };
  return (
    <input
      className={valid ? 'input mono flag-input' : 'input mono flag-input invalid'}
      value={draft}
      inputMode={numeric ? (f.type === 'int' ? 'numeric' : 'decimal') : undefined}
      aria-label={f.key}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(f.value);
      }}
      spellCheck={false}
    />
  );
}

function JsonFlagEditor({ flag, onClose }: { flag: Flag; onClose: () => void }) {
  const [text, setText] = useState(() => {
    const v = tryParseJson(flag.value, 'application/json');
    return v === undefined ? flag.value : JSON.stringify(v, null, 2);
  });
  const valid = tryParseJson(text, 'application/json') !== undefined;
  const save = async () => {
    const v = tryParseJson(text, 'application/json');
    if (v === undefined) return;
    if (await setFlag(flag.key, JSON.stringify(v))) onClose();
  };
  return (
    <Modal
      title={
        <span>
          Edit <span className="mono">{flag.key}</span>
        </span>
      }
      onClose={onClose}
      width={640}
      footer={
        <>
          <span className={valid ? 'test-ok' : 'test-no'}>
            <Icon name={valid ? 'check' : 'warning'} size={13} /> {valid ? 'valid JSON' : 'invalid JSON'}
          </span>
          <span className="grow" />
          <button type="button" className="btn" disabled={!valid} onClick={() => setText(JSON.stringify(JSON.parse(text), null, 2))}>
            Format
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={!valid} onClick={save}>
            Set override
          </button>
        </>
      }
    >
      {flag.description && <p className="dialog-msg">{flag.description}</p>}
      <textarea className="input mono body-edit" rows={14} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <p className="muted small">
        Default: <span className="mono">{flag.defaultValue}</span>
        {flag.remoteValue && (
          <>
            <br />
            Remote: <span className="mono">{flag.remoteValue}</span>
          </>
        )}
      </p>
    </Modal>
  );
}
