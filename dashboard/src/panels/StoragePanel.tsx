import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, apiUrl, enc, errorMessage, isUnavailable } from '../api/client';
import type {
  Cell,
  DbInfo,
  FileEntry,
  FileRoot,
  MmkvEntry,
  MmkvInstance,
  MmkvValueType,
  PrefEntry,
  PrefFile,
  PrefType,
  QueryResult,
} from '../api/types';
import { Icon } from '../components/Icon';
import { JsonTree, tryParseJson } from '../components/JsonTree';
import { SplitView } from '../components/SplitView';
import { CopyButton, EmptyState, IconButton, Loading, Modal, SearchInput, Segmented, Switch, Tabs } from '../components/ui';
import { fmtBytes, fmtDateTime, looksLikeEpochMs } from '../lib/format';
import { useAsync } from '../lib/hooks';
import { appStore } from '../state/app';
import { navigate, routePath, useRoute } from '../state/router';
import { useStore } from '../state/store';
import { confirmDialog, toast } from '../state/ui';

type Sub = 'prefs' | 'mmkv' | 'db' | 'files';

export function StoragePanel() {
  const route = useRoute();
  const p0 = route.parts[0];
  const sub: Sub = p0 === 'db' || p0 === 'files' || p0 === 'mmkv' ? p0 : 'prefs';
  return (
    <div className="panel storage">
      <Tabs<Sub>
        value={sub}
        onChange={(s) => navigate(routePath('storage', s))}
        tabs={[
          { id: 'prefs', label: 'Shared prefs' },
          { id: 'mmkv', label: 'MMKV' },
          { id: 'db', label: 'Databases' },
          { id: 'files', label: 'Files' },
        ]}
      />
      <div className="storage-body">
        {sub === 'prefs' ? (
          <PrefsView file={route.parts[1] ?? null} />
        ) : sub === 'mmkv' ? (
          <MmkvView id={route.parts[1] ?? null} />
        ) : sub === 'db' ? (
          <DbView db={route.parts[1] ?? null} table={route.parts[2] ?? null} />
        ) : (
          <FilesView root={route.parts[1] ?? null} path={route.parts.slice(2).join('/')} />
        )}
      </div>
    </div>
  );
}

function Unavailable({ what, error }: { what: string; error: unknown }) {
  if (isUnavailable(error)) {
    return (
      <EmptyState icon="lock" title={`${what} aren't available in this build`}>
        The app didn't give Killcam access to its {what.toLowerCase()} (<span className="mono">{(error as { code: string }).code}</span>). Everything else keeps
        working.
      </EmptyState>
    );
  }
  return (
    <EmptyState icon="warning" tone="error" title={`Could not load ${what.toLowerCase()}`}>
      {errorMessage(error)}
    </EmptyState>
  );
}

// ================================================================== prefs ==

function PrefsView({ file }: { file: string | null }) {
  const files = useAsync((s) => api.get<PrefFile[]>('prefs', undefined, s), []);
  useEffect(() => {
    if (!file && files.data?.length) navigate(routePath('storage', 'prefs', files.data[0].name), { replace: true });
  }, [file, files.data]);
  if (files.error) return <Unavailable what="Shared preferences" error={files.error} />;
  if (!files.data) return <Loading />;
  if (!files.data.length) return <EmptyState icon="key" title="No SharedPreferences files" />;
  return (
    <div className="master-detail">
      <nav className="md-list" aria-label="Preference files">
        {files.data.map((f) => (
          <button
            type="button"
            key={f.name}
            className={f.name === file ? 'md-item sel' : 'md-item'}
            onClick={() => navigate(routePath('storage', 'prefs', f.name), { replace: true })}
          >
            <Icon name="key" size={14} />
            <span className="md-name mono">{f.name}</span>
            <span className="md-meta tnum">
              {f.entryCount} · {fmtBytes(f.sizeBytes)}
            </span>
          </button>
        ))}
      </nav>
      <div className="md-main">{file ? <PrefEntries key={file} file={file} onChanged={files.reload} /> : null}</div>
    </div>
  );
}

const PREF_TYPES: PrefType[] = ['string', 'boolean', 'int', 'long', 'float', 'string_set'];

function validatePref(type: PrefType, value: string): string | null {
  if (type === 'boolean' && value !== 'true' && value !== 'false') return 'expected true or false';
  if ((type === 'int' || type === 'long') && !/^-?\d+$/.test(value.trim())) return 'expected an integer';
  if (type === 'float' && (value.trim() === '' || Number.isNaN(Number(value)))) return 'expected a number';
  if (type === 'string_set') {
    const v = tryParseJson(value, 'application/json');
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) return 'expected a JSON array of strings';
  }
  return null;
}

function PrefEntries({ file, onChanged }: { file: string; onChanged: () => void }) {
  const entries = useAsync((s) => api.get<PrefEntry[]>(`prefs/${enc(file)}`, undefined, s), [file]);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [setEdit, setSetEdit] = useState<PrefEntry | null>(null);

  const put = async (e: PrefEntry) => {
    const err = validatePref(e.type, e.value);
    if (err) {
      toast(`${e.key}: ${err}`, 'error');
      return false;
    }
    try {
      await api.put<PrefEntry>(`prefs/${enc(file)}`, e);
      entries.reload();
      onChanged();
      return true;
    } catch (x) {
      toast(`Could not save ${e.key}: ${errorMessage(x)}`, 'error');
      return false;
    }
  };
  const remove = async (e: PrefEntry) => {
    if (!(await confirmDialog({ title: `Delete “${e.key}”?`, message: `Removes the key from ${file}.xml.`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api.del(`prefs/${enc(file)}`, { key: e.key });
      entries.reload();
      onChanged();
    } catch (x) {
      toast(`Delete failed: ${errorMessage(x)}`, 'error');
    }
  };

  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (entries.data ?? []).filter((e) => !n || e.key.toLowerCase().includes(n) || e.value.toLowerCase().includes(n));
  }, [entries.data, q]);

  return (
    <div className="list-pane">
      <div className="toolbar">
        <div className="toolbar-title mono">{file}</div>
        <SearchInput value={q} onChange={setQ} placeholder="Filter keys" width={220} />
        <span className="grow" />
        <IconButton icon="refresh" label="Reload" onClick={entries.reload} />
        <button type="button" className="btn primary" onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} />
          <span>Add entry</span>
        </button>
      </div>
      <div className="scroll">
        {entries.error ? (
          <Unavailable what="Shared preferences" error={entries.error} />
        ) : !entries.data ? (
          <Loading />
        ) : (
          <div className="table-scroll">
            <table className="grid prefs">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Type</th>
                  <th className="col-value">Value</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {adding && <AddPrefRow onCancel={() => setAdding(false)} onAdd={async (e) => (await put(e)) && setAdding(false)} />}
                {rows.map((e) => (
                  <tr key={e.key}>
                    <td className="mono pref-key">{e.key}</td>
                    <td>
                      <span className="badge">{e.type}</span>
                    </td>
                    <td className="col-value">
                      <PrefValue entry={e} onSave={(value) => put({ ...e, value })} onEditSet={() => setSetEdit(e)} />
                    </td>
                    <td className="row-actions">
                      <IconButton icon="trash" label={`Delete ${e.key}`} onClick={() => remove(e)} />
                    </td>
                  </tr>
                ))}
                {!rows.length && !adding && (
                  <tr>
                    <td colSpan={4}>
                      <div className="body-empty">{entries.data.length ? 'No keys match.' : 'This file is empty.'}</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {setEdit && (
        <StringSetEditor
          entry={setEdit}
          onClose={() => setSetEdit(null)}
          onSave={async (value) => (await put({ ...setEdit, value })) && setSetEdit(null)}
        />
      )}
    </div>
  );
}

function PrefValue({ entry: e, onSave, onEditSet }: { entry: PrefEntry; onSave: (v: string) => Promise<boolean>; onEditSet: () => void }) {
  const [draft, setDraft] = useState(e.value);
  useEffect(() => setDraft(e.value), [e.value]);
  if (e.type === 'boolean') {
    return (
      <span className="flag-bool">
        <Switch checked={e.value === 'true'} onChange={(v) => onSave(String(v))} label={`${e.key}: ${e.value}`} />
        <span className="mono muted">{e.value}</span>
      </span>
    );
  }
  if (e.type === 'string_set') {
    const items = (tryParseJson(e.value, 'application/json') as string[] | undefined) ?? [];
    return (
      <button type="button" className="set-value" onClick={onEditSet} title="Edit set">
        {items.length ? items.map((s) => <span key={s} className="set-chip mono">{s}</span>) : <span className="muted">empty set</span>}
        <Icon name="edit" size={13} />
      </button>
    );
  }
  const commit = async () => {
    if (draft === e.value) return;
    if (!(await onSave(draft))) setDraft(e.value);
  };
  const long = e.type === 'string' && (e.value.length > 80 || e.value.includes('\n'));
  const epoch = e.type === 'long' && looksLikeEpochMs(Number(e.value)) ? fmtDateTime(Number(e.value), true) : null;
  const props = {
    className: 'input mono pref-input',
    value: draft,
    spellCheck: false,
    'aria-label': e.key,
    onBlur: commit,
  };
  return (
    <span className="pref-edit">
      {long ? (
        <textarea {...props} rows={Math.min(6, Math.max(2, Math.ceil(e.value.length / 80)))} onChange={(x) => setDraft(x.target.value)} />
      ) : (
        <input
          {...props}
          inputMode={e.type === 'string' ? undefined : e.type === 'float' ? 'decimal' : 'numeric'}
          onChange={(x) => setDraft(x.target.value)}
          onKeyDown={(x) => {
            if (x.key === 'Enter') (x.target as HTMLInputElement).blur();
            if (x.key === 'Escape') setDraft(e.value);
          }}
        />
      )}
      {epoch && <small className="muted">{epoch}</small>}
    </span>
  );
}

function AddPrefRow({ onAdd, onCancel }: { onAdd: (e: PrefEntry) => void; onCancel: () => void }) {
  const [e, setE] = useState<PrefEntry>({ key: '', type: 'string', value: '' });
  const submit = () => {
    if (!e.key.trim()) return toast('Key is required', 'error');
    onAdd({ ...e, key: e.key.trim(), value: e.type === 'string_set' && !e.value.trim() ? '[]' : e.value });
  };
  return (
    <tr className="add-row">
      <td>
        <input className="input mono" placeholder="key" value={e.key} onChange={(x) => setE({ ...e, key: x.target.value })} autoFocus aria-label="New key" />
      </td>
      <td>
        <select
          className="select"
          value={e.type}
          aria-label="New type"
          onChange={(x) => {
            const type = x.target.value as PrefType;
            setE({ ...e, type, value: type === 'boolean' ? 'true' : type === 'string_set' ? '[]' : e.value });
          }}
        >
          {PREF_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </td>
      <td className="col-value">
        {e.type === 'boolean' ? (
          <select className="select" value={e.value} onChange={(x) => setE({ ...e, value: x.target.value })} aria-label="New value">
            <option>true</option>
            <option>false</option>
          </select>
        ) : (
          <input
            className="input mono"
            placeholder={e.type === 'string_set' ? '["a","b"]' : 'value'}
            value={e.value}
            onChange={(x) => setE({ ...e, value: x.target.value })}
            onKeyDown={(x) => x.key === 'Enter' && submit()}
            aria-label="New value"
          />
        )}
      </td>
      <td className="row-actions">
        <IconButton icon="check" label="Add entry" onClick={submit} kind="primary" />
        <IconButton icon="x" label="Cancel" onClick={onCancel} />
      </td>
    </tr>
  );
}

function StringSetEditor({ entry, onClose, onSave }: { entry: PrefEntry; onClose: () => void; onSave: (v: string) => void }) {
  const [text, setText] = useState(() => ((tryParseJson(entry.value, 'application/json') as string[] | undefined) ?? []).join('\n'));
  const values = text.split('\n').map((s) => s.trim()).filter(Boolean);
  return (
    <Modal
      title={
        <span>
          Edit <span className="mono">{entry.key}</span>
        </span>
      }
      onClose={onClose}
      width={460}
      footer={
        <>
          <span className="muted">{new Set(values).size} values</span>
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => onSave(JSON.stringify([...new Set(values)]))}>
            Save
          </button>
        </>
      }
    >
      <p className="dialog-msg">One value per line. Duplicates are dropped (it is a set).</p>
      <textarea className="input mono body-edit" rows={10} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
    </Modal>
  );
}

// =================================================================== mmkv ==

const MMKV_TYPES: MmkvValueType[] = ['string', 'bool', 'int', 'long', 'float', 'double', 'bytes'];

function validateMmkv(type: MmkvValueType, value: string): string | null {
  if (type === 'bool' && value !== 'true' && value !== 'false') return 'expected true or false';
  if ((type === 'int' || type === 'long') && !/^-?\d+$/.test(value.trim())) return 'expected an integer';
  if ((type === 'float' || type === 'double') && (value.trim() === '' || Number.isNaN(Number(value)))) return 'expected a number';
  if (type === 'bytes' && !/^[A-Za-z0-9+/]*={0,2}$/.test(value.trim())) return 'expected base64';
  return null;
}

function MmkvUnavailable({ error }: { error: unknown }) {
  if (!isUnavailable(error)) return <Unavailable what="MMKV stores" error={error} />;
  return (
    <EmptyState icon="lock" title="MMKV isn't available in this build">
      Native MMKV needs <span className="mono">com.tencent:mmkv</span> in the app, plus{' '}
      <span className="mono">Killcam.registerMmkv(id, cryptKey)</span> for every non-default instance (Killcam never opens stores it wasn't given a key
      for). <span className="mono">react-native-mmkv</span> stores are inspected with Rozenite’s storage plugin in React Native DevTools.
    </EmptyState>
  );
}

function MmkvView({ id }: { id: string | null }) {
  const list = useAsync((s) => api.get<MmkvInstance[]>('mmkv', undefined, s), []);
  useEffect(() => {
    if (!id && list.data?.length) {
      const first = list.data.find((m) => !m.error) ?? list.data[0];
      navigate(routePath('storage', 'mmkv', first.id), { replace: true });
    }
  }, [id, list.data]);
  if (list.error) return <MmkvUnavailable error={list.error} />;
  if (!list.data) return <Loading />;
  if (!list.data.length)
    return (
      <EmptyState icon="storage" title="No MMKV instances">
        The default instance appears once the app calls <span className="mono">MMKV.initialize</span>; register others with{' '}
        <span className="mono">Killcam.registerMmkv(id, cryptKey)</span>.
      </EmptyState>
    );
  const inst = list.data.find((m) => m.id === id) ?? null;
  return (
    <div className="master-detail">
      <nav className="md-list" aria-label="MMKV instances">
        {list.data.map((m) => (
          <button
            type="button"
            key={m.id}
            className={['md-item', 'mmkv-item', m.id === id ? 'sel' : '', m.error ? 'has-error' : ''].join(' ')}
            onClick={() => navigate(routePath('storage', 'mmkv', m.id), { replace: true })}
            title={m.error ?? undefined}
          >
            <Icon name={m.error ? 'warning' : m.encrypted ? 'lock' : 'key'} size={14} />
            <span className="md-name">
              <span className="mono">{m.id}</span>
              {m.error ? (
                <small className="text-error">{m.error}</small>
              ) : (
                <small className="muted tnum">
                  {m.keyCount} keys · {fmtBytes(m.sizeBytes)}
                </small>
              )}
            </span>
            {m.encrypted && <span className="badge badge-enc">encrypted</span>}
          </button>
        ))}
      </nav>
      <div className="md-main">
        {!inst ? null : inst.error ? (
          <EmptyState icon="warning" tone="error" title={`Could not open ${inst.id}`}>
            <span className="mono">{inst.error}</span>
          </EmptyState>
        ) : (
          <MmkvEntries key={inst.id} inst={inst} onChanged={list.reload} />
        )}
      </div>
    </div>
  );
}

function MmkvEntries({ inst, onChanged }: { inst: MmkvInstance; onChanged: () => void }) {
  const entries = useAsync((s) => api.get<MmkvEntry[]>(`mmkv/${enc(inst.id)}`, undefined, s), [inst.id]);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [bytesEdit, setBytesEdit] = useState<MmkvEntry | null>(null);

  const put = async (e: { key: string; type: MmkvValueType; value: string }) => {
    const err = validateMmkv(e.type, e.value);
    if (err) {
      toast(`${e.key}: ${err}`, 'error');
      return false;
    }
    try {
      await api.put<MmkvEntry>(`mmkv/${enc(inst.id)}`, { key: e.key, type: e.type, value: e.type === 'bytes' ? e.value.trim() : e.value });
      entries.reload();
      onChanged();
      return true;
    } catch (x) {
      toast(`Could not save ${e.key}: ${errorMessage(x)}`, 'error');
      return false;
    }
  };
  const remove = async (e: MmkvEntry) => {
    if (!(await confirmDialog({ title: `Delete “${e.key}”?`, message: `Removes the key from ${inst.id}.`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api.del(`mmkv/${enc(inst.id)}`, { key: e.key });
      entries.reload();
      onChanged();
    } catch (x) {
      toast(`Delete failed: ${errorMessage(x)}`, 'error');
    }
  };
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (entries.data ?? []).filter((e) => !n || e.key.toLowerCase().includes(n) || e.value.toLowerCase().includes(n));
  }, [entries.data, q]);

  return (
    <div className="list-pane">
      <div className="toolbar">
        <div className="toolbar-title">
          <span className="mono">{inst.id}</span>
          {inst.encrypted && <span className="badge badge-enc">encrypted</span>}
        </div>
        <SearchInput value={q} onChange={setQ} placeholder="Filter keys" width={220} />
        <span className="grow" />
        <IconButton icon="refresh" label="Reload" onClick={entries.reload} />
        <button type="button" className="btn primary" onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} />
          <span>Add entry</span>
        </button>
      </div>
      <div className="subbar muted">
        <Icon name="info" size={13} />
        <span>
          Types are inferred: MMKV stores raw bytes, so Killcam guesses from size and content. Pick the right type when editing; it decides how the value
          is encoded.
        </span>
      </div>
      <div className="scroll">
        {entries.error ? (
          <MmkvUnavailable error={entries.error} />
        ) : !entries.data ? (
          <Loading />
        ) : (
          <div className="table-scroll">
            <table className="grid prefs mmkv">
              <thead>
                <tr>
                  <th>Key</th>
                  <th title="Inferred from the stored bytes">Type (inferred)</th>
                  <th className="col-value">Value</th>
                  <th className="num">Size</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {adding && <AddMmkvRow onCancel={() => setAdding(false)} onAdd={async (e) => (await put(e)) && setAdding(false)} />}
                {rows.map((e) => (
                  <tr key={e.key}>
                    <td className="mono pref-key">{e.key}</td>
                    <td>
                      <select
                        className="select type-select mono"
                        value={e.type}
                        aria-label={`${e.key} type`}
                        title="Inferred type; change it to re-encode the value"
                        onChange={(x) => void put({ key: e.key, type: x.target.value as MmkvValueType, value: e.value })}
                      >
                        {MMKV_TYPES.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    </td>
                    <td className="col-value">
                      <MmkvValue entry={e} onSave={(value) => put({ key: e.key, type: e.type, value })} onEditBytes={() => setBytesEdit(e)} />
                    </td>
                    <td className="num tnum muted">{fmtBytes(e.sizeBytes)}</td>
                    <td className="row-actions">
                      <IconButton icon="trash" label={`Delete ${e.key}`} onClick={() => remove(e)} />
                    </td>
                  </tr>
                ))}
                {!rows.length && !adding && (
                  <tr>
                    <td colSpan={5}>
                      <div className="body-empty">{entries.data.length ? 'No keys match.' : 'This instance is empty.'}</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {bytesEdit && (
        <BytesEditor entry={bytesEdit} onClose={() => setBytesEdit(null)} onSave={async (v) => (await put({ key: bytesEdit.key, type: 'bytes', value: v })) && setBytesEdit(null)} />
      )}
    </div>
  );
}

function MmkvValue({ entry: e, onSave, onEditBytes }: { entry: MmkvEntry; onSave: (v: string) => Promise<boolean>; onEditBytes: () => void }) {
  const [draft, setDraft] = useState(e.value);
  useEffect(() => setDraft(e.value), [e.value]);
  if (e.type === 'bool') {
    return (
      <span className="flag-bool">
        <Switch checked={e.value === 'true'} onChange={(v) => onSave(String(v))} label={`${e.key}: ${e.value}`} />
        <span className="mono muted">{e.value}</span>
      </span>
    );
  }
  if (e.type === 'bytes') {
    return (
      <button type="button" className="json-value mono" onClick={onEditBytes} title="Edit bytes (base64)">
        <span className="badge">b64</span>
        <span className="clip">{e.value || '(empty)'}</span>
        <Icon name="edit" size={13} />
      </button>
    );
  }
  const commit = async () => {
    if (draft === e.value) return;
    if (!(await onSave(draft))) setDraft(e.value);
  };
  const numeric = e.type !== 'string';
  const long = !numeric && (e.value.length > 80 || e.value.includes('\n'));
  const epoch = e.type === 'long' && looksLikeEpochMs(Number(e.value)) ? fmtDateTime(Number(e.value), true) : null;
  return (
    <span className="pref-edit">
      {long ? (
        <textarea
          className="input mono pref-input"
          value={draft}
          spellCheck={false}
          aria-label={e.key}
          rows={Math.min(6, Math.max(2, Math.ceil(e.value.length / 80)))}
          onChange={(x) => setDraft(x.target.value)}
          onBlur={commit}
        />
      ) : (
        <input
          className="input mono pref-input"
          value={draft}
          spellCheck={false}
          aria-label={e.key}
          inputMode={numeric ? (e.type === 'int' || e.type === 'long' ? 'numeric' : 'decimal') : undefined}
          onChange={(x) => setDraft(x.target.value)}
          onBlur={commit}
          onKeyDown={(x) => {
            if (x.key === 'Enter') (x.target as HTMLInputElement).blur();
            if (x.key === 'Escape') setDraft(e.value);
          }}
        />
      )}
      {epoch && <small className="muted">{epoch}</small>}
    </span>
  );
}

function AddMmkvRow({ onAdd, onCancel }: { onAdd: (e: { key: string; type: MmkvValueType; value: string }) => void; onCancel: () => void }) {
  const [e, setE] = useState<{ key: string; type: MmkvValueType; value: string }>({ key: '', type: 'string', value: '' });
  const submit = () => {
    if (!e.key.trim()) return toast('Key is required', 'error');
    onAdd({ ...e, key: e.key.trim() });
  };
  return (
    <tr className="add-row">
      <td>
        <input className="input mono" placeholder="key" value={e.key} onChange={(x) => setE({ ...e, key: x.target.value })} autoFocus aria-label="New key" />
      </td>
      <td>
        <select
          className="select mono"
          value={e.type}
          aria-label="New type"
          onChange={(x) => {
            const type = x.target.value as MmkvValueType;
            setE({ ...e, type, value: type === 'bool' ? 'true' : e.value });
          }}
        >
          {MMKV_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </td>
      <td className="col-value">
        {e.type === 'bool' ? (
          <select className="select" value={e.value} onChange={(x) => setE({ ...e, value: x.target.value })} aria-label="New value">
            <option>true</option>
            <option>false</option>
          </select>
        ) : (
          <input
            className="input mono"
            placeholder={e.type === 'bytes' ? 'base64' : 'value'}
            value={e.value}
            onChange={(x) => setE({ ...e, value: x.target.value })}
            onKeyDown={(x) => x.key === 'Enter' && submit()}
            aria-label="New value"
          />
        )}
      </td>
      <td />
      <td className="row-actions">
        <IconButton icon="check" label="Add entry" onClick={submit} kind="primary" />
        <IconButton icon="x" label="Cancel" onClick={onCancel} />
      </td>
    </tr>
  );
}

function BytesEditor({ entry, onClose, onSave }: { entry: MmkvEntry; onClose: () => void; onSave: (v: string) => void }) {
  const [text, setText] = useState(entry.value);
  const valid = /^[A-Za-z0-9+/]*={0,2}$/.test(text.trim().replace(/\s+/g, ''));
  const preview = useMemo(() => {
    try {
      const bin = atob(text.trim().replace(/\s+/g, ''));
      let out = '';
      for (let off = 0; off < Math.min(bin.length, 256); off += 16) {
        const chunk = [...bin.slice(off, off + 16)].map((c) => c.charCodeAt(0));
        out += `${off.toString(16).padStart(4, '0')}  ${chunk.map((b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(47)}  ${chunk.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('')}\n`;
      }
      return { bytes: bin.length, hex: out };
    } catch {
      return null;
    }
  }, [text]);
  return (
    <Modal
      title={
        <span>
          Edit <span className="mono">{entry.key}</span> (bytes)
        </span>
      }
      onClose={onClose}
      width={620}
      footer={
        <>
          <span className={valid && preview ? 'test-ok' : 'test-no'}>
            <Icon name={valid && preview ? 'check' : 'warning'} size={13} /> {valid && preview ? `${preview.bytes} bytes` : 'invalid base64'}
          </span>
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={!valid || !preview} onClick={() => onSave(text.trim().replace(/\s+/g, ''))}>
            Save
          </button>
        </>
      }
    >
      <textarea className="input mono body-edit" rows={5} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="Base64" />
      {preview && preview.hex && <pre className="raw mono muted hex-preview">{preview.hex}</pre>}
    </Modal>
  );
}

// ============================================================== databases ==

function DbView({ db, table }: { db: string | null; table: string | null }) {
  const dbs = useAsync((s) => api.get<DbInfo[]>('db', undefined, s), []);
  const [mode, setMode] = useState<'browse' | 'sql'>('browse');
  useEffect(() => {
    if (!db && dbs.data?.length) {
      const first = dbs.data[0];
      const t = first.tables.find((x) => x.type === 'table') ?? first.tables[0];
      navigate(routePath('storage', 'db', first.name, t?.name), { replace: true });
    }
  }, [db, dbs.data]);
  if (dbs.error) return <Unavailable what="Databases" error={dbs.error} />;
  if (!dbs.data) return <Loading />;
  if (!dbs.data.length) return <EmptyState icon="storage" title="No SQLite databases" />;
  const info = dbs.data.find((d) => d.name === db) ?? null;
  return (
    <div className="master-detail">
      <nav className="md-list" aria-label="Databases">
        {dbs.data.map((d) => (
          <div key={d.name} className="db-group">
            <div className={d.name === db ? 'db-name sel' : 'db-name'} title={d.path}>
              <Icon name="storage" size={14} />
              <span className="mono">{d.name}</span>
              <span className="md-meta">{fmtBytes(d.sizeBytes)}</span>
            </div>
            {d.tables.map((t) => (
              <button
                type="button"
                key={t.name}
                className={d.name === db && t.name === table ? 'md-item sub sel' : 'md-item sub'}
                onClick={() => {
                  setMode('browse');
                  navigate(routePath('storage', 'db', d.name, t.name), { replace: true });
                }}
              >
                <Icon name={t.type === 'view' ? 'eye' : 'table'} size={13} />
                <span className="md-name mono">{t.name}</span>
                <span className="md-meta tnum">{t.rowCount ?? (t.type === 'view' ? 'view' : '—')}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="md-main">
        {info ? (
          <div className="list-pane">
            <div className="toolbar">
              <div className="toolbar-title">
                <span className="mono">{info.name}</span>
                {table && mode === 'browse' && (
                  <>
                    <Icon name="chevron-right" size={12} />
                    <span className="mono">{table}</span>
                  </>
                )}
              </div>
              <span className="grow" />
              <Segmented<'browse' | 'sql'>
                label="Mode"
                value={table ? mode : 'sql'}
                onChange={setMode}
                options={[
                  { value: 'browse', label: 'Browse' },
                  { value: 'sql', label: 'SQL' },
                ]}
              />
            </div>
            {table && mode === 'browse' ? (
              <TableBrowser key={`${info.name}/${table}`} db={info.name} table={table} />
            ) : (
              <SqlConsole key={info.name} db={info.name} initial={`SELECT * FROM ${table ?? info.tables[0]?.name ?? 'sqlite_master'} LIMIT 50;`} />
            )}
          </div>
        ) : (
          <EmptyState icon="storage" title="Pick a database" />
        )}
      </div>
    </div>
  );
}

const PAGE = 50;

function TableBrowser({ db, table }: { db: string; table: string }) {
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<{ col: string; desc: boolean } | null>(null);
  const res = useAsync(
    (s) =>
      api.get<QueryResult>(
        `db/${enc(db)}/tables/${enc(table)}`,
        { offset, limit: PAGE, orderBy: sort?.col, desc: sort ? sort.desc : undefined },
        s,
      ),
    [db, table, offset, sort?.col, sort?.desc],
  );
  const r = res.data;
  const total = r?.totalRows ?? null;
  const pages = total != null ? Math.max(1, Math.ceil(total / PAGE)) : null;
  const page = Math.floor(offset / PAGE) + 1;
  return (
    <>
      <div className="subbar">
        <span className="muted tnum">
          {total != null ? `${total.toLocaleString()} rows` : ''}
          {r ? ` · ${r.elapsedMs} ms` : ''}
        </span>
        <span className="grow" />
        <div className="pager">
          <IconButton icon="skip-back" label="First page" size={13} disabled={offset === 0} onClick={() => setOffset(0)} />
          <IconButton icon="back" label="Previous page" size={14} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} />
          <span className="tnum">
            {page}
            {pages ? ` / ${pages}` : ''}
          </span>
          <IconButton icon="chevron-right" label="Next page" size={14} disabled={pages != null ? page >= pages : (r?.rows.length ?? 0) < PAGE} onClick={() => setOffset(offset + PAGE)} />
          <IconButton icon="skip-fwd" label="Last page" size={13} disabled={pages == null || page >= pages} onClick={() => pages && setOffset((pages - 1) * PAGE)} />
        </div>
        <IconButton icon="refresh" label="Reload" onClick={res.reload} />
      </div>
      <div className="scroll grid-scroll">
        {res.error ? (
          <Unavailable what="Databases" error={res.error} />
        ) : !r ? (
          <Loading />
        ) : r.error ? (
          <div className="notice notice-error mono">{r.error}</div>
        ) : (
          <ResultGrid
            result={r}
            rowOffset={offset}
            sort={sort}
            onSort={(col) => {
              setOffset(0);
              setSort((s) => (s?.col === col ? (s.desc ? null : { col, desc: true }) : { col, desc: false }));
            }}
          />
        )}
      </div>
    </>
  );
}

function SqlConsole({ db, initial }: { db: string; initial: string }) {
  const [sql, setSql] = useState(initial);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const run = async () => {
    if (!sql.trim() || running) return;
    setRunning(true);
    setFailure(null);
    try {
      setResult(await api.post<QueryResult>(`db/${enc(db)}/query`, { sql }));
    } catch (e) {
      setFailure(e);
      setResult(null);
    } finally {
      setRunning(false);
    }
  };
  return (
    <div className="sql">
      <div className="sql-editor">
        <textarea
          className="input mono"
          value={sql}
          rows={4}
          spellCheck={false}
          aria-label="SQL"
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void run();
            }
          }}
        />
        <div className="sql-actions">
          <button type="button" className="btn primary" onClick={run} disabled={running}>
            <Icon name="play" size={12} />
            <span>{running ? 'Running…' : 'Run'}</span>
          </button>
          <kbd>⌘/Ctrl + Enter</kbd>
          <span className="grow" />
          {result && !result.error && (
            <span className="muted tnum">
              {result.affectedRows != null ? `${result.affectedRows} row${result.affectedRows === 1 ? '' : 's'} affected` : `${result.rows.length} row${result.rows.length === 1 ? '' : 's'}`}
              {result.truncated ? ' (truncated)' : ''} · {result.elapsedMs} ms
            </span>
          )}
        </div>
      </div>
      <div className="scroll grid-scroll">
        {failure ? (
          isUnavailable(failure) ? (
            <Unavailable what="Databases" error={failure} />
          ) : (
            <div className="notice notice-error mono">{errorMessage(failure)}</div>
          )
        ) : result?.error ? (
          <div className="notice notice-error mono">{result.error}</div>
        ) : result && result.columns.length ? (
          <ResultGrid result={result} rowOffset={0} />
        ) : result ? (
          <div className="body-empty">Statement ran. No rows returned.</div>
        ) : (
          <div className="body-empty">Run a query against {db}. Writes (INSERT/UPDATE/DELETE) report affected rows.</div>
        )}
      </div>
    </div>
  );
}

function fmtCell(v: Cell): ReactNode {
  if (v === null) return <span className="null">NULL</span>;
  if (typeof v === 'number') return v;
  return v.length > 140 ? v.slice(0, 140) + '…' : v;
}

function ResultGrid({
  result,
  rowOffset,
  sort,
  onSort,
}: {
  result: QueryResult;
  rowOffset: number;
  sort?: { col: string; desc: boolean } | null;
  onSort?: (col: string) => void;
}) {
  const [cell, setCell] = useState<{ col: string; value: Cell } | null>(null);
  return (
    <>
      <table className="grid data-grid mono">
        <thead>
          <tr>
            <th className="rownum">#</th>
            {result.columns.map((c) => (
              <th key={c} className={onSort ? 'sortable' : undefined} onClick={onSort ? () => onSort(c) : undefined} aria-sort={sort?.col === c ? (sort.desc ? 'descending' : 'ascending') : undefined}>
                {c}
                {sort?.col === c && <Icon name={sort.desc ? 'arrow-down' : 'arrow-up'} size={11} />}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i}>
              <td className="rownum tnum">{rowOffset + i + 1}</td>
              {row.map((v, j) => (
                <td
                  key={j}
                  className={typeof v === 'number' ? 'num' : undefined}
                  title={looksLikeEpochMs(v) ? fmtDateTime(v, true) : typeof v === 'string' && v.length > 40 ? 'Click to view' : undefined}
                  onClick={() => setCell({ col: result.columns[j], value: v })}
                >
                  {fmtCell(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {result.truncated && <div className="notice notice-warn">Result truncated by the device.</div>}
      {cell && <CellModal col={cell.col} value={cell.value} onClose={() => setCell(null)} />}
    </>
  );
}

function CellModal({ col, value, onClose }: { col: string; value: Cell; onClose: () => void }) {
  const text = value === null ? 'NULL' : String(value);
  const json = typeof value === 'string' ? tryParseJson(value) : undefined;
  return (
    <Modal title={<span className="mono">{col}</span>} onClose={onClose} width={640} footer={<CopyButton text={text} label="Copy value" showLabel />}>
      {looksLikeEpochMs(value) && <p className="muted">{fmtDateTime(value, true)} (epoch ms)</p>}
      {json !== undefined ? <JsonTree value={json} expandDepth={3} /> : <pre className="raw mono">{text}</pre>}
    </Modal>
  );
}

// ================================================================== files ==

function FilesView({ root, path }: { root: string | null; path: string }) {
  const embed = useStore(appStore, (s) => s.embed);
  const roots = useAsync((s) => api.get<FileRoot[]>('files/roots', undefined, s), []);
  const [open, setOpen] = useState<FileEntry | null>(null);
  const list = useAsync(
    (s) => (root ? api.get<FileEntry[]>('files', { root, path }, s) : Promise.resolve([] as FileEntry[])),
    [root, path],
  );
  useEffect(() => {
    if (!root && roots.data?.length) navigate(routePath('storage', 'files', roots.data[0].id), { replace: true });
  }, [root, roots.data]);
  useEffect(() => setOpen(null), [root, path]);

  if (roots.error) return <Unavailable what="Files" error={roots.error} />;
  if (!roots.data) return <Loading />;
  if (!roots.data.length) return <EmptyState icon="folder" title="No file roots exposed" />;
  const rootInfo = roots.data.find((r) => r.id === root) ?? null;
  const segs = path.split('/').filter(Boolean);
  const go = (p: string) => navigate(routePath('storage', 'files', root, ...p.split('/').filter(Boolean)));

  const remove = async (f: FileEntry) => {
    if (!(await confirmDialog({ title: `Delete ${f.dir ? 'folder' : 'file'} “${f.name}”?`, message: f.dir ? 'Deletes the folder and everything in it on the device.' : 'Deletes the file on the device.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api.del('files', { root, path: f.path });
      if (open?.path === f.path) setOpen(null);
      list.reload();
      toast(`Deleted ${f.name}`, 'ok');
    } catch (e) {
      toast(`Delete failed: ${errorMessage(e)}`, 'error');
    }
  };

  const browser = (
    <div className="list-pane">
      <div className="toolbar">
        <select className="select" value={root ?? ''} aria-label="Root" onChange={(e) => navigate(routePath('storage', 'files', e.target.value))}>
          {roots.data.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <nav className="crumbs mono" aria-label="Path">
          <button type="button" className="crumb" onClick={() => go('')} title={rootInfo?.path}>
            {rootInfo?.path.split('/').pop() || root}
          </button>
          {segs.map((s, i) => (
            <span key={i}>
              <Icon name="chevron-right" size={11} />
              <button type="button" className="crumb" onClick={() => go(segs.slice(0, i + 1).join('/'))}>
                {s}
              </button>
            </span>
          ))}
        </nav>
        <span className="grow" />
        <IconButton icon="refresh" label="Reload" onClick={list.reload} />
      </div>
      <div className="scroll">
        {list.error ? (
          <Unavailable what="Files" error={list.error} />
        ) : !list.data ? (
          <Loading />
        ) : !list.data.length ? (
          <EmptyState icon="folder" title="Empty folder" />
        ) : (
          <div className="table-scroll">
            <table className="grid files">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="num">Size</th>
                  <th>Modified</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {segs.length > 0 && (
                  <tr className="clickable" onClick={() => go(segs.slice(0, -1).join('/'))}>
                    <td colSpan={4}>
                      <span className="file-name">
                        <Icon name="back" size={14} /> ..
                      </span>
                    </td>
                  </tr>
                )}
                {list.data.map((f) => (
                  <tr key={f.path} className={['clickable', open?.path === f.path ? 'sel' : ''].join(' ')} onClick={() => (f.dir ? go(f.path) : setOpen(f))}>
                    <td>
                      <span className="file-name">
                        <Icon name={f.dir ? 'folder' : 'file'} size={14} className={f.dir ? 'text-accent' : undefined} />
                        <span className="mono">{f.name}</span>
                      </span>
                    </td>
                    <td className="num tnum">{f.dir ? '' : fmtBytes(f.size)}</td>
                    <td className="tnum muted">{fmtDateTime(f.modifiedMs)}</td>
                    <td className="row-actions" onClick={(e) => e.stopPropagation()}>
                      {!f.dir && !embed && (
                        <a className="btn btn-icon" href={apiUrl('files/content', { root, path: f.path, download: 1 })} download={f.name} aria-label={`Download ${f.name}`} title="Download">
                          <Icon name="download" />
                        </a>
                      )}
                      <IconButton icon="trash" label={`Delete ${f.name}`} onClick={() => remove(f)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="panel">
      <SplitView
        storageKey="files"
        open={!!open}
        list={browser}
        detail={open && root && <FileViewer key={open.path} root={root} file={open} onClose={() => setOpen(null)} onDelete={() => remove(open)} embed={embed} />}
      />
    </div>
  );
}

const TEXT_EXT = /\.(txt|log|json|xml|md|csv|html?|js|css|properties|ya?ml|ini|conf|pem|lock|journal)$/i;

function FileViewer({ root, file, onClose, onDelete, embed }: { root: string; file: FileEntry; onClose: () => void; onDelete: () => void; embed: boolean }) {
  const [force, setForce] = useState(false);
  const tooBig = file.size > 1024 * 1024 && !force;
  const content = useAsync(
    (s) => (tooBig ? Promise.resolve(null) : api.bytes('files/content', { root, path: file.path }, s)),
    [root, file.path, tooBig],
  );
  const decoded = useMemo(() => {
    const buf = content.data;
    if (!buf) return null;
    const bytes = new Uint8Array(buf);
    const head = bytes.subarray(0, 8192);
    const binary = head.includes(0) && !TEXT_EXT.test(file.name);
    if (binary) {
      let hex = '';
      for (let off = 0; off < Math.min(bytes.length, 512); off += 16) {
        const chunk = [...bytes.subarray(off, off + 16)];
        hex += `${off.toString(16).padStart(6, '0')}  ${chunk.map((b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(47)}  ${chunk.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('')}\n`;
      }
      return { binary: true as const, text: hex };
    }
    return { binary: false as const, text: new TextDecoder().decode(bytes) };
  }, [content.data, file.name]);
  const json = decoded && !decoded.binary ? tryParseJson(decoded.text) : undefined;
  const [mode, setMode] = useState<'tree' | 'raw'>('tree');
  const preRef = useRef<HTMLPreElement>(null);
  return (
    <div className="detail">
      <div className="detail-head">
        <IconButton icon="back" label="Close file" onClick={onClose} className="detail-back" />
        <Icon name="file" />
        <div className="detail-title mono" title={file.path}>
          {file.name}
        </div>
        <span className="muted tnum">{fmtBytes(file.size)}</span>
        {decoded && !decoded.binary && <CopyButton text={decoded.text} label="Copy contents" />}
        {!embed && (
          <a className="btn btn-icon" href={apiUrl('files/content', { root, path: file.path, download: 1 })} download={file.name} aria-label="Download" title="Download">
            <Icon name="download" />
          </a>
        )}
        <IconButton icon="trash" label="Delete file" onClick={onDelete} />
        <IconButton icon="x" label="Close file" onClick={onClose} className="detail-close" />
      </div>
      <div className="detail-body">
        <p className="muted small mono">
          {file.path} · modified {fmtDateTime(file.modifiedMs, true)}
        </p>
        {tooBig ? (
          <EmptyState icon="file" title={`Large file (${fmtBytes(file.size)})`}>
            <button type="button" className="link-btn" onClick={() => setForce(true)}>
              Load it anyway
            </button>
          </EmptyState>
        ) : content.error ? (
          <Unavailable what="Files" error={content.error} />
        ) : !decoded ? (
          <Loading />
        ) : decoded.binary ? (
          <>
            <div className="notice">Binary file: first 512 bytes shown{embed ? '' : '. Download it to inspect the rest'}.</div>
            <pre className="raw mono muted">{decoded.text}</pre>
          </>
        ) : json !== undefined ? (
          <>
            <Segmented<'tree' | 'raw'> size="sm" label="View" value={mode} onChange={setMode} options={[{ value: 'tree', label: 'Tree' }, { value: 'raw', label: 'Raw' }]} />
            {mode === 'tree' ? <JsonTree value={json} expandDepth={2} /> : <pre className="raw mono">{decoded.text}</pre>}
          </>
        ) : (
          <pre ref={preRef} className="raw mono">
            {decoded.text || <span className="muted">(empty file)</span>}
          </pre>
        )}
      </div>
    </div>
  );
}
