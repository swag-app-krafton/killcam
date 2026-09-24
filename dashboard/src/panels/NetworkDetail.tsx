import { useMemo } from 'react';
import { api, enc, errorMessage } from '../api/client';
import { liveStore } from '../api/live';
import type { Header, MockRuleInput, NetworkCall, NetworkSummary } from '../api/types';
import { BodyView } from '../components/BodyView';
import { Icon } from '../components/Icon';
import { MethodTag, StatusPill } from '../components/StatusPill';
import { CopyButton, EmptyState, IconButton, KeyValueTable, Loading, Tabs } from '../components/ui';
import { buildCurl } from '../lib/curl';
import { fmtBytes, fmtDateTime, fmtClock, fmtDuration } from '../lib/format';
import { useAsync } from '../lib/hooks';
import { appStore } from '../state/app';
import { navigate } from '../state/router';
import type { SessionView } from '../state/session';
import { createStore, useStore } from '../state/store';

type DetailTab = 'overview' | 'request' | 'response' | 'curl';
const tabStore = createStore<{ tab: DetailTab }>({ tab: 'overview' });

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'content-encoding',
  'date',
  'x-killcam-mock',
]);

/** "Mock this": a respond rule that replays this exact response for this exact URL. */
export function mockInputFromCall(c: NetworkCall): MockRuleInput {
  let body = c.responseBody?.text ?? '';
  try {
    if (body && (c.contentType?.includes('json') || /^\s*[[{]/.test(body)) && !c.responseBody?.truncated) {
      body = JSON.stringify(JSON.parse(body), null, 2);
    }
  } catch {
    /* keep as-is */
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
  };
}

export function NetworkDetail({
  summary,
  view,
  onClose,
}: {
  summary: NetworkSummary;
  view: SessionView;
  onClose: () => void;
}) {
  const tab = useStore(tabStore, (s) => s.tab);
  const saved = view.calls?.find((c) => c.id === summary.id) ?? null;
  const live = view.kind === 'live';
  const { data, error, loading } = useAsync<NetworkCall | null>(
    (signal) => (live ? api.get<NetworkCall>(`network/${enc(summary.id)}`, undefined, signal) : Promise.resolve(saved)),
    [summary.id, summary.state, summary.durationMs, live, saved],
  );
  const call = data ?? null;
  const mocks = useStore(liveStore, (s) => s.mocks);
  const mockName = summary.mockRuleId ? (mocks?.find((m) => m.id === summary.mockRuleId)?.name ?? summary.mockRuleId) : null;

  const mockThis = () => {
    if (!call) return;
    appStore.set({ mockDraft: { input: mockInputFromCall(call), testUrl: call.url } });
    navigate('mocks');
  };

  return (
    <div className="detail">
      <div className="detail-head">
        <IconButton icon="back" label="Close detail" onClick={onClose} className="detail-back" />
        <StatusPill call={summary} />
        <MethodTag method={summary.method} />
        <div className="detail-title mono" title={summary.url}>
          {summary.url}
        </div>
        <CopyButton text={summary.url} label="Copy URL" />
        <button type="button" className="btn primary sm" onClick={mockThis} disabled={!call} title="Create a mock rule from this response">
          <Icon name="mocks" size={14} />
          <span>Mock this</span>
        </button>
        <IconButton icon="x" label="Close detail (Esc)" onClick={onClose} className="detail-close" />
      </div>
      <Tabs
        value={tab}
        onChange={(t) => tabStore.set({ tab: t })}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'request', label: 'Request', badge: call ? call.requestHeaders.length : undefined },
          { id: 'response', label: 'Response', badge: call && call.state !== 'pending' ? call.responseHeaders.length : undefined },
          { id: 'curl', label: 'cURL' },
        ]}
      />
      <div className="detail-body">
        {loading && !call ? (
          <Loading />
        ) : error ? (
          <EmptyState icon="warning" title="Could not load this call" tone="error">
            {errorMessage(error)}
          </EmptyState>
        ) : !call ? (
          <EmptyState title="Call not found in this session" />
        ) : tab === 'overview' ? (
          <Overview call={call} mockName={mockName} />
        ) : tab === 'request' ? (
          <>
            <QueryParams url={call.url} />
            <Headers title="Request headers" headers={call.requestHeaders} />
            <Section title="Request body">
              <BodyView body={call.requestBody} label="Request" />
            </Section>
          </>
        ) : tab === 'response' ? (
          call.state === 'pending' ? (
            <EmptyState icon="clock" title="Waiting for the response…" />
          ) : call.state === 'failed' ? (
            <EmptyState icon="warning" title="No response" tone="error">
              <span className="mono">{call.error}</span>
            </EmptyState>
          ) : (
            <>
              <Headers title="Response headers" headers={call.responseHeaders} />
              <Section title="Response body">
                <BodyView body={call.responseBody} label="Response" />
              </Section>
            </>
          )
        ) : (
          <Curl call={call} live={live} />
        )}
      </div>
    </div>
  );
}

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <h3>{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function Overview({ call, mockName }: { call: NetworkCall; mockName: string | null }) {
  const end = call.durationMs != null ? call.startMs + call.durationMs : null;
  return (
    <>
      <Section title="General">
        <KeyValueTable
          rows={[
            ['URL', <span className="break">{call.url}</span>],
            ['Method', call.method],
            [
              'Status',
              call.state === 'pending' ? (
                'pending'
              ) : call.status != null ? (
                `${call.status}${call.responseMessage ? ' ' + call.responseMessage : ''}`
              ) : (
                '—'
              ),
            ],
            ...(call.error ? [['Error', <span className="text-error break">{call.error}</span>] as [string, React.ReactNode]] : []),
            ['Protocol', call.protocol ?? '—'],
            ['Content type', call.contentType ?? '—'],
            ['Request size', fmtBytes(call.requestSize)],
            ['Response size', call.state === 'complete' ? fmtBytes(call.responseSize) : '—'],
            ['Screen', call.screen ?? '—'],
            ['Captured by', call.source],
            ...(mockName
              ? [
                  [
                    'Mock rule',
                    <button type="button" className="link-btn" onClick={() => navigate('mocks')}>
                      {mockName}
                    </button>,
                  ] as [string, React.ReactNode],
                ]
              : []),
            ['Id', call.id],
          ]}
        />
      </Section>
      <Section title="Timing">
        <KeyValueTable
          rows={[
            ['Started', `${fmtDateTime(call.startMs)} · ${fmtClock(call.startMs)}`],
            ['Finished', end ? fmtClock(end) : call.state === 'pending' ? 'in flight' : '—'],
            ['Duration', <b className="tnum">{fmtDuration(call.durationMs)}</b>],
          ]}
        />
        {call.durationMs != null && (
          <div className="timing-bar" title={fmtDuration(call.durationMs)}>
            <span
              className={call.state === 'failed' ? 'fail' : ''}
              style={{ width: `${Math.min(100, Math.max(2, (call.durationMs / 3000) * 100))}%` }}
            />
            <em>{call.durationMs > 3000 ? 'over 3 s' : 'of 3 s'}</em>
          </div>
        )}
      </Section>
    </>
  );
}

function Headers({ title, headers }: { title: string; headers: Header[] }) {
  return (
    <Section
      title={`${title} (${headers.length})`}
      right={
        headers.length > 0 && (
          <CopyButton text={() => headers.map((h) => `${h.name}: ${h.value}`).join('\n')} label={`Copy ${title.toLowerCase()}`} />
        )
      }
    >
      {headers.length ? (
        <KeyValueTable rows={headers.map((h) => [h.name, <span className="break">{h.value}</span>])} />
      ) : (
        <div className="body-empty">None</div>
      )}
    </Section>
  );
}

function QueryParams({ url }: { url: string }) {
  const params = useMemo(() => {
    try {
      return [...new URL(url).searchParams.entries()];
    } catch {
      return [];
    }
  }, [url]);
  if (!params.length) return null;
  return (
    <Section title={`Query (${params.length})`}>
      <KeyValueTable rows={params.map(([k, v]) => [k, <span className="break">{v}</span>])} />
    </Section>
  );
}

function Curl({ call, live }: { call: NetworkCall; live: boolean }) {
  const { data, error } = useAsync<string>(
    (signal) => (live ? api.text(`network/${enc(call.id)}/curl`, undefined, signal) : Promise.resolve(buildCurl(call))),
    [call.id, live],
  );
  const text = data ?? (error ? buildCurl(call) : null);
  if (text == null) return <Loading />;
  return (
    <Section title="cURL" right={<CopyButton text={text} label="Copy cURL" showLabel />}>
      <pre className="raw mono curl">{text}</pre>
    </Section>
  );
}
