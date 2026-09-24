import type { NetworkSummary } from '../api/types';
import { statusClass } from '../lib/format';

export function StatusPill({ call }: { call: Pick<NetworkSummary, 'state' | 'status' | 'error'> }) {
  const k = statusClass(call);
  const label = k === 'pending' ? '•••' : k === 'failed' ? 'ERR' : String(call.status);
  return (
    <span className={`pill pill-${k}`} title={call.error ?? (k === 'pending' ? 'In flight' : undefined)}>
      {label}
    </span>
  );
}

export function MethodTag({ method }: { method: string }) {
  return <span className={`method method-${method.toLowerCase()}`}>{method}</span>;
}
