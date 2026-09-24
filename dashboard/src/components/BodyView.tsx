import { useMemo, useState } from 'react';
import type { HttpBody } from '../api/types';
import { fmtBytes } from '../lib/format';
import { JsonTree, tryParseJson } from './JsonTree';
import { CopyButton, IconButton, Segmented } from './ui';

function hexDump(b64: string, max = 512): string {
  let bin: string;
  try {
    bin = atob(b64.slice(0, Math.ceil((max * 4) / 3) + 4));
  } catch {
    return '(invalid base64)';
  }
  const lines: string[] = [];
  for (let off = 0; off < Math.min(bin.length, max); off += 16) {
    const chunk = bin.slice(off, off + 16);
    const hex = [...chunk].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
    const ascii = [...chunk].map((c) => (c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127 ? c : '.')).join('');
    lines.push(`${off.toString(16).padStart(6, '0')}  ${hex.padEnd(47)}  ${ascii}`);
  }
  return lines.join('\n');
}

export function BodyView({ body, label }: { body: HttpBody | null; label: string }) {
  const [mode, setMode] = useState<'tree' | 'raw'>('tree');
  const [depth, setDepth] = useState({ d: 2, n: 0 });
  const json = useMemo(() => tryParseJson(body?.text, body?.contentType), [body]);
  if (!body || (body.size === 0 && !body.text && !body.base64)) {
    return <div className="body-empty">No {label.toLowerCase()} body</div>;
  }
  const type = body.contentType ?? 'unknown';
  const isImage = !!body.base64 && type.startsWith('image/');
  const isJson = json !== undefined;
  const pretty = isJson ? JSON.stringify(json, null, 2) : null;
  const copyValue = body.text ?? body.base64 ?? '';
  return (
    <div className="hbody">
      <div className="hbody-bar">
        <span className="hbody-type mono">{type}</span>
        <span className="muted mono">{fmtBytes(body.size)}</span>
        {body.base64 && !isImage && <span className="badge">binary</span>}
        <span className="grow" />
        {isJson && mode === 'tree' && (
          <>
            <IconButton icon="expand" label="Expand all" onClick={() => setDepth((d) => ({ d: 99, n: d.n + 1 }))} />
            <IconButton icon="collapse" label="Collapse all" onClick={() => setDepth((d) => ({ d: 1, n: d.n + 1 }))} />
          </>
        )}
        {isJson && (
          <Segmented
            size="sm"
            label="Body view"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'tree', label: 'Tree' },
              { value: 'raw', label: 'Raw' },
            ]}
          />
        )}
        {!isImage && <CopyButton text={mode === 'tree' && pretty ? pretty : copyValue} label={`Copy ${label.toLowerCase()} body`} />}
      </div>
      {body.truncated && (
        <div className="notice notice-warn">
          Truncated: showing the first {fmtBytes((body.text ?? body.base64 ?? '').length)} of {fmtBytes(body.size)}. The device
          caps captured bodies.
        </div>
      )}
      <div className="hbody-content">
        {isImage ? (
          <div className="img-preview">
            <img alt={`${label} body`} src={`data:${type};base64,${body.base64}`} />
          </div>
        ) : isJson && mode === 'tree' ? (
          <JsonTree key={depth.n} value={json} expandDepth={depth.d} />
        ) : body.text != null ? (
          <pre className="raw mono">{body.text}</pre>
        ) : body.base64 != null ? (
          <pre className="raw mono muted">{hexDump(body.base64)}</pre>
        ) : null}
      </div>
    </div>
  );
}
