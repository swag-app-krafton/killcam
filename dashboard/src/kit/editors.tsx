import { useEffect, useState, type ReactNode } from 'react';
import { Button, ChipButton, Row, Stack, StatusPill, Switch, Text } from '@/design';
import type { Header } from '../api/types';
import { fmtDateTime, looksLikeEpochMs } from '../lib/format';
import { tryParseJson, b64Bytes, hexDump } from './console';
import { IconBtn, SelectInput, TextArea, TextInput } from './controls';
import { KDialog } from './overlays';
import e from './editors.module.css';

/** Name/value rows (a response's headers): edit in place, add, remove. */
export function KeyValueEditor({
  rows,
  onChange,
  addLabel = 'Add',
  namePlaceholder = 'name',
  valuePlaceholder = 'value',
}: {
  rows: Header[];
  onChange: (rows: Header[]) => void;
  addLabel?: string;
  namePlaceholder?: string;
  valuePlaceholder?: string;
}) {
  const set = (i: number, p: Partial<Header>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <div className={e.kv}>
      {rows.map((r, i) => (
        <div key={i} className={e.kvRow}>
          <TextInput mono value={r.name} placeholder={namePlaceholder} onChange={(x) => set(i, { name: x.target.value })} aria-label={`Name ${i + 1}`} />
          <TextInput mono value={r.value} placeholder={valuePlaceholder} onChange={(x) => set(i, { value: x.target.value })} aria-label={`Value ${i + 1}`} />
          <IconBtn icon="x" label={`Remove ${r.name || 'row'}`} onClick={() => onChange(rows.filter((_, j) => j !== i))} />
        </div>
      ))}
      <Row>
        <ChipButton onClick={() => onChange([...rows, { name: '', value: '' }])}>+ {addLabel}</ChipButton>
      </Row>
    </div>
  );
}

/** Every typed value Killcam edits: flags, shared preferences and MMKV. */
export type ValueType = 'boolean' | 'bool' | 'int' | 'long' | 'float' | 'double' | 'string' | 'string_set' | 'json' | 'bytes';

export function validateValue(type: ValueType, v: string): string | null {
  if ((type === 'boolean' || type === 'bool') && v !== 'true' && v !== 'false') return 'expected true or false';
  if ((type === 'int' || type === 'long') && !/^-?\d+$/.test(v.trim())) return 'expected a whole number';
  if ((type === 'float' || type === 'double') && (v.trim() === '' || Number.isNaN(Number(v)))) return 'expected a number';
  if (type === 'json' && tryParseJson(v, 'application/json') === undefined) return 'not valid JSON';
  if (type === 'string_set') {
    const a = tryParseJson(v, 'application/json');
    if (!Array.isArray(a) || a.some((x) => typeof x !== 'string')) return 'expected a JSON array of strings';
  }
  if (type === 'bytes' && !/^[A-Za-z0-9+/]*={0,2}$/.test(v.trim())) return 'expected base64';
  return null;
}

/** Edit one typed value in place: a switch for booleans, a select when there
 *  are options, a field for numbers and text, a dialog for JSON, sets and bytes.
 *  `onSave` resolves false when the device refused the value. */
export function ValueEditor({ type, value, onSave, options, label }: { type: ValueType; value: string; onSave: (v: string) => Promise<boolean>; options?: string[] | null; label: string }) {
  const [draft, setDraft] = useState(value);
  const [dialog, setDialog] = useState(false);
  useEffect(() => setDraft(value), [value]);
  if (type === 'boolean' || type === 'bool') {
    return (
      <span aria-label={label}>
        <Switch checked={value === 'true'} onChange={(on) => void onSave(String(on))} label={value} />
      </span>
    );
  }
  if (options?.length) {
    return (
      <SelectInput value={value} onChange={(x) => void onSave(x.target.value)} aria-label={label} style={{ maxWidth: 260 }}>
        {!options.includes(value) && <option value={value}>{value}</option>}
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </SelectInput>
    );
  }
  if (type === 'json' || type === 'string_set' || type === 'bytes') {
    const shown = type === 'string_set' ? ((tryParseJson(value, 'application/json') as string[] | undefined) ?? []).join(', ') || 'empty set' : value || 'empty';
    return (
      <>
        <Button variant="outline" onClick={() => setDialog(true)} title={`Edit ${label}`} style={{ maxWidth: '100%' }}>
          <span className={e.clip}>{shown}</span>
        </Button>
        {dialog && <ValueDialog type={type} value={value} label={label} onClose={() => setDialog(false)} onSave={onSave} />}
      </>
    );
  }
  const err = draft !== value ? validateValue(type, draft) : null;
  const commit = async () => {
    if (draft === value) return;
    if (validateValue(type, draft) || !(await onSave(type === 'string' ? draft : draft.trim()))) setDraft(value);
  };
  const numeric = type !== 'string';
  const long = !numeric && (value.length > 80 || value.includes('\n'));
  const epoch = type === 'long' && looksLikeEpochMs(Number(value)) ? fmtDateTime(Number(value), true) : null;
  return (
    <span className={e.value}>
      {long ? (
        <TextArea mono value={draft} rows={Math.min(6, Math.max(2, Math.ceil(value.length / 70)))} aria-label={label} onChange={(x) => setDraft(x.target.value)} onBlur={commit} />
      ) : (
        <TextInput
          mono
          value={draft}
          invalid={!!err}
          aria-label={label}
          inputMode={numeric ? (type === 'int' || type === 'long' ? 'numeric' : 'decimal') : undefined}
          onChange={(x) => setDraft(x.target.value)}
          onBlur={commit}
          onKeyDown={(x) => {
            if (x.key === 'Enter') (x.target as HTMLInputElement).blur();
            if (x.key === 'Escape') setDraft(value);
          }}
        />
      )}
      {err ? (
        <Text variant="caption" tone="fail">
          ✕ {err}
        </Text>
      ) : (
        epoch && <Text variant="caption">{epoch}</Text>
      )}
    </span>
  );
}

function ValueDialog({ type, value, label, onClose, onSave }: { type: 'json' | 'string_set' | 'bytes'; value: string; label: string; onClose: () => void; onSave: (v: string) => Promise<boolean> }) {
  const initial =
    type === 'json'
      ? (() => {
          const v = tryParseJson(value, 'application/json');
          return v === undefined ? value : JSON.stringify(v, null, 2);
        })()
      : type === 'string_set'
        ? ((tryParseJson(value, 'application/json') as string[] | undefined) ?? []).join('\n')
        : value;
  const [text, setText] = useState(initial);
  const out = type === 'string_set' ? JSON.stringify([...new Set(text.split('\n').map((x) => x.trim()).filter(Boolean))]) : type === 'bytes' ? text.replace(/\s+/g, '') : text;
  const err = validateValue(type, type === 'json' ? text : out);
  const bytes = type === 'bytes' && !err ? b64Bytes(out, 1 << 20) : null;
  let status: ReactNode;
  if (err) status = <StatusPill tone="fail">{err}</StatusPill>;
  else if (type === 'json') status = <StatusPill tone="pass">Valid JSON</StatusPill>;
  else if (type === 'string_set') status = <StatusPill tone="pass">{JSON.parse(out).length} values</StatusPill>;
  else status = <StatusPill tone="pass">{bytes?.length ?? 0} bytes</StatusPill>;
  return (
    <KDialog open onClose={onClose} title={`Edit ${label}`} subtitle={type === 'string_set' ? 'One value per line; duplicates are dropped (it is a set).' : type === 'bytes' ? 'Base64.' : 'JSON.'} width={640}>
      <Stack gap={14}>
        <TextArea mono rows={type === 'bytes' ? 5 : 12} value={text} onChange={(x) => setText(x.target.value)} aria-label={label} invalid={!!err} />
        {bytes && bytes.length > 0 && <pre className={e.hex}>{hexDump(bytes, 256)}</pre>}
        <Row gap={8} wrap>
          {status}
          <span style={{ flex: 1 }} />
          {type === 'json' && (
            <Button variant="secondary" size="sm" disabled={!!err} onClick={() => setText(JSON.stringify(JSON.parse(text), null, 2))}>
              Format
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!!err}
            onClick={async () => {
              const v = type === 'json' ? JSON.stringify(JSON.parse(text)) : out;
              if (await onSave(v)) onClose();
            }}
          >
            Save
          </Button>
        </Row>
      </Stack>
    </KDialog>
  );
}
