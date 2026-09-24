import { useMemo, useState, type ReactNode } from 'react';
import { Badge, Banner, Button, CodeBlock, DescriptionList, EmptyState, Row, Segmented, SpanTimeline, Stack, Text, type TimelineSpan } from '@/design';
import { api, enc, errorMessage } from '../api/client';
import { liveStore } from '../api/live';
import type { Header, MockRuleInput, NetworkCall, NetworkSummary } from '../api/types';
import { BodyBlock } from '../kit/console';
import { CopyAction, HttpStatus, MethodTag } from '../kit/controls';
import { Dock } from '../kit/overlays';
import { copyText } from '../lib/clipboard';
import { buildCurl } from '../lib/curl';
import { fmt, fmtBytes, fmtClock, fmtDateTime, fmtDuration, isNetworkError } from '../lib/format';
import { useAsync } from '../lib/hooks';
import { appStore } from '../state/app';
import { focusPath, navigate } from '../state/router';
import type { SessionView } from '../state/session';
import { createStore, useStore } from '../state/store';
import s from './Network.module.css';
import { RepeatButton } from './RepeatDialog';

type Tab = 'overview' | 'request' | 'response' | 'curl';
const tabStore = createStore<{ tab: Tab }>({ tab: 'overview' });

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'trailers', 'transfer-encoding', 'upgrade', 'content-length', 'content-encoding', 'date', 'x-killcam-mock']);

/** "Mock this": a respond rule that replays this exact response for this exact URL. */
export function mockInputFromCall(c: NetworkCall): MockRuleInput {
  let body = c.responseBody?.text ?? '';
  try {
    if (body && (c.contentType?.includes('json') || /^\s*[[{]/.test(body)) && !c.responseBody?.truncated) body = JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    /* keep as captured */
  }
  return {
    name: `${c.method} ${c.path.split('?')[0]}`,
    enabled: true,
    method: c.method,
    urlPattern: c.url,
    matchType: 'exact',
    action: 'respond',
    status: c.status ?? 200,
    headers: c.responseHeaders.filter((h) => !HOP_BY_HOP.has(h.name.toLowerCase())),
    body,
    delayMs: 0,
    failure: 'timeout',
    dropAfterBytes: 0,
    times: 0,
    probability: 100,
    endpoint: null,
    breakOn: 'request',
  };
}

/** One call in the dock: overview, request, response and cURL. */
export function NetworkDetail({ summary, view, onClose, closeOnBack }: { summary: NetworkSummary; view: SessionView; onClose: () => void; closeOnBack?: boolean }) {
  const tab = useStore(tabStore, (x) => x.tab);
  const live = view.kind === 'live';
  const saved = view.calls?.find((c) => c.id === summary.id) ?? null;
  const { data, error, loading } = useAsync<NetworkCall | null>(
    (signal) => (live ? api.get<NetworkCall>(`network/${enc(summary.id)}`, undefined, signal) : Promise.resolve(saved)),
    [summary.id, summary.state, summary.durationMs, live, saved],
  );
  const call = data ?? null;
  const mocks = useStore(liveStore, (x) => x.mocks);
  const mockName = summary.mockRuleId ? (mocks?.find((m) => m.id === summary.mockRuleId)?.name ?? summary.mockRuleId) : null;
  const mockThis = () => {
    if (!call) return;
    appStore.set({ mockDraft: { input: mockInputFromCall(call), testUrl: call.url } });
    navigate('mocks');
  };
  return (
    <Dock
      label="Call detail"
      closeOnBack={closeOnBack}
      onClose={onClose}
      title={
        <Row gap={8}>
          <MethodTag method={summary.method} />
          <Text variant="heading-sm" truncate>
            {summary.path}
          </Text>
        </Row>
      }
      subtitle={`${summary.host} · ${summary.state === 'pending' ? 'in flight' : summary.status != null ? `${summary.status}` : 'failed'} · ${fmtDuration(summary.durationMs)}`}
      actions={
        <>
          <CopyAction text={summary.url} label="Copy URL" iconOnly />
          <Button variant="mini" onClick={mockThis} disabled={!call} title="Create a mock rule that returns this response">
            Mock this
          </Button>
          <RepeatButton call={call} live={live} />
        </>
      }
      bar={
        <Segmented<Tab>
          label="Call detail"
          value={tab}
          onChange={(t) => tabStore.set({ tab: t })}
          options={[
            { value: 'overview', label: 'Overview' },
            { value: 'request', label: 'Request' },
            { value: 'response', label: 'Response' },
            { value: 'curl', label: 'cURL' },
          ]}
        />
      }
    >
      {loading && !call ? (
        <Text variant="small" tone="muted">
          Loading the call…
        </Text>
      ) : error ? (
        <Banner tone="fail" title="Could not load this call">
          {errorMessage(error)}
        </Banner>
      ) : !call ? (
        <EmptyState title="Not in this session">The call was dropped from the device’s buffer, or cleared.</EmptyState>
      ) : tab === 'overview' ? (
        <Overview call={call} mockName={mockName} view={view} />
      ) : tab === 'request' ? (
        <>
          <Query url={call.url} />
          <Headers title="Request headers" headers={call.requestHeaders} />
          <BodyBlock body={call.requestBody} label="Request" />
        </>
      ) : tab === 'response' ? (
        call.state === 'pending' ? (
          <Banner tone="neutral" title="Waiting for the response" />
        ) : call.state === 'failed' ? (
          <Banner tone="fail" title="No response">
            <Text variant="mono" breakAnywhere>
              {call.error}
            </Text>
          </Banner>
        ) : (
          <>
            <Headers title="Response headers" headers={call.responseHeaders} />
            <BodyBlock body={call.responseBody} label="Response" />
          </>
        )
      ) : (
        <Curl call={call} live={live} />
      )}
    </Dock>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <Text as="h3" variant="heading-sm">
          {title}
        </Text>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Overview({ call, mockName, view }: { call: NetworkCall; mockName: string | null; view: SessionView }) {
  const end = call.durationMs != null ? call.startMs + call.durationMs : null;
  // The calls around this one, on one axis: what else was in flight.
  const spans = useMemo<TimelineSpan[]>(() => {
    const near = view.network
      .filter((c) => Math.abs(c.startMs - call.startMs) < 5000)
      .sort((a, b) => Math.abs(a.startMs - call.startMs) - Math.abs(b.startMs - call.startMs))
      .slice(0, 12);
    const t0 = Math.min(...near.map((c) => c.startMs));
    return near.map((c) => ({
      key: c.id,
      label: `${c.method} ${c.path} · ${c.status ?? (c.state === 'pending' ? 'in flight' : 'failed')} · ${fmtDuration(c.durationMs)}`,
      start: c.startMs - t0,
      dur: c.durationMs ?? 0,
      tone: c.id === call.id ? (isNetworkError(c) ? 'fail' : 'pass') : 'neutral',
    }));
  }, [view.network, call]);
  return (
    <>
      <Row gap={8} wrap>
        <HttpStatus call={call} />
        <MethodTag method={call.method} />
        {mockName && <Badge tone="c4">Mocked</Badge>}
      </Row>
      <Text variant="mono" tone="primary" breakAnywhere>
        {call.url}
      </Text>
      <Section title="General">
        <DescriptionList
          min={260}
          items={[
            { term: 'Status', value: call.state === 'pending' ? 'In flight' : call.status != null ? `${call.status}${call.responseMessage ? ' ' + call.responseMessage : ''}` : 'No response' },
            ...(call.error ? [{ term: 'Error', value: <Text variant="mono" tone="fail" breakAnywhere>✕ {call.error}</Text> }] : []),
            { term: 'Protocol', value: call.protocol, mono: true },
            { term: 'Content type', value: call.contentType, mono: true },
            { term: 'Request size', value: fmtBytes(call.requestSize) },
            { term: 'Response size', value: call.state === 'complete' ? fmtBytes(call.responseSize) : '–' },
            { term: 'Screen', value: call.screen },
            { term: 'Captured by', value: call.source },
            ...(mockName
              ? [
                  {
                    term: 'Mock rule',
                    value: (
                      <Button variant="outline" onClick={() => navigate(focusPath('mocks', `mock:${call.mockRuleId}`))}>
                        {mockName}
                      </Button>
                    ),
                  },
                ]
              : []),
            { term: 'Call id', value: call.id, mono: true },
          ]}
        />
      </Section>
      <Section title="Timing">
        <DescriptionList
          min={260}
          items={[
            { term: 'Started', value: `${fmtDateTime(call.startMs)} · ${fmtClock(call.startMs)}` },
            { term: 'Finished', value: end ? fmtClock(end) : call.state === 'pending' ? 'In flight' : null },
            { term: 'Duration', value: fmtDuration(call.durationMs) },
          ]}
        />
        {spans.length > 1 && (
          <Stack gap={6}>
            <Text variant="caption">
              This call against the {fmt(spans.length - 1)} others started within 5 s of it (hover a bar for which).
            </Text>
            <SpanTimeline spans={spans} unit="ms" label="Calls around this one" />
          </Stack>
        )}
      </Section>
    </>
  );
}

function Headers({ title, headers }: { title: string; headers: Header[] }) {
  return (
    <Section title={`${title} · ${headers.length}`} aside={headers.length > 0 && <CopyAction text={() => headers.map((h) => `${h.name}: ${h.value}`).join('\n')} label={`Copy ${title.toLowerCase()}`} />}>
      {headers.length ? (
        <DescriptionList min={260} items={headers.map((h) => ({ term: h.name, value: h.value, mono: true }))} />
      ) : (
        <Text variant="small" tone="muted">
          None.
        </Text>
      )}
    </Section>
  );
}

function Query({ url }: { url: string }) {
  const params = useMemo(() => {
    try {
      return [...new URL(url).searchParams.entries()];
    } catch {
      return [];
    }
  }, [url]);
  if (!params.length) return null;
  return (
    <Section title={`Query · ${params.length}`}>
      <DescriptionList min={260} items={params.map(([k, v]) => ({ term: k, value: v, mono: true }))} />
    </Section>
  );
}

function Curl({ call, live }: { call: NetworkCall; live: boolean }) {
  const [fallback] = useState(() => buildCurl(call));
  const { data } = useAsync<string>((signal) => (live ? api.text(`network/${enc(call.id)}/curl`, undefined, signal) : Promise.resolve(fallback)), [call.id, live]);
  return <CodeBlock lang="cURL" code={data ?? fallback} onCopy={(c) => void copyText(c)} />;
}
