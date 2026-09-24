import { useEffect, useState } from 'react';
import { Banner, Button, FlushCard, Row, Spacer, Stack, StatusPill, Switch, Text } from '@/design';
import { api, errorMessage } from '../api/client';
import { liveStore, reloadConditions } from '../api/live';
import type { NetworkConditions, NetworkConditionsInput, NetworkPreset, NetworkProfile } from '../api/types';
import { FormField, TextInput } from '../kit/controls';
import { fmt } from '../lib/format';
import { navigate, useRoute } from '../state/router';
import { useStore } from '../state/store';
import { toast } from '../state/ui';

// Same numbers as NetworkConditionsEngine.PRESETS; the device's list wins once loaded.
const FALLBACK_PRESETS: NetworkPreset[] = [
  { profile: 'gprs', label: 'GPRS', description: '500 ms, 50/20 kbps, 2% loss', conditions: c('gprs', 500, 200, 50, 20, 2) },
  { profile: '2g', label: '2G (EDGE)', description: '300 ms, 250/50 kbps, 1% loss', conditions: c('2g', 300, 100, 250, 50, 1) },
  { profile: 'slow_3g', label: 'Slow 3G', description: '400 ms, 400/400 kbps', conditions: c('slow_3g', 400, 100, 400, 400, 0) },
  { profile: 'fast_3g', label: 'Fast 3G', description: '150 ms, 1.6 Mbps/750 kbps', conditions: c('fast_3g', 150, 50, 1600, 750, 0) },
  { profile: '4g', label: '4G', description: '50 ms, 12/6 Mbps', conditions: c('4g', 50, 20, 12000, 6000, 0) },
  { profile: 'flaky_wifi', label: 'Flaky Wi-Fi', description: '80 ms ± 600 ms, 2/1 Mbps, 10% loss', conditions: c('flaky_wifi', 80, 600, 2000, 1000, 10) },
  { profile: 'offline', label: 'Offline', description: 'Every call fails DNS resolution', conditions: { ...c('offline', 0, 0, 0, 0, 0), offline: true } },
];

function c(profile: NetworkProfile, latencyMs: number, jitterMs: number, downloadKbps: number, uploadKbps: number, lossPercent: number): NetworkConditions {
  return { profile, latencyMs, jitterMs, downloadKbps, uploadKbps, lossPercent, offline: false };
}

const OFF: NetworkConditions = c('off', 0, 0, 0, 0, 0);

export function isActive(n: NetworkConditions | null): n is NetworkConditions {
  return !!n && (n.offline || n.latencyMs > 0 || n.jitterMs > 0 || n.downloadKbps > 0 || n.uploadKbps > 0 || n.lossPercent > 0);
}

const rate = (kbps: number) => (kbps >= 1000 ? `${fmt(kbps / 1000, kbps % 1000 ? 1 : 0)} Mbps` : `${fmt(kbps)} kbps`);

/** "400 ms ± 100 ms, 400 kbps down, 400 kbps up" */
export function describeConditions(n: NetworkConditions): string {
  if (n.offline) return 'Every call fails DNS resolution.';
  const parts: string[] = [];
  if (n.latencyMs || n.jitterMs) parts.push(`${fmt(n.latencyMs)} ms${n.jitterMs ? ` ± ${fmt(n.jitterMs)} ms` : ''} latency`);
  if (n.downloadKbps) parts.push(`${rate(n.downloadKbps)} down`);
  if (n.uploadKbps) parts.push(`${rate(n.uploadKbps)} up`);
  if (n.lossPercent) parts.push(`${fmt(n.lossPercent)}% of calls lost`);
  return parts.join(', ');
}

export function profileLabel(n: NetworkConditions, presets: NetworkPreset[] = FALLBACK_PRESETS): string {
  return presets.find((p) => p.profile === n.profile)?.label ?? 'Custom';
}

/** Throttling for every intercepted call, shown above the mock rules. */
export function NetworkConditionsCard() {
  const conditions = useStore(liveStore, (x) => x.conditions);
  const [presets, setPresets] = useState<NetworkPreset[]>(FALLBACK_PRESETS);
  const [custom, setCustom] = useState<NetworkConditions | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<NetworkPreset[]>('network-conditions/presets')
      .then(setPresets)
      .catch(() => undefined);
    if (!liveStore.get().conditions) reloadConditions().catch(() => undefined);
  }, []);

  const apply = async (input: NetworkConditionsInput | null) => {
    setBusy(true);
    try {
      const next = input ? await api.put<NetworkConditions>('network-conditions', input) : await api.del<NetworkConditions>('network-conditions');
      liveStore.set({ conditions: next ?? OFF });
      setCustom(null);
    } catch (e) {
      toast(`Could not change the network conditions: ${errorMessage(e)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const current = conditions ?? OFF;
  const active = isActive(current);
  const selected: NetworkProfile = custom ? 'custom' : current.profile;
  const setField = (p: Partial<NetworkConditions>) => setCustom((x) => ({ ...(x ?? current), ...p, profile: 'custom' }));

  return (
    <FlushCard
      title="Network conditions"
      hint="Applies to every call through KillcamInterceptor, mocked or not, and stays on across app restarts until turned off. Each change is marked on the replay timeline."
      aside={active ? <StatusPill tone="warn">{profileLabel(current, presets)} is on</StatusPill> : <StatusPill tone="neutral">Off: the real network</StatusPill>}
    >
      <Stack gap={12} style={{ padding: '12px 24px 20px' }}>
        {/* Quiet buttons carry their own inset; pull the row out so their labels line up with the text. */}
        <Row gap={4} wrap role="radiogroup" aria-label="Network profile" style={{ marginLeft: -8 }}>
          <Button variant={selected === 'off' ? 'inverse' : 'quiet'} role="radio" aria-checked={selected === 'off'} disabled={busy} onClick={() => apply(null)}>
            Off
          </Button>
          {presets.map((p) => (
            <Button
              key={p.profile}
              variant={selected === p.profile ? 'inverse' : 'quiet'}
              role="radio"
              aria-checked={selected === p.profile}
              title={p.description}
              disabled={busy}
              onClick={() => apply({ profile: p.profile })}
            >
              {p.label}
            </Button>
          ))}
          <Button variant={selected === 'custom' ? 'inverse' : 'quiet'} role="radio" aria-checked={selected === 'custom'} disabled={busy} onClick={() => setCustom({ ...current, profile: 'custom' })}>
            Custom…
          </Button>
        </Row>
        {active && !custom && (
          <Text variant="small" tone="secondary">
            {describeConditions(current)}
          </Text>
        )}
        {custom && (
          <Stack gap={12}>
            <Row gap={12} align="end" wrap>
              <NumberField label="Latency" unit="ms" value={custom.latencyMs} step={50} onChange={(v) => setField({ latencyMs: v })} />
              <NumberField label="Jitter" unit="ms" value={custom.jitterMs} step={50} onChange={(v) => setField({ jitterMs: v })} />
              <NumberField label="Download" unit="kbps" value={custom.downloadKbps} step={50} onChange={(v) => setField({ downloadKbps: v })} />
              <NumberField label="Upload" unit="kbps" value={custom.uploadKbps} step={50} onChange={(v) => setField({ uploadKbps: v })} />
              <NumberField label="Loss" unit="% of calls" value={custom.lossPercent} max={100} onChange={(v) => setField({ lossPercent: v })} />
              <Switch checked={custom.offline} onChange={(on) => setField({ offline: on })} label={custom.offline ? 'Offline' : 'Online'} />
            </Row>
            <Text variant="small" tone="muted">
              A rate of 0 kbps means unlimited. Lost calls fail with a read timeout or a connection reset.
            </Text>
            <Row gap={8}>
              <Spacer />
              <Button variant="secondary" size="sm" onClick={() => setCustom(null)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" disabled={busy} onClick={() => apply({ ...custom, profile: 'custom' })}>
                Apply
              </Button>
            </Row>
          </Stack>
        )}
      </Stack>
    </FlushCard>
  );
}

function NumberField({ label, unit, value, onChange, step = 1, max }: { label: string; unit: string; value: number; onChange: (v: number) => void; step?: number; max?: number }) {
  return (
    <FormField label={label} group>
      <Row gap={6}>
        <TextInput
          mono
          type="number"
          min={0}
          max={max}
          step={step}
          value={value}
          aria-label={`${label} (${unit})`}
          onChange={(x) => onChange(Math.max(0, Math.min(max ?? Infinity, Number(x.target.value) || 0)))}
          style={{ width: 96 }}
        />
        <Text variant="small">{unit}</Text>
      </Row>
    </FormField>
  );
}

/** Above every other page while conditions are on, so nobody forgets the phone is throttled. */
export function ConditionsBanner() {
  const conditions = useStore(liveStore, (x) => x.conditions);
  const route = useRoute();
  if (!isActive(conditions) || route.panel === 'mocks') return null;
  return (
    <Banner
      tone="warn"
      title={`Simulated network: ${profileLabel(conditions)}`}
      actions={
        <Button variant="secondary" size="sm" onClick={() => navigate('mocks')}>
          Change in Mocks
        </Button>
      }
    >
      {describeConditions(conditions)}
    </Banner>
  );
}
