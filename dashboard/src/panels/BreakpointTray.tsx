import { useEffect, useState } from 'react';
import { Banner, Button, Row, Spacer, Stack, Text } from '@/design';
import { api, enc, errorMessage } from '../api/client';
import { liveStore } from '../api/live';
import type { MockFailure, PausedCall, ResumeRequest } from '../api/types';
import { FormField, MethodTag, SelectInput, TextArea, TextInput } from '../kit/controls';
import { KeyValueEditor } from '../kit/editors';
import { KDialog } from '../kit/overlays';
import { fmt, plural } from '../lib/format';
import { useStore } from '../state/store';
import { toast } from '../state/ui';
import { cleanHeaders } from './RepeatDialog';

const FAIL_WITH: { value: MockFailure; label: string }[] = [
  { value: 'connection_reset', label: 'Connection reset' },
  { value: 'timeout', label: 'Read timeout' },
  { value: 'dns_failure', label: 'DNS failure' },
  { value: 'connection_refused', label: 'Connection refused' },
  { value: 'network_switch', label: 'Network switch' },
  { value: 'ssl_handshake', label: 'TLS handshake failure' },
  { value: 'unexpected_eof', label: 'Unexpected end of stream' },
];

function useNow(ms: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

const secondsLeft = (p: PausedCall, now: number) => Math.max(0, Math.ceil((p.deadlineMs - now) / 1000));

async function resume(p: PausedCall, request: ResumeRequest): Promise<boolean> {
  try {
    await api.post(`breakpoints/${enc(p.id)}`, request);
    return true;
  } catch (e) {
    toast(`Could not resume the call: ${errorMessage(e)}`, 'error');
    return false;
  }
}

/** Calls held at breakpoints, above every page: the app is waiting on them. */
export function BreakpointTray() {
  const paused = useStore(liveStore, (x) => x.paused);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const now = useNow(1000);
  const open = paused.find((p) => p.id === openId) ?? null;

  // A newly paused call opens by itself when nothing else is open; one closed by hand stays closed (reopen it from the bar).
  useEffect(() => {
    if (openId && !paused.some((p) => p.id === openId)) setOpenId(null);
    else if (!openId) {
      const next = paused.find((p) => !dismissed.has(p.id));
      if (next) setOpenId(next.id);
    }
  }, [paused, openId, dismissed]);

  if (!paused.length) return null;
  return (
    <>
      <Banner
        tone="warn"
        title={`${plural(paused.length, 'call')} paused at a breakpoint`}
        actions={
          <Row gap={6} wrap>
            {paused.map((p) => (
              <Button key={p.id} variant="secondary" size="sm" onClick={() => setOpenId(p.id)} title={p.url}>
                {p.stage === 'request' ? 'Request' : 'Response'} · {p.method} {pathOf(p.url)} · {fmt(secondsLeft(p, now))} s left
              </Button>
            ))}
            {paused.length > 1 && (
              <Button variant="quiet" size="sm" onClick={() => api.post('breakpoints/resume-all').catch((e) => toast(errorMessage(e), 'error'))}>
                Continue all unchanged
              </Button>
            )}
          </Row>
        }
      >
        The app is waiting for these calls. Each continues unchanged when its time runs out.
      </Banner>
      {open && (
        <PausedEditor
          key={open.id}
          paused={open}
          now={now}
          onClose={() => {
            setDismissed((d) => new Set(d).add(open.id));
            setOpenId(null);
          }}
        />
      )}
    </>
  );
}

function PausedEditor({ paused: p, now, onClose }: { paused: PausedCall; now: number; onClose: () => void }) {
  const isRequest = p.stage === 'request';
  const [method, setMethod] = useState(p.method);
  const [url, setUrl] = useState(p.url);
  const [status, setStatus] = useState(p.status ?? 200);
  const originalHeaders = isRequest ? p.requestHeaders : p.responseHeaders;
  const [headers, setHeaders] = useState(originalHeaders);
  const originalBody = (isRequest ? p.requestBody : p.responseBody) ?? '';
  const [body, setBody] = useState(originalBody);
  const [failure, setFailure] = useState<MockFailure>('connection_reset');
  const [busy, setBusy] = useState(false);
  const editable = isRequest ? p.requestBodyEditable : p.responseBodyEditable;

  const edits = (): ResumeRequest => {
    const r: ResumeRequest = { action: 'continue' };
    if (JSON.stringify(headers) !== JSON.stringify(originalHeaders)) r.headers = cleanHeaders(headers);
    if (editable && body !== originalBody) r.body = body;
    if (isRequest) {
      if (method.trim() && method !== p.method) r.method = method.trim();
      if (url.trim() !== p.url) r.url = url.trim();
    } else if (status !== p.status) {
      r.status = status;
    }
    return r;
  };

  const act = async (request: ResumeRequest) => {
    setBusy(true);
    if (await resume(p, request)) onClose();
    setBusy(false);
  };

  const bodyHint = editable ? undefined : originalBody ? 'View only: the body is binary, compressed, streamed or over 1 MB.' : 'No body, or one that cannot be edited.';

  return (
    <KDialog
      open
      onClose={onClose}
      title={isRequest ? 'Paused before sending' : 'Paused before the app reads the response'}
      subtitle={`Rule “${p.ruleName}”. The app is waiting; the call continues unchanged in ${plural(secondsLeft(p, now), 'second')}.`}
      width={780}
    >
      <Stack gap={20}>
        <Row gap={8}>
          <MethodTag method={p.method} />
          <Text variant="mono" truncate title={p.url}>
            {p.url}
          </Text>
        </Row>
        {isRequest ? (
          <Row gap={12} align="end" wrap>
            <FormField label="Method">
              <TextInput mono value={method} onChange={(x) => setMethod(x.target.value.toUpperCase())} style={{ width: 110 }} />
            </FormField>
            <FormField label="URL" grow>
              <TextInput mono value={url} onChange={(x) => setUrl(x.target.value)} />
            </FormField>
          </Row>
        ) : (
          <FormField label="Status">
            <TextInput mono type="number" min={100} max={599} value={status} onChange={(x) => setStatus(Number(x.target.value))} style={{ width: 96 }} />
          </FormField>
        )}
        <FormField label={isRequest ? 'Request headers' : 'Response headers'} group>
          <KeyValueEditor rows={headers} onChange={setHeaders} addLabel="Add header" namePlaceholder="header" />
        </FormField>
        <FormField label={isRequest ? 'Request body' : 'Response body'} hint={bodyHint}>
          <TextArea mono rows={12} readOnly={!editable} value={body} onChange={(x) => setBody(x.target.value)} />
        </FormField>
        <Row gap={8} align="end" wrap>
          <FormField label="Fail the call with">
            <SelectInput value={failure} onChange={(x) => setFailure(x.target.value as MockFailure)} style={{ width: 220 }}>
              {FAIL_WITH.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </SelectInput>
          </FormField>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => act({ action: 'fail', failure })}>
            Fail
          </Button>
          <Spacer />
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => act({ action: 'continue' })}>
            Continue unchanged
          </Button>
          <Button variant="primary" size="sm" disabled={busy} onClick={() => act(edits())}>
            Continue with edits
          </Button>
        </Row>
      </Stack>
    </KDialog>
  );
}
