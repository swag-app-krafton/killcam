import { useState } from 'react';
import { Button, Row, Segmented, Spacer, Stack, Switch, Text } from '@/design';
import { api, enc, errorMessage } from '../api/client';
import type { Header, NetworkCall, RepeatRequest } from '../api/types';
import { FormField, SelectInput, TextArea, TextInput } from '../kit/controls';
import { KeyValueEditor } from '../kit/editors';
import { KDialog } from '../kit/overlays';
import { plural } from '../lib/format';
import { toast } from '../state/ui';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/** Named headers only, trimmed. A value sent back as "██ redacted" keeps its real value on the device. */
export const cleanHeaders = (headers: Header[]): Header[] => headers.filter((h) => h.name.trim()).map((h) => ({ name: h.name.trim(), value: h.value }));

/** "Repeat": re-sends a captured call through the app's own client, as is or edited. Live session only. */
export function RepeatButton({ call, live }: { call: NetworkCall | null; live: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="mini"
        disabled={!call || !live}
        onClick={() => setOpen(true)}
        title={live ? 'Send this request again through the app, as is or edited' : 'Only calls of the live app can be repeated'}
      >
        Repeat
      </Button>
      {open && call && <RepeatDialog call={call} onClose={() => setOpen(false)} />}
    </>
  );
}

function RepeatDialog({ call, onClose }: { call: NetworkCall; onClose: () => void }) {
  const [count, setCount] = useState(1);
  const [concurrent, setConcurrent] = useState(false);
  const [editing, setEditing] = useState(false);
  const [method, setMethod] = useState(call.method);
  const [url, setUrl] = useState(call.url);
  const [headers, setHeaders] = useState(call.requestHeaders);
  const bodyText = call.requestBody?.text ?? '';
  const partialBody = !!call.requestBody && (call.requestBody.text == null || call.requestBody.truncated);
  const [body, setBody] = useState(bodyText);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const send = async () => {
    setErr(null);
    setSending(true);
    const request: RepeatRequest = { count, concurrent: count > 1 && concurrent };
    if (editing) {
      request.edit = {
        method: method !== call.method ? method : null,
        url: url.trim() !== call.url ? url.trim() : null,
        headers: JSON.stringify(headers) !== JSON.stringify(call.requestHeaders) ? cleanHeaders(headers) : null,
        body: body !== bodyText ? body : null,
      };
    }
    try {
      const r = await api.post<{ started: number }>(`network/${enc(call.id)}/repeat`, request);
      toast(`Sent ${plural(r.started, 'repeat')}. They show in Network with the source “repeat”.`, 'ok');
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <KDialog
      open
      onClose={onClose}
      title="Repeat request"
      subtitle="Sent through the app's own HTTP client, so its sign-in and interceptors apply, as do mocks, network conditions and breakpoints. The app does not see the responses."
      width={720}
    >
      <Stack gap={24}>
        <Row gap={16} align="end" wrap>
          <FormField label="Times" group>
            <Row gap={6}>
              <TextInput
                mono
                type="number"
                min={1}
                max={50}
                value={count}
                aria-label="Times (calls)"
                onChange={(x) => setCount(Math.min(50, Math.max(1, Math.floor(Number(x.target.value) || 1))))}
                style={{ width: 80 }}
              />
              <Text variant="small">{count === 1 ? 'call' : 'calls'}</Text>
            </Row>
          </FormField>
          <FormField label="Timing" group>
            <Segmented<'serial' | 'concurrent'>
              label="Timing"
              value={count > 1 && concurrent ? 'concurrent' : 'serial'}
              onChange={(v) => setConcurrent(v === 'concurrent')}
              options={[
                { value: 'serial', label: 'One after another' },
                { value: 'concurrent', label: 'All at once' },
              ]}
            />
          </FormField>
          <Switch checked={editing} onChange={setEditing} label={editing ? 'Edit before sending' : 'Send as captured'} />
        </Row>
        {count > 1 && concurrent && (
          <Text variant="small" tone="muted">
            All {plural(count, 'call')} are released together, to reproduce a double submit or a race.
          </Text>
        )}

        {editing && (
          <Stack as="section" gap={12}>
            <Text as="h3" variant="heading-sm">
              Request
            </Text>
            <Row gap={12} align="end" wrap>
              <FormField label="Method">
                <SelectInput value={method} onChange={(x) => setMethod(x.target.value)} style={{ width: 130 }}>
                  {[...new Set([call.method, ...METHODS])].map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </SelectInput>
              </FormField>
              <FormField label="URL" grow>
                <TextInput mono value={url} onChange={(x) => setUrl(x.target.value)} />
              </FormField>
            </Row>
            <FormField label="Headers" group>
              <KeyValueEditor rows={headers} onChange={setHeaders} addLabel="Add header" namePlaceholder="header" />
            </FormField>
            <FormField label="Body" hint={partialBody ? 'The body was not captured in full. Leave it as it is to resend the original.' : undefined}>
              <TextArea mono rows={8} value={body} onChange={(x) => setBody(x.target.value)} />
            </FormField>
          </Stack>
        )}

        {err && (
          <Text variant="small" tone="fail">
            ✕ {err}
          </Text>
        )}
        <Row gap={8}>
          <Spacer />
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={send} disabled={sending}>
            {sending ? 'Sending…' : count > 1 ? `Send ${plural(count, 'call')}` : 'Send'}
          </Button>
        </Row>
      </Stack>
    </KDialog>
  );
}
