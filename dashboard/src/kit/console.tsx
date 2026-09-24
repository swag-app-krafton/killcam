import { memo, useMemo, useState, type ReactNode } from 'react';
// Class names only: Killcam's console blocks wear the design system's CodeBlock chrome.
import cb from '@/design/components/CodeBlock.module.css';
import { Icon, Text } from '@/design';
import type { HttpBody } from '../api/types';
import { copyText } from '../lib/clipboard';
import { fmtBytes } from '../lib/format';
import { toast } from '../state/ui';
import c from './console.module.css';

/** A CodeBlock-style frame (dark in both themes) around any console content:
 *  a header with the label, extra actions and Copy, and a collapsible body. */
export function ConsoleBlock({
  label,
  actions,
  copy,
  children,
  defaultOpen = true,
  note,
}: {
  label: ReactNode;
  actions?: ReactNode;
  copy?: string | (() => string);
  children: ReactNode;
  defaultOpen?: boolean;
  note?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`${cb.block} ${c.root}`}>
      <div className={cb.head}>
        <button type="button" className={cb.toggle} aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
          {label}
        </button>
        <span className={c.actions}>
          {open && actions}
          {copy != null && <ConsoleCopy text={copy} />}
        </span>
      </div>
      {open && note && <div className={c.note}>{note}</div>}
      {open && <div className={c.body}>{children}</div>}
    </div>
  );
}

export function ConsoleCopy({ text }: { text: string | (() => string) }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={cb.copy}
      onClick={async () => {
        if (await copyText(typeof text === 'function' ? text() : text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } else toast('Could not copy', 'error');
      }}
    >
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

/** A small toggle on the console header (Tree / Raw). */
export function ConsoleToggle({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={c.btn} aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  );
}

export function ConsolePre({ children }: { children: ReactNode }) {
  return <pre className={c.pre}>{children}</pre>;
}

// ------------------------------------------------------------ JSON tree --

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
const CHUNK = 200;

/** Collapsible JSON: children render lazily, long arrays in chunks. */
export function JsonTree({ value, expandDepth = 2 }: { value: unknown; expandDepth?: number }) {
  return (
    <div className={c.pad} role="tree">
      <JsonNode name={null} value={value as Json} depth={0} expandDepth={expandDepth} last />
    </div>
  );
}

function JsonNode({ name, value, depth, expandDepth, last }: { name: string | number | null; value: Json; depth: number; expandDepth: number; last: boolean }) {
  const [open, setOpen] = useState(depth < expandDepth);
  const [limit, setLimit] = useState(CHUNK);
  const pad = { paddingLeft: depth * 14 + 14 };
  const key =
    name === null ? null : typeof name === 'number' ? (
      <span className={c.idx}>{name}: </span>
    ) : (
      <span className={c.key}>
        {JSON.stringify(name)}
        <span className={c.punct}>: </span>
      </span>
    );
  const comma = last ? null : <span className={c.punct}>,</span>;
  if (value === null || typeof value !== 'object') {
    return (
      <div className={c.row} style={pad} role="treeitem">
        {key}
        <Prim value={value} />
        {comma}
      </div>
    );
  }
  const isArr = Array.isArray(value);
  const entries: [string | number, Json][] = isArr ? (value as Json[]).map((v, i) => [i, v]) : Object.entries(value as Record<string, Json>);
  const [ob, cbr] = isArr ? ['[', ']'] : ['{', '}'];
  if (!entries.length) {
    return (
      <div className={c.row} style={pad} role="treeitem">
        {key}
        <span className={c.punct}>
          {ob}
          {cbr}
        </span>
        {comma}
      </div>
    );
  }
  return (
    <>
      <div className={`${c.row} ${c.toggle}`} style={pad} role="treeitem" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={open ? `${c.caret} ${c.open}` : c.caret} aria-hidden>
          ▸
        </span>
        {key}
        <span className={c.punct}>{ob}</span>
        {!open && (
          <>
            <span className={c.summary}>
              {' '}
              {entries.length} {isArr ? (entries.length === 1 ? 'item' : 'items') : entries.length === 1 ? 'key' : 'keys'}{' '}
            </span>
            <span className={c.punct}>{cbr}</span>
            {comma}
          </>
        )}
      </div>
      {open && (
        <>
          {entries.slice(0, limit).map(([k, v], i) => (
            <JsonNode key={k} name={k} value={v} depth={depth + 1} expandDepth={expandDepth} last={i === entries.length - 1} />
          ))}
          {entries.length > limit && (
            <div className={c.row} style={{ paddingLeft: (depth + 1) * 14 + 14 }}>
              <button type="button" className={c.more} onClick={() => setLimit(limit + CHUNK * 5)}>
                Show {Math.min(CHUNK * 5, entries.length - limit)} more of {entries.length - limit}
              </button>
            </div>
          )}
          <div className={c.row} style={pad}>
            <span className={c.punct}>{cbr}</span>
            {comma}
          </div>
        </>
      )}
    </>
  );
}

function Prim({ value }: { value: Json }) {
  if (value === null) return <span className={c.null}>null</span>;
  if (typeof value === 'string') return <span className={c.str}>{JSON.stringify(value)}</span>;
  if (typeof value === 'number') return <span className={c.num}>{String(value)}</span>;
  return <span className={c.bool}>{String(value)}</span>;
}

/** Parse text as JSON when it plausibly is; undefined otherwise. */
export function tryParseJson(text: string | null | undefined, contentType?: string | null): unknown {
  if (text == null) return undefined;
  const t = text.trimStart();
  if (!(contentType?.includes('json') || t.startsWith('{') || t.startsWith('['))) return undefined;
  if (text.length > 4_000_000) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** A JSON value on the console: tree or raw, with Copy. */
export function JsonBlock({ value, label, expandDepth = 2 }: { value: unknown; label: ReactNode; expandDepth?: number }) {
  const [raw, setRaw] = useState(false);
  const pretty = useMemo(() => JSON.stringify(value, null, 2), [value]);
  return (
    <ConsoleBlock
      label={label}
      copy={pretty}
      actions={
        <>
          <ConsoleToggle pressed={!raw} onClick={() => setRaw(false)}>
            Tree
          </ConsoleToggle>
          <ConsoleToggle pressed={raw} onClick={() => setRaw(true)}>
            Raw
          </ConsoleToggle>
        </>
      }
    >
      {raw ? <ConsolePre>{pretty}</ConsolePre> : <JsonTree value={value} expandDepth={expandDepth} />}
    </ConsoleBlock>
  );
}

// ----------------------------------------------------------- HTTP bodies --

function hexDump(bytes: Uint8Array, max = 512): string {
  let out = '';
  for (let off = 0; off < Math.min(bytes.length, max); off += 16) {
    const chunk = [...bytes.subarray(off, off + 16)];
    out += `${off.toString(16).padStart(6, '0')}  ${chunk.map((b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(47)}  ${chunk.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('')}\n`;
  }
  return out;
}

export function b64Bytes(b64: string, max = 4096): Uint8Array {
  try {
    const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
    const n = Math.min(clean.length, Math.ceil(max / 3) * 4);
    const bin = atob(clean.slice(0, n - (n % 4)));
    return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}

export { hexDump };

/** A request or response body: JSON as a tree, text as-is, images previewed,
 *  other binary as a hex dump. Says so when the device truncated it. */
export function BodyBlock({ body, label }: { body: HttpBody | null; label: 'Request' | 'Response' }) {
  const json = useMemo(() => tryParseJson(body?.text, body?.contentType), [body]);
  const [raw, setRaw] = useState(false);
  if (!body || (body.size === 0 && !body.text && !body.base64)) {
    return (
      <Text variant="small" tone="muted">
        No {label.toLowerCase()} body.
      </Text>
    );
  }
  const type = body.contentType ?? 'unknown type';
  const isImage = !!body.base64 && type.startsWith('image/');
  const caption = (
    <>
      {label} body <span className={c.meta}>· {type} · {fmtBytes(body.size)}</span>
    </>
  );
  const note = body.truncated
    ? `Truncated: showing the first ${fmtBytes((body.text ?? body.base64 ?? '').length)} of ${fmtBytes(body.size)}. The device caps captured bodies.`
    : null;
  if (json !== undefined) {
    const pretty = JSON.stringify(json, null, 2);
    return (
      <ConsoleBlock
        label={caption}
        note={note}
        copy={pretty}
        actions={
          <>
            <ConsoleToggle pressed={!raw} onClick={() => setRaw(false)}>
              Tree
            </ConsoleToggle>
            <ConsoleToggle pressed={raw} onClick={() => setRaw(true)}>
              Raw
            </ConsoleToggle>
          </>
        }
      >
        {raw ? <ConsolePre>{body.text}</ConsolePre> : <JsonTree value={json} />}
      </ConsoleBlock>
    );
  }
  if (isImage) {
    return (
      <ConsoleBlock label={caption} note={note}>
        <div className={c.img}>
          <img alt={`${label} body`} src={`data:${type};base64,${body.base64}`} />
        </div>
      </ConsoleBlock>
    );
  }
  if (body.text != null) {
    return (
      <ConsoleBlock label={caption} note={note} copy={body.text}>
        <ConsolePre>{body.text}</ConsolePre>
      </ConsoleBlock>
    );
  }
  return (
    <ConsoleBlock label={caption} note={note}>
      <ConsolePre>{hexDump(b64Bytes(body.base64 ?? ''))}</ConsolePre>
    </ConsoleBlock>
  );
}

// -------------------------------------------------------- stack traces --

const FRAMEWORK = /^(java|javax|jdk|sun|android|androidx|kotlin|kotlinx|dalvik|libcore|com\.android|com\.google\.android|org\.jetbrains|com\.facebook\.react|com\.facebook\.hermes)\./;
const APP = /^com\.swag\./;

/** A Java/Kotlin stack trace: the app's frames (com.swag.*) marked, library
 *  frames plain, platform frames (java., android., kotlin. ...) dimmed. */
export const StackLines = memo(function StackLines({ text }: { text: string }) {
  return (
    <pre className={c.stack} aria-label="Stack trace">
      {text.split('\n').map((line, i) => {
        const at = /^\s*at\s+(.+)$/.exec(line);
        if (at) {
          const frame = at[1];
          const kind = APP.test(frame) ? c.app : FRAMEWORK.test(frame) ? c.framework : c.lib;
          const m = /^(.*)\.([^.(]+)\((.*)\)$/.exec(frame);
          return (
            <span key={i} className={`${c.frame} ${kind}`}>
              {'at '}
              {m ? (
                <>
                  {m[1]}.<span className={c.fn}>{m[2]}</span>
                  <span className={c.loc}>({m[3]})</span>
                </>
              ) : (
                frame
              )}
            </span>
          );
        }
        if (/^\s*\.\.\.\s*\d+\s+more/.test(line)) {
          return (
            <span key={i} className={c.dim}>
              {line.trim()}
            </span>
          );
        }
        const caused = /^(Caused by:|Suppressed:)\s*(.*)$/.exec(line.trim());
        if (caused) {
          return (
            <span key={i} className={c.cause}>
              <b>{caused[1]}</b> {caused[2]}
            </span>
          );
        }
        return (
          <span key={i} className={i === 0 ? c.head : undefined}>
            {line || ' '}
          </span>
        );
      })}
    </pre>
  );
});

export function StackBlock({ text, label = 'Stack trace', defaultOpen = true }: { text: string; label?: ReactNode; defaultOpen?: boolean }) {
  return (
    <ConsoleBlock label={label} copy={text} defaultOpen={defaultOpen}>
      <StackLines text={text} />
    </ConsoleBlock>
  );
}

/** First app frame ("PayFlowViewModel.kt:212"), to name the culprit. */
export function blamedFrame(stack: string): string | null {
  const m = /at\s+com\.swag\.[\w.$]+\(([^)]+)\)/.exec(stack);
  return m ? m[1] : null;
}
