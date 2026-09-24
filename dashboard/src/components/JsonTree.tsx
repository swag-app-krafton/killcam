import { useState } from 'react';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const CHUNK = 200;

/** Collapsible JSON viewer. Children render lazily, big arrays/objects in chunks. */
export function JsonTree({ value, expandDepth = 2 }: { value: unknown; expandDepth?: number }) {
  return (
    <div className="jt mono" role="tree">
      <Node name={null} value={value as Json} depth={0} expandDepth={expandDepth} last />
    </div>
  );
}

function Node({
  name,
  value,
  depth,
  expandDepth,
  last,
}: {
  name: string | number | null;
  value: Json;
  depth: number;
  expandDepth: number;
  last: boolean;
}) {
  const isObj = value !== null && typeof value === 'object';
  const [open, setOpen] = useState(depth < expandDepth);
  const [limit, setLimit] = useState(CHUNK);
  const pad = { paddingLeft: depth * 14 + 14 };
  const key =
    name === null ? null : typeof name === 'number' ? (
      <span className="jt-idx">{name}: </span>
    ) : (
      <span className="jt-key">
        {JSON.stringify(name)}
        <span className="jt-punct">: </span>
      </span>
    );
  const comma = last ? null : <span className="jt-punct">,</span>;

  if (!isObj) {
    return (
      <div className="jt-row" style={pad} role="treeitem">
        {key}
        <Prim value={value} />
        {comma}
      </div>
    );
  }
  const isArr = Array.isArray(value);
  const entries: [string | number, Json][] = isArr
    ? (value as Json[]).map((v, i) => [i, v])
    : Object.entries(value as Record<string, Json>);
  const [ob, cb] = isArr ? ['[', ']'] : ['{', '}'];
  if (entries.length === 0) {
    return (
      <div className="jt-row" style={pad} role="treeitem">
        {key}
        <span className="jt-punct">
          {ob}
          {cb}
        </span>
        {comma}
      </div>
    );
  }
  return (
    <>
      <div
        className="jt-row jt-toggle"
        style={pad}
        role="treeitem"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className={open ? 'jt-caret open' : 'jt-caret'} aria-hidden>
          ▸
        </span>
        {key}
        <span className="jt-punct">{ob}</span>
        {!open && (
          <>
            <span className="jt-summary">
              {' '}
              {entries.length} {isArr ? (entries.length === 1 ? 'item' : 'items') : entries.length === 1 ? 'key' : 'keys'}{' '}
            </span>
            <span className="jt-punct">{cb}</span>
            {comma}
          </>
        )}
      </div>
      {open && (
        <>
          {entries.slice(0, limit).map(([k, v], i) => (
            <Node
              key={k}
              name={k}
              value={v}
              depth={depth + 1}
              expandDepth={expandDepth}
              last={i === entries.length - 1}
            />
          ))}
          {entries.length > limit && (
            <div className="jt-row" style={{ paddingLeft: (depth + 1) * 14 + 14 }}>
              <button className="link-btn" onClick={() => setLimit(limit + CHUNK * 5)}>
                Show {Math.min(CHUNK * 5, entries.length - limit)} more of {entries.length - limit} remaining
              </button>
            </div>
          )}
          <div className="jt-row" style={pad}>
            <span className="jt-punct">{cb}</span>
            {comma}
          </div>
        </>
      )}
    </>
  );
}

function Prim({ value }: { value: Json }) {
  if (value === null) return <span className="jt-null">null</span>;
  if (typeof value === 'string') return <span className="jt-str">{JSON.stringify(value)}</span>;
  if (typeof value === 'number') return <span className="jt-num">{String(value)}</span>;
  return <span className="jt-bool">{String(value)}</span>;
}

/** Parse text as JSON if it plausibly is; returns undefined otherwise. */
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
