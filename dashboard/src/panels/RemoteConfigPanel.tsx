import { useMemo, useState } from 'react';
import { Badge, Banner, Button, CodeBlock, DescriptionList, EmptyState, ExpandableTable, FlushCard, Row, SearchInput, Spacer, Stack, Stat, StatGrid, StatusPill, Text, type ExpandableColumn } from '@/design';
import { api, errorMessage, isUnavailable } from '../api/client';
import { liveStore, reloadFlags } from '../api/live';
import type { RemoteConfigFetchStatus, RemoteConfigInfo, RemoteConfigSource, RemoteConfigValue } from '../api/types';
import { JsonBlock, tryParseJson } from '../kit/console';
import { copyText } from '../lib/clipboard';
import { fmt, fmtAgo, fmtDateTime, plural } from '../lib/format';
import { useAsync, useNow } from '../lib/hooks';
import { appStore } from '../state/app';
import { focusPath, navigate } from '../state/router';
import { useStore } from '../state/store';
import { toast } from '../state/ui';

const STATUS: Record<RemoteConfigFetchStatus, { tone: 'pass' | 'warn' | 'fail' | 'neutral'; word: string }> = {
  success: { tone: 'pass', word: 'Fetched' },
  failure: { tone: 'fail', word: 'Fetch failed' },
  throttled: { tone: 'warn', word: 'Throttled' },
  no_fetch_yet: { tone: 'neutral', word: 'Not fetched yet' },
};
const SOURCE: Record<RemoteConfigSource, { tone: 'c1' | 'neutral' | 'c4'; word: string; hint: string }> = {
  remote: { tone: 'c1', word: 'Remote', hint: 'Fetched from Firebase and activated.' },
  default: { tone: 'neutral', word: 'Default', hint: 'The in-app default: Firebase sent no value for this key.' },
  static: { tone: 'c4', word: 'Static', hint: 'Neither Firebase nor the app has a value: the key reads as empty.' },
};

export function RemoteConfigPanel() {
  const res = useAsync((signal) => api.get<RemoteConfigInfo>('remote-config', undefined, signal), []);
  const embed = useStore(appStore, (x) => x.embed);
  const flags = useStore(liveStore, (x) => x.flags);
  const [fetched, setFetched] = useState<RemoteConfigInfo | null>(null);
  const [fetching, setFetching] = useState(false);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  useNow(30_000);
  const info = fetched ?? res.data ?? null;
  // Overrides live in Flags; the flags stream keeps them current.
  const overrides = useMemo(() => new Map((flags ?? []).map((f) => [f.key, f.override])), [flags]);
  const values = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (info?.values ?? []).filter((v) => !n || v.key.toLowerCase().includes(n) || v.value.toLowerCase().includes(n));
  }, [info, q]);

  const fetchNow = async () => {
    setFetching(true);
    try {
      const r = await api.post<RemoteConfigInfo>('remote-config/fetch');
      setFetched(r);
      await reloadFlags().catch(() => undefined);
      toast(r.fetchStatus === 'success' ? 'Fetched and activated' : `Fetch: ${STATUS[r.fetchStatus].word}`, r.fetchStatus === 'success' ? 'ok' : 'error');
    } catch (e) {
      toast(`Could not fetch: ${errorMessage(e)}`, 'error');
    } finally {
      setFetching(false);
    }
  };

  if (res.error && !fetched) {
    return isUnavailable(res.error) ? (
      <EmptyState title="Firebase Remote Config is not available in this build">
        Killcam reads Remote Config when the app includes com.google.firebase:firebase-config and initialises a default FirebaseApp. Other flags keep working in Flags.
      </EmptyState>
    ) : (
      <EmptyState title="Could not load Remote Config" actions={<Button variant="outline" onClick={res.reload}>Try again</Button>}>
        {errorMessage(res.error)}
      </EmptyState>
    );
  }
  if (!info) return <EmptyState>Loading Remote Config…</EmptyState>;

  const override = (v: RemoteConfigValue) => (overrides.has(v.key) ? (overrides.get(v.key) ?? null) : v.flagOverride);
  const columns: ExpandableColumn[] = embed
    ? [
        { key: 'key', label: 'Key', width: 'minmax(0, 1fr)' },
        { key: 'source', label: 'Source', width: '84px' },
      ]
    : [
        { key: 'key', label: 'Key', width: 'minmax(200px, 1.2fr)' },
        { key: 'value', label: 'Value', width: 'minmax(200px, 2fr)' },
        { key: 'source', label: 'Source', width: '96px' },
        { key: 'override', label: 'Override', width: '130px' },
        { key: 'act', label: '', width: '104px' },
      ];

  return (
    <Stack as="section" gap={20}>
      <StatGrid min={170}>
        <Stat label="Last fetch" value={<StatusPill tone={STATUS[info.fetchStatus].tone}>{STATUS[info.fetchStatus].word}</StatusPill>} size="sm" note={<Text variant="caption">{info.lastFetchMs ? `${fmtAgo(info.lastFetchMs)} · ${fmtDateTime(info.lastFetchMs)}` : 'never'}</Text>} />
        <Stat label="Keys" value={fmt(info.values.length)} size="sm" note={<Text variant="caption">{fmt(info.values.filter((v) => v.source === 'remote').length)} from Firebase</Text>} />
        <Stat label="Minimum fetch interval" value={fmt(info.minimumFetchIntervalSeconds)} unit="s" size="sm" />
        <Stat label="Fetch timeout" value={fmt(info.fetchTimeoutSeconds)} unit="s" size="sm" />
      </StatGrid>
      <Row gap={10} wrap>
        <SearchInput label="Search keys" placeholder="Search keys and values" value={q} onChange={setQ} />
        <Spacer />
        <Button variant="primary" size="sm" onClick={fetchNow} disabled={fetching}>
          {fetching ? 'Fetching…' : 'Fetch and activate'}
        </Button>
      </Row>
      <Banner tone="neutral" title="Every key is also a flag">
        Remote Config keys are mirrored into Flags, under Firebase Remote Config, where you can override them. An override reaches only code that reads the key through Killcam.*Flag().
      </Banner>
      <FlushCard title="Values" hint={plural(values.length, 'key')}>
        {values.length === 0 ? (
          <div style={{ padding: 24 }}>
            <Text variant="body">{info.values.length ? 'No keys match.' : 'Firebase returned no keys.'}</Text>
          </div>
        ) : (
          <ExpandableTable
            label="Remote Config values"
            minWidth={embed ? 0 : 820}
            columns={columns}
            rows={values}
            rowKey={(v) => v.key}
            rowAttrs={(v) => ({ 'data-hl': `rc:${v.key}` })}
            toggleLabel={(v) => v.key}
            openKey={open}
            onToggle={(k) => setOpen(open === k ? null : k)}
            cells={(v) => {
              const ov = override(v);
              const source = <Badge key="s" tone={SOURCE[v.source].tone}>{SOURCE[v.source].word}</Badge>;
              const key = (
                <Stack key="k" gap={2}>
                  <Text variant="mono" tone="primary" weight={600} truncate>
                    {v.key}
                  </Text>
                  {embed && (
                    <Text variant="meta" truncate>
                      {v.value === '' ? 'empty' : v.value}
                      {ov != null ? ` · override ${ov}` : ''}
                    </Text>
                  )}
                </Stack>
              );
              if (embed) return [key, source];
              return [
                key,
                <Text key="v" variant="mono" truncate title={v.value}>
                  {v.value === '' ? '–' : v.value}
                </Text>,
                source,
                ov != null ? (
                  <Badge key="o" tone="accent">
                    {ov}
                  </Badge>
                ) : (
                  <Text key="o" variant="meta">
                    –
                  </Text>
                ),
                <Button key="a" variant="mini" onClick={() => navigate(focusPath('flags', `flag:${v.key}`))} title="Open this key in Flags to override it">
                  Override
                </Button>,
              ];
            }}
            detail={(v) => <ValueDetail v={v} override={override(v)} />}
          />
        )}
      </FlushCard>
    </Stack>
  );
}

function ValueDetail({ v, override }: { v: RemoteConfigValue; override: string | null }) {
  const json = tryParseJson(v.value);
  return (
    <Stack gap={14}>
      {json !== undefined && typeof json === 'object' && json !== null ? (
        <JsonBlock value={json} label={`${v.key} · JSON`} expandDepth={3} />
      ) : (
        <CodeBlock lang="Value" code={v.value === '' ? '(empty)' : v.value} onCopy={(c) => void copyText(c)} />
      )}
      <DescriptionList
        min={240}
        items={[
          { term: 'Source', value: SOURCE[v.source].hint },
          { term: 'Flag override', value: override, mono: true },
        ]}
        missing="none"
      />
      <Row>
        <Button variant="outline" onClick={() => navigate(focusPath('flags', `flag:${v.key}`))}>
          Override in Flags
        </Button>
      </Row>
    </Stack>
  );
}
