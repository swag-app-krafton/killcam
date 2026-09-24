import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Badge,
  Banner,
  Button,
  EmptyState,
  FlushCard,
  Kbd,
  Row,
  SearchInput,
  Segmented,
  SelectField,
  SortTh,
  Spacer,
  Stack,
  Table,
  TableEmptyRow,
  Text,
  TextAreaField,
  numCell,
} from '@/design';
import { api, apiUrl, enc, errorMessage, isUnavailable } from '../api/client';
import type { Cell, DbInfo, FileEntry, FileRoot, MmkvEntry, MmkvInstance, MmkvValueType, PrefEntry, PrefFile, PrefType, QueryResult } from '../api/types';
import { ConsoleBlock, ConsolePre, JsonBlock, hexDump, tryParseJson } from '../kit/console';
import { IconBtn, SelectInput, TextInput } from '../kit/controls';
import { ValueEditor, validateValue, type ValueType } from '../kit/editors';
import { KIcon } from '../kit/Icon';
import { Dock, KDialog } from '../kit/overlays';
import { fmt, fmtBytes, fmtDateTime, looksLikeEpochMs, plural } from '../lib/format';
import { useAsync } from '../lib/hooks';
import { appStore } from '../state/app';
import { navigate, routePath, useRoute } from '../state/router';
import { useStore } from '../state/store';
import { confirmDialog, toast } from '../state/ui';
import s from './Storage.module.css';

type Sub = 'prefs' | 'mmkv' | 'db' | 'files';

export function StoragePanel() {
  const route = useRoute();
  const p0 = route.parts[0];
  const sub: Sub = p0 === 'db' || p0 === 'files' || p0 === 'mmkv' ? p0 : 'prefs';
  const embed = useStore(appStore, (x) => x.embed);
  return (
    <Stack as="section" gap={20}>
      <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
      <Segmented<Sub>
        label="Store"
        value={sub}
        onChange={(x) => navigate(routePath('storage', x))}
        options={[
          { value: 'prefs', label: embed ? 'Shared prefs' : 'Shared preferences' },
          { value: 'mmkv', label: 'MMKV' },
          { value: 'db', label: 'Databases' },
          { value: 'files', label: 'Files' },
        ]}
      />
      </div>
      {sub === 'prefs' ? (
        <PrefsView file={route.parts[1] ?? null} />
      ) : sub === 'mmkv' ? (
        <MmkvView id={route.parts[1] ?? null} />
      ) : sub === 'db' ? (
        <DbView db={route.parts[1] ?? null} table={route.parts[2] ?? null} />
      ) : (
        <FilesView root={route.parts[1] ?? null} path={route.parts.slice(2).join('/')} />
      )}
    </Stack>
  );
}

const UNAVAILABLE: Record<string, { title: string; body: ReactNode }> = {
  prefs: { title: 'Shared preferences are not available in this build', body: 'The app did not give Killcam access to its SharedPreferences.' },
  databases: { title: 'Databases are not available in this build', body: 'The app did not give Killcam access to its SQLite databases.' },
  files: { title: 'Files are not available in this build', body: 'The app did not give Killcam access to its sandbox.' },
  mmkv: {
    title: 'MMKV is not available in this build',
    body: (
      <>
        Native MMKV needs com.tencent:mmkv in the app, plus Killcam.registerMmkv(id, cryptKey) for every instance other than the default: Killcam never opens a store it was
        not given the key for. react-native-mmkv stores are inspected with Rozenite’s storage plugin in React Native DevTools.
      </>
    ),
  },
};

function LoadError({ what, error, onRetry }: { what: keyof typeof UNAVAILABLE; error: unknown; onRetry?: () => void }) {
  if (isUnavailable(error)) return <EmptyState title={UNAVAILABLE[what].title}>{UNAVAILABLE[what].body}</EmptyState>;
  return (
    <EmptyState title="Could not load this store" actions={onRetry && <Button variant="outline" onClick={onRetry}>Try again</Button>}>
      {errorMessage(error)}
    </EmptyState>
  );
}

function StoreItem({ current, onClick, name, meta, sub, icon }: { current: boolean; onClick: () => void; name: ReactNode; meta?: ReactNode; sub?: boolean; icon: string }) {
  return (
    <button type="button" className={sub ? `${s.item} ${s.sub}` : s.item} aria-current={current || undefined} onClick={onClick}>
      <KIcon name={icon} size={14} />
      <span className={s.itemText}>{typeof name === 'string' ? <span className={s.name}>{name}</span> : name}</span>
      {meta != null && <span className={s.meta}>{meta}</span>}
    </button>
  );
}

// ================================================================ shared --

interface Entry {
  key: string;
  type: ValueType;
  value: string;
  sizeBytes?: number;
}

/** Keys, types and values with in-place editing, adding and deleting: shared
 *  preferences and MMKV. */
function EntriesCard({
  title,
  hint,
  entries,
  types,
  typeLabel = 'Type',
  typeEditable,
  showSize,
  onPut,
  onDelete,
  onReload,
  note,
}: {
  title: ReactNode;
  hint: ReactNode;
  entries: Entry[];
  types: ValueType[];
  typeLabel?: string;
  typeEditable?: boolean;
  showSize?: boolean;
  onPut: (e: Entry) => Promise<boolean>;
  onDelete: (e: Entry) => void;
  onReload: () => void;
  note?: ReactNode;
}) {
  const embed = useStore(appStore, (x) => x.embed);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return entries.filter((e) => !n || e.key.toLowerCase().includes(n) || e.value.toLowerCase().includes(n));
  }, [entries, q]);
  const put = async (e: Entry) => {
    const err = validateValue(e.type, e.value);
    if (err) {
      toast(`${e.key}: ${err}`, 'error');
      return false;
    }
    return onPut(e);
  };
  const typeCell = (e: Entry) =>
    typeEditable ? (
      <SelectInput value={e.type} aria-label={`${e.key} type`} title="Inferred; change it to store the value as another type" onChange={(x) => void put({ ...e, type: x.target.value as ValueType })} style={{ width: 100, height: 32 }}>
        {types.map((t) => (
          <option key={t}>{t}</option>
        ))}
      </SelectInput>
    ) : (
      <Badge>{e.type}</Badge>
    );
  return (
    <FlushCard
      title={title}
      hint={hint}
      aside={
        <Row gap={8}>
          <IconBtn icon="refresh" outlined label="Reload" onClick={onReload} />
          <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
            Add entry
          </Button>
        </Row>
      }
    >
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <SearchInput label="Filter keys" placeholder="Filter keys and values" value={q} onChange={setQ} />
        {note}
      </div>
      {adding && <AddEntry types={types} onCancel={() => setAdding(false)} onAdd={async (e) => (await put(e)) && setAdding(false)} />}
      {embed ? (
        rows.length === 0 ? (
          <div className={s.row}>
            <Text variant="small">{entries.length ? 'No keys match.' : 'Empty.'}</Text>
          </div>
        ) : (
          rows.map((e) => (
            <div key={e.key} className={s.row}>
              <Row gap={8}>
                <Text variant="mono" tone="primary" weight={600} breakAnywhere grow>
                  {e.key}
                </Text>
                <IconBtn icon="trash" size="lg" label={`Delete ${e.key}`} onClick={() => onDelete(e)} />
              </Row>
              <ValueEditor type={e.type} value={e.value} label={e.key} onSave={(v) => put({ ...e, value: v })} />
              <Row gap={8}>
                {typeCell(e)}
                {showSize && e.sizeBytes != null && <Text variant="meta">{fmtBytes(e.sizeBytes)}</Text>}
              </Row>
            </div>
          ))
        )
      ) : (
        <Table minWidth={720} label="Entries">
          <thead>
            <tr>
              <th>Key</th>
              <th>{typeLabel}</th>
              <th>Value</th>
              {showSize && <th className={numCell}>Size</th>}
              <th aria-label="Delete" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <TableEmptyRow colSpan={showSize ? 5 : 4}>{entries.length ? 'No keys match.' : 'Empty.'}</TableEmptyRow>}
            {rows.map((e) => (
              <tr key={e.key}>
                <td style={{ maxWidth: 280 }}>
                  <Text variant="mono" tone="primary" weight={600} breakAnywhere>
                    {e.key}
                  </Text>
                </td>
                <td>{typeCell(e)}</td>
                <td style={{ minWidth: 260 }}>
                  <ValueEditor type={e.type} value={e.value} label={e.key} onSave={(v) => put({ ...e, value: v })} />
                </td>
                {showSize && <td className={numCell}>{e.sizeBytes != null ? fmtBytes(e.sizeBytes) : '–'}</td>}
                <td>
                  <IconBtn icon="trash" label={`Delete ${e.key}`} onClick={() => onDelete(e)} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </FlushCard>
  );
}

function AddEntry({ types, onAdd, onCancel }: { types: ValueType[]; onAdd: (e: Entry) => void; onCancel: () => void }) {
  const [e, setE] = useState<Entry>({ key: '', type: types.includes('string') ? 'string' : types[0], value: '' });
  const submit = () => {
    if (!e.key.trim()) return toast('A key is required', 'error');
    onAdd({ ...e, key: e.key.trim(), value: e.type === 'string_set' && !e.value.trim() ? '[]' : e.value });
  };
  return (
    <div className={s.row} style={{ background: 'var(--s2)' }}>
      <Text variant="label">New entry</Text>
      <Row gap={8} wrap>
        <TextInput mono autoFocus placeholder="key" value={e.key} onChange={(x) => setE({ ...e, key: x.target.value })} aria-label="Key" style={{ flex: '1 1 160px' }} />
        <SelectInput value={e.type} aria-label="Type" onChange={(x) => setE({ ...e, type: x.target.value as ValueType, value: x.target.value === 'boolean' || x.target.value === 'bool' ? 'true' : e.value })} style={{ width: 120 }}>
          {types.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </SelectInput>
        <TextInput
          mono
          placeholder={e.type === 'string_set' ? '["a","b"]' : e.type === 'bytes' ? 'base64' : 'value'}
          value={e.value}
          onChange={(x) => setE({ ...e, value: x.target.value })}
          onKeyDown={(x) => x.key === 'Enter' && submit()}
          aria-label="Value"
          style={{ flex: '2 1 200px' }}
        />
        <Button variant="primary" size="sm" onClick={submit}>
          Add
        </Button>
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </Row>
    </div>
  );
}

// ================================================================= prefs --

const PREF_TYPES: PrefType[] = ['string', 'boolean', 'int', 'long', 'float', 'string_set'];

function PrefsView({ file }: { file: string | null }) {
  const files = useAsync((sig) => api.get<PrefFile[]>('prefs', undefined, sig), []);
  useEffect(() => {
    if (!file && files.data?.length) navigate(routePath('storage', 'prefs', files.data[0].name), { replace: true });
  }, [file, files.data]);
  if (files.error) return <LoadError what="prefs" error={files.error} onRetry={files.reload} />;
  if (!files.data) return <EmptyState>Loading preferences…</EmptyState>;
  if (!files.data.length) return <EmptyState title="No shared preferences">The app has not written a SharedPreferences file yet.</EmptyState>;
  return (
    <div className={s.layout}>
      <FlushCard title="Files" hint={plural(files.data.length, 'file')}>
        <nav className={s.list} aria-label="Preference files">
          {files.data.map((f) => (
            <StoreItem key={f.name} icon="key" current={f.name === file} name={f.name} meta={`${fmt(f.entryCount)} · ${fmtBytes(f.sizeBytes)}`} onClick={() => navigate(routePath('storage', 'prefs', f.name), { replace: true })} />
          ))}
        </nav>
      </FlushCard>
      {file && <PrefEntries key={file} file={file} onChanged={files.reload} />}
    </div>
  );
}

function PrefEntries({ file, onChanged }: { file: string; onChanged: () => void }) {
  const entries = useAsync((sig) => api.get<PrefEntry[]>(`prefs/${enc(file)}`, undefined, sig), [file]);
  if (entries.error) return <LoadError what="prefs" error={entries.error} onRetry={entries.reload} />;
  if (!entries.data) return <EmptyState>Loading {file}…</EmptyState>;
  return (
    <EntriesCard
      title={file}
      hint={`${plural(entries.data.length, 'key')} · ${file}.xml`}
      entries={entries.data}
      types={PREF_TYPES}
      onReload={entries.reload}
      onPut={async (e) => {
        try {
          await api.put<PrefEntry>(`prefs/${enc(file)}`, { key: e.key, type: e.type as PrefType, value: e.value });
          entries.reload();
          onChanged();
          return true;
        } catch (x) {
          toast(`Could not save ${e.key}: ${errorMessage(x)}`, 'error');
          return false;
        }
      }}
      onDelete={async (e) => {
        if (!(await confirmDialog({ title: `Delete “${e.key}”?`, message: `Removes the key from ${file}.xml.`, confirmLabel: 'Delete key', danger: true }))) return;
        try {
          await api.del(`prefs/${enc(file)}`, { key: e.key });
          entries.reload();
          onChanged();
        } catch (x) {
          toast(`Could not delete ${e.key}: ${errorMessage(x)}`, 'error');
        }
      }}
    />
  );
}

// ================================================================== mmkv --

const MMKV_TYPES: MmkvValueType[] = ['string', 'bool', 'int', 'long', 'float', 'double', 'bytes'];

function MmkvView({ id }: { id: string | null }) {
  const list = useAsync((sig) => api.get<MmkvInstance[]>('mmkv', undefined, sig), []);
  useEffect(() => {
    if (!id && list.data?.length) navigate(routePath('storage', 'mmkv', (list.data.find((m) => !m.error) ?? list.data[0]).id), { replace: true });
  }, [id, list.data]);
  if (list.error) return <LoadError what="mmkv" error={list.error} onRetry={list.reload} />;
  if (!list.data) return <EmptyState>Loading MMKV…</EmptyState>;
  if (!list.data.length)
    return (
      <EmptyState title="No MMKV instances">
        The default instance appears once the app has called MMKV.initialize(). Register others with Killcam.registerMmkv(id, cryptKey).
      </EmptyState>
    );
  const inst = list.data.find((m) => m.id === id) ?? null;
  return (
    <div className={s.layout}>
      <FlushCard title="Instances" hint={plural(list.data.length, 'instance')}>
        <nav className={s.list} aria-label="MMKV instances">
          {list.data.map((m) => (
            <StoreItem
              key={m.id}
              icon={m.error ? 'warning' : m.encrypted ? 'lock' : 'key'}
              current={m.id === id}
              name={
                <>
                  <span className={s.name}>{m.id}</span>
                  <Text variant="meta" tone={m.error ? 'fail' : 'muted'}>
                    {m.error ? '✕ Could not be opened' : `${plural(m.keyCount, 'key')} · ${fmtBytes(m.sizeBytes)}`}
                  </Text>
                </>
              }
              meta={m.encrypted ? <Badge>Encrypted</Badge> : undefined}
              onClick={() => navigate(routePath('storage', 'mmkv', m.id), { replace: true })}
            />
          ))}
        </nav>
      </FlushCard>
      {inst &&
        (inst.error ? (
          <Banner tone="fail" title={`${inst.id} could not be opened`}>
            {inst.error}
          </Banner>
        ) : (
          <MmkvEntries key={inst.id} inst={inst} onChanged={list.reload} />
        ))}
    </div>
  );
}

function MmkvEntries({ inst, onChanged }: { inst: MmkvInstance; onChanged: () => void }) {
  const entries = useAsync((sig) => api.get<MmkvEntry[]>(`mmkv/${enc(inst.id)}`, undefined, sig), [inst.id]);
  if (entries.error) return <LoadError what="mmkv" error={entries.error} onRetry={entries.reload} />;
  if (!entries.data) return <EmptyState>Loading {inst.id}…</EmptyState>;
  return (
    <EntriesCard
      title={inst.id}
      hint={`${plural(entries.data.length, 'key')}${inst.encrypted ? ' · encrypted' : ''}`}
      entries={entries.data}
      types={MMKV_TYPES}
      typeLabel="Type (inferred)"
      typeEditable
      showSize
      note={
        <Text variant="small" tone="muted">
          MMKV stores raw bytes, so each type is inferred from the stored size and content. Pick the right one when editing: it decides how the value is written.
        </Text>
      }
      onReload={entries.reload}
      onPut={async (e) => {
        try {
          await api.put<MmkvEntry>(`mmkv/${enc(inst.id)}`, { key: e.key, type: e.type, value: e.type === 'bytes' ? e.value.trim() : e.value });
          entries.reload();
          onChanged();
          return true;
        } catch (x) {
          toast(`Could not save ${e.key}: ${errorMessage(x)}`, 'error');
          return false;
        }
      }}
      onDelete={async (e) => {
        if (!(await confirmDialog({ title: `Delete “${e.key}”?`, message: `Removes the key from ${inst.id}.`, confirmLabel: 'Delete key', danger: true }))) return;
        try {
          await api.del(`mmkv/${enc(inst.id)}`, { key: e.key });
          entries.reload();
          onChanged();
        } catch (x) {
          toast(`Could not delete ${e.key}: ${errorMessage(x)}`, 'error');
        }
      }}
    />
  );
}

// ============================================================ databases --

function DbView({ db, table }: { db: string | null; table: string | null }) {
  const dbs = useAsync((sig) => api.get<DbInfo[]>('db', undefined, sig), []);
  const [mode, setMode] = useState<'browse' | 'sql'>('browse');
  useEffect(() => {
    if (!db && dbs.data?.length) {
      const first = dbs.data[0];
      navigate(routePath('storage', 'db', first.name, (first.tables.find((t) => t.type === 'table') ?? first.tables[0])?.name), { replace: true });
    }
  }, [db, dbs.data]);
  if (dbs.error) return <LoadError what="databases" error={dbs.error} onRetry={dbs.reload} />;
  if (!dbs.data) return <EmptyState>Loading databases…</EmptyState>;
  if (!dbs.data.length) return <EmptyState title="No SQLite databases">The app has not created a database yet.</EmptyState>;
  const info = dbs.data.find((d) => d.name === db) ?? null;
  return (
    <div className={s.layout}>
      <FlushCard title="Databases" hint={plural(dbs.data.length, 'database')}>
        <nav className={s.list} aria-label="Databases and tables">
          {dbs.data.map((d) => (
            <div key={d.name}>
              <div className={s.groupHead}>
                <Row gap={8}>
                  <Text variant="mono" tone="primary" weight={600} truncate grow title={d.path}>
                    {d.name}
                  </Text>
                  <Text variant="meta">{fmtBytes(d.sizeBytes)}</Text>
                </Row>
              </div>
              {d.tables.map((t) => (
                <StoreItem
                  key={t.name}
                  sub
                  icon={t.type === 'view' ? 'eye' : 'table'}
                  current={d.name === db && t.name === table && mode === 'browse'}
                  name={t.name}
                  meta={t.rowCount != null ? plural(t.rowCount, 'row') : 'view'}
                  onClick={() => {
                    setMode('browse');
                    navigate(routePath('storage', 'db', d.name, t.name), { replace: true });
                  }}
                />
              ))}
            </div>
          ))}
        </nav>
      </FlushCard>
      {info && (
        <Stack gap={14}>
          <Row gap={10} wrap>
            <Text variant="heading-sm">{info.name}</Text>
            <Spacer />
            <Segmented<'browse' | 'sql'>
              label="Mode"
              value={table ? mode : 'sql'}
              onChange={setMode}
              options={[
                { value: 'browse', label: 'Browse a table' },
                { value: 'sql', label: 'Run SQL' },
              ]}
            />
          </Row>
          {table && mode === 'browse' ? (
            <TableBrowser key={`${info.name}/${table}`} db={info.name} table={table} />
          ) : (
            <SqlConsole key={info.name} db={info.name} initial={`SELECT * FROM ${table ?? info.tables[0]?.name ?? 'sqlite_master'} LIMIT 50;`} />
          )}
        </Stack>
      )}
    </div>
  );
}

const PAGE = 50;

function TableBrowser({ db, table }: { db: string; table: string }) {
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const res = useAsync(
    (sig) => api.get<QueryResult>(`db/${enc(db)}/tables/${enc(table)}`, { offset, limit: PAGE, orderBy: sort?.key, desc: sort ? sort.dir === 'desc' : undefined }, sig),
    [db, table, offset, sort?.key, sort?.dir],
  );
  const r = res.data;
  const total = r?.totalRows ?? null;
  const pages = total != null ? Math.max(1, Math.ceil(total / PAGE)) : null;
  const page = Math.floor(offset / PAGE) + 1;
  if (res.error) return <LoadError what="databases" error={res.error} onRetry={res.reload} />;
  return (
    <FlushCard
      title={table}
      hint={r ? `${total != null ? plural(total, 'row') : ''} · read in ${fmt(r.elapsedMs)} ms` : 'Loading…'}
      aside={
        <Row gap={4}>
          <IconBtn icon="skip-back" size="sm" outlined label="First page" disabled={offset === 0} onClick={() => setOffset(0)} />
          <IconBtn icon="back" size="sm" outlined label="Previous page" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} />
          <Text variant="small" nowrap>
            Page {fmt(page)}
            {pages ? ` of ${fmt(pages)}` : ''}
          </Text>
          <IconBtn icon="chevron-right" size="sm" outlined label="Next page" disabled={pages != null ? page >= pages : (r?.rows.length ?? 0) < PAGE} onClick={() => setOffset(offset + PAGE)} />
          <IconBtn icon="skip-fwd" size="sm" outlined label="Last page" disabled={pages == null || page >= pages} onClick={() => pages && setOffset((pages - 1) * PAGE)} />
          <IconBtn icon="refresh" size="sm" outlined label="Reload" onClick={res.reload} />
        </Row>
      }
    >
      {!r ? (
        <div style={{ padding: 24 }}>
          <Text variant="small">Loading…</Text>
        </div>
      ) : r.error ? (
        <div style={{ padding: 16 }}>
          <Banner tone="fail" title="The query failed">
            <Text variant="mono">{r.error}</Text>
          </Banner>
        </div>
      ) : (
        <ResultTable
          result={r}
          rowOffset={offset}
          sort={sort}
          onSort={(col) => {
            setOffset(0);
            setSort((x) => (x?.key === col ? (x.dir === 'asc' ? { key: col, dir: 'desc' } : null) : { key: col, dir: 'asc' }));
          }}
        />
      )}
    </FlushCard>
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
    <Stack gap={14}>
      <TextAreaField
        label="SQL"
        rows={4}
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void run();
          }
        }}
        style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
        footer={
          <>
            <Button variant="primary" size="sm" onClick={run} disabled={running}>
              {running ? 'Running…' : 'Run'}
            </Button>
            <Kbd>⌘ Enter</Kbd>
            <Spacer />
            {result && !result.error && (
              <Text variant="meta">
                {result.affectedRows != null ? `${plural(result.affectedRows, 'row')} changed` : plural(result.rows.length, 'row')}
                {result.truncated ? ' (cut short by the device)' : ''} · {fmt(result.elapsedMs)} ms
              </Text>
            )}
          </>
        }
      />
      {failure ? (
        isUnavailable(failure) ? (
          <LoadError what="databases" error={failure} />
        ) : (
          <Banner tone="fail" title="Could not run the query">
            {errorMessage(failure)}
          </Banner>
        )
      ) : result?.error ? (
        <Banner tone="fail" title="The query failed">
          <Text variant="mono">{result.error}</Text>
        </Banner>
      ) : result && result.columns.length ? (
        <FlushCard title="Result" hint={plural(result.rows.length, 'row')}>
          <ResultTable result={result} rowOffset={0} />
        </FlushCard>
      ) : result ? (
        <Banner tone="pass" title="The statement ran">
          {result.affectedRows != null ? `${plural(result.affectedRows, 'row')} changed.` : 'No rows came back.'}
        </Banner>
      ) : (
        <Text variant="small" tone="muted">
          Runs against {db} on the device. INSERT, UPDATE and DELETE report how many rows they changed.
        </Text>
      )}
    </Stack>
  );
}

function ResultTable({ result, rowOffset, sort, onSort }: { result: QueryResult; rowOffset: number; sort?: { key: string; dir: 'asc' | 'desc' } | null; onSort?: (col: string) => void }) {
  const [cell, setCell] = useState<{ col: string; value: Cell } | null>(null);
  return (
    <>
      <Table minWidth={Math.max(480, result.columns.length * 130)} density="dense" stickyHeader label="Rows">
        <thead>
          <tr>
            <th className={numCell}>#</th>
            {result.columns.map((c) =>
              onSort ? <SortTh key={c} label={c} sortKey={c} sort={sort ?? { key: '', dir: 'asc' }} onSort={onSort} /> : <th key={c}>{c}</th>,
            )}
          </tr>
        </thead>
        <tbody>
          {result.rows.length === 0 && <TableEmptyRow colSpan={result.columns.length + 1}>No rows.</TableEmptyRow>}
          {result.rows.map((row, i) => (
            <tr key={i}>
              <td className={numCell}>
                <Text variant="meta">{fmt(rowOffset + i + 1)}</Text>
              </td>
              {row.map((v, j) => (
                <td key={j} className={typeof v === 'number' ? numCell : undefined}>
                  <span
                    className={v === null ? `${s.cell} ${s.null}` : s.cell}
                    title={looksLikeEpochMs(v) ? fmtDateTime(v, true) : typeof v === 'string' && v.length > 40 ? 'Open the full value' : undefined}
                    onClick={() => setCell({ col: result.columns[j], value: v })}
                  >
                    {v === null ? 'NULL' : String(v)}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
      {result.truncated && (
        <div style={{ padding: 12 }}>
          <Text variant="small" tone="muted">
            ! The device cut the result short.
          </Text>
        </div>
      )}
      {cell && (
        <KDialog open onClose={() => setCell(null)} title={cell.col} subtitle={looksLikeEpochMs(cell.value) ? `${fmtDateTime(cell.value, true)} (epoch milliseconds)` : undefined} width={640}>
          {(() => {
            const text = cell.value === null ? 'NULL' : String(cell.value);
            const json = typeof cell.value === 'string' ? tryParseJson(cell.value) : undefined;
            return json !== undefined ? (
              <JsonBlock value={json} label="Value · JSON" expandDepth={3} />
            ) : (
              <ConsoleBlock label="Value" copy={text}>
                <ConsolePre>{text}</ConsolePre>
              </ConsoleBlock>
            );
          })()}
        </KDialog>
      )}
    </>
  );
}

// ================================================================ files --

function FilesView({ root, path }: { root: string | null; path: string }) {
  const embed = useStore(appStore, (x) => x.embed);
  const roots = useAsync((sig) => api.get<FileRoot[]>('files/roots', undefined, sig), []);
  const list = useAsync((sig) => (root ? api.get<FileEntry[]>('files', { root, path }, sig) : Promise.resolve([] as FileEntry[])), [root, path]);
  const [open, setOpen] = useState<FileEntry | null>(null);
  useEffect(() => {
    if (!root && roots.data?.length) navigate(routePath('storage', 'files', roots.data[0].id), { replace: true });
  }, [root, roots.data]);
  useEffect(() => setOpen(null), [root, path]);
  if (roots.error) return <LoadError what="files" error={roots.error} onRetry={roots.reload} />;
  if (!roots.data) return <EmptyState>Loading files…</EmptyState>;
  if (!roots.data.length) return <EmptyState title="No folders shared">The app shares no folder with Killcam.</EmptyState>;
  const rootInfo = roots.data.find((r) => r.id === root) ?? null;
  const segs = path.split('/').filter(Boolean);
  const go = (p: string) => navigate(routePath('storage', 'files', root, ...p.split('/').filter(Boolean)));
  const remove = async (f: FileEntry) => {
    const ok = await confirmDialog({ title: `Delete “${f.name}”?`, message: f.dir ? 'Deletes the folder and everything in it, on the device.' : 'Deletes the file on the device.', confirmLabel: f.dir ? 'Delete folder' : 'Delete file', danger: true });
    if (!ok) return;
    try {
      await api.del('files', { root, path: f.path });
      if (open?.path === f.path) setOpen(null);
      list.reload();
      toast(`Deleted ${f.name}`, 'ok');
    } catch (e) {
      toast(`Could not delete ${f.name}: ${errorMessage(e)}`, 'error');
    }
  };
  const download = (f: FileEntry) => {
    const a = document.createElement('a');
    a.href = apiUrl('files/content', { root, path: f.path, download: 1 });
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  return (
    <Stack gap={14}>
      <Row gap={10} wrap>
        <SelectField label="Folder" value={root ?? ''} options={roots.data.map((r) => ({ value: r.id, label: r.label }))} onChange={(v) => navigate(routePath('storage', 'files', v))} />
        <nav className={s.crumbs} aria-label="Path">
          <Button variant="quiet" onClick={() => go('')} title={rootInfo?.path}>
            {rootInfo?.path ?? root}
          </Button>
          {segs.map((sg, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center' }}>
              <span className={s.sep}>/</span>
              <Button variant="quiet" onClick={() => go(segs.slice(0, i + 1).join('/'))}>
                {sg}
              </Button>
            </span>
          ))}
        </nav>
        <Spacer />
        <IconBtn icon="refresh" outlined label="Reload" onClick={list.reload} />
      </Row>
      {list.error ? (
        <LoadError what="files" error={list.error} onRetry={list.reload} />
      ) : (
        <FlushCard>
          <Table minWidth={embed ? 320 : 640} label="Files">
            <thead>
              <tr>
                <th>Name</th>
                <th className={numCell}>Size</th>
                {!embed && <th>Modified</th>}
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {segs.length > 0 && (
                <tr onClick={() => go(segs.slice(0, -1).join('/'))} style={{ cursor: 'pointer' }}>
                  <td colSpan={embed ? 3 : 4}>
                    <Row gap={8}>
                      <KIcon name="back" size={14} />
                      <Text variant="mono">..</Text>
                    </Row>
                  </td>
                </tr>
              )}
              {!list.data ? (
                <TableEmptyRow colSpan={embed ? 3 : 4}>Loading…</TableEmptyRow>
              ) : list.data.length === 0 ? (
                <TableEmptyRow colSpan={embed ? 3 : 4}>This folder is empty.</TableEmptyRow>
              ) : (
                list.data.map((f) => (
                  <tr key={f.path} aria-current={open?.path === f.path || undefined} onClick={() => (f.dir ? go(f.path) : setOpen(f))} style={{ cursor: 'pointer' }}>
                    <td style={{ maxWidth: 360 }}>
                      <Row gap={8}>
                        <KIcon name={f.dir ? 'folder' : 'file'} size={14} />
                        <Text variant="mono" tone="primary" truncate>
                          {f.name}
                        </Text>
                      </Row>
                    </td>
                    <td className={numCell}>{f.dir ? '–' : fmtBytes(f.size)}</td>
                    {!embed && (
                      <td>
                        <Text variant="small" nowrap>
                          {fmtDateTime(f.modifiedMs)}
                        </Text>
                      </td>
                    )}
                    <td onClick={(e) => e.stopPropagation()}>
                      <Row gap={4}>
                        {!f.dir && !embed && (
                          <Button variant="mini" onClick={() => download(f)}>
                            Download
                          </Button>
                        )}
                        <IconBtn icon="trash" size={embed ? 'lg' : 'md'} label={`Delete ${f.name}`} onClick={() => void remove(f)} />
                      </Row>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </FlushCard>
      )}
      {open && root && <FileViewer key={open.path} root={root} file={open} onClose={() => setOpen(null)} onDelete={() => void remove(open)} onDownload={embed ? undefined : () => download(open)} />}
    </Stack>
  );
}

const TEXT_EXT = /\.(txt|log|json|xml|md|csv|html?|js|css|properties|ya?ml|ini|conf|pem|lock|journal)$/i;

function FileViewer({ root, file, onClose, onDelete, onDownload }: { root: string; file: FileEntry; onClose: () => void; onDelete: () => void; onDownload?: () => void }) {
  const [force, setForce] = useState(false);
  const tooBig = file.size > 1024 * 1024 && !force;
  const content = useAsync((sig) => (tooBig ? Promise.resolve(null) : api.bytes('files/content', { root, path: file.path }, sig)), [root, file.path, tooBig]);
  const decoded = useMemo(() => {
    if (!content.data) return null;
    const bytes = new Uint8Array(content.data);
    if (bytes.subarray(0, 8192).includes(0) && !TEXT_EXT.test(file.name)) return { binary: true as const, text: hexDump(bytes, 512) };
    return { binary: false as const, text: new TextDecoder().decode(bytes) };
  }, [content.data, file.name]);
  const json = decoded && !decoded.binary ? tryParseJson(decoded.text) : undefined;
  return (
    <Dock
      label="File"
      title={file.name}
      subtitle={`${fmtBytes(file.size)} · modified ${fmtDateTime(file.modifiedMs, true)}`}
      closeOnBack
      onClose={onClose}
      actions={
        <>
          {onDownload && (
            <Button variant="mini" onClick={onDownload}>
              Download
            </Button>
          )}
          <IconBtn icon="trash" label="Delete file" onClick={onDelete} />
        </>
      }
    >
      <Text variant="mono" breakAnywhere>
        {file.path}
      </Text>
      {tooBig ? (
        <EmptyState title={`A large file: ${fmtBytes(file.size)}`} actions={<Button variant="outline" onClick={() => setForce(true)}>Load it anyway</Button>} />
      ) : content.error ? (
        <LoadError what="files" error={content.error} onRetry={content.reload} />
      ) : !decoded ? (
        <Text variant="small">Loading…</Text>
      ) : decoded.binary ? (
        <ConsoleBlock label={`Binary · first ${fmt(Math.min(512, file.size))} bytes`}>
          <ConsolePre>{decoded.text}</ConsolePre>
        </ConsoleBlock>
      ) : json !== undefined ? (
        <JsonBlock value={json} label={`${file.name} · JSON`} />
      ) : (
        <ConsoleBlock label={file.name} copy={decoded.text}>
          <ConsolePre>{decoded.text || '(empty file)'}</ConsolePre>
        </ConsoleBlock>
      )}
    </Dock>
  );
}

