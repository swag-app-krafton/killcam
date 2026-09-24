import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, EmptyState, FlushCard, Row, SearchInput, Spacer, Stack, Table, Text, ToggleChip } from '@/design';
import { api, errorMessage } from '../api/client';
import { liveStore, reloadFlags } from '../api/live';
import type { Flag, FlagSource } from '../api/types';
import { ValueEditor } from '../kit/editors';
import { fmt, plural } from '../lib/format';
import { appStore } from '../state/app';
import { useRoute } from '../state/router';
import { useStore } from '../state/store';
import { confirmDialog, toast } from '../state/ui';

async function setFlag(key: string, value: string): Promise<boolean> {
  try {
    const updated = await api.put<Flag>('flags', { key, value });
    const flags = liveStore.get().flags;
    if (flags && updated?.key) liveStore.set({ flags: flags.map((f) => (f.key === updated.key ? updated : f)) });
    return true;
  } catch (e) {
    toast(`Could not set ${key}: ${errorMessage(e)}`, 'error');
    return false;
  }
}

async function resetFlag(key: string | null): Promise<void> {
  try {
    await api.del('flags', key ? { key } : undefined);
    await reloadFlags();
    toast(key ? `${key} is back to its remote or default value` : 'Every override is cleared', 'ok');
  } catch (e) {
    toast(`Could not reset: ${errorMessage(e)}`, 'error');
  }
}

const SOURCE: Record<FlagSource, { tone: 'accent' | 'c1' | 'neutral'; word: string }> = {
  override: { tone: 'accent', word: 'Override' },
  remote: { tone: 'c1', word: 'Remote' },
  default: { tone: 'neutral', word: 'Default' },
};

export function FlagsPanel() {
  const flags = useStore(liveStore, (x) => x.flags);
  const embed = useStore(appStore, (x) => x.embed);
  const { focus } = useRoute();
  const [q, setQ] = useState('');
  const [overridesOnly, setOverridesOnly] = useState(false);

  useEffect(() => {
    if (!flags) reloadFlags().catch(() => undefined);
  }, [flags]);
  // A link to one flag (from Remote Config) must find it on the page.
  useEffect(() => {
    if (focus?.startsWith('flag:')) {
      setQ('');
      setOverridesOnly(false);
    }
  }, [focus]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (flags ?? []).filter(
      (f) => (!overridesOnly || f.override != null) && (!needle || f.key.toLowerCase().includes(needle) || (f.description ?? '').toLowerCase().includes(needle) || f.value.toLowerCase().includes(needle)),
    );
    const map = new Map<string, Flag[]>();
    for (const f of list) {
      const g = f.group ?? 'Other';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(f);
    }
    return [...map.entries()].sort(([a], [b]) => (a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b)));
  }, [flags, q, overridesOnly]);

  if (!flags) return <EmptyState>Loading flags…</EmptyState>;
  if (!flags.length) {
    return (
      <EmptyState title="No flags declared">
        Flags appear here once the app reads them through Killcam, for example Killcam.booleanFlag("pay.new_pin_pad", default = false). Firebase Remote Config keys appear
        automatically when the app has firebase-config.
      </EmptyState>
    );
  }
  const overrides = flags.filter((f) => f.override != null).length;
  const shown = groups.reduce((a, [, l]) => a + l.length, 0);

  return (
    <Stack as="section" gap={20}>
      <Row gap={10} wrap>
        <SearchInput label="Search flags" placeholder="Search keys, descriptions and values" value={q} onChange={setQ} />
        <ToggleChip pressed={overridesOnly} onClick={() => setOverridesOnly(!overridesOnly)} count={overrides}>
          Overrides only
        </ToggleChip>
        <Text variant="small" tone="muted">
          {shown === flags.length ? plural(flags.length, 'flag') : `${fmt(shown)} of ${plural(flags.length, 'flag')}`}
        </Text>
        <Spacer />
        <Button
          size="sm"
          disabled={!overrides}
          onClick={async () => {
            const ok = await confirmDialog({ title: 'Reset every override?', message: `Clears ${plural(overrides, 'override')}. Each flag goes back to its remote value, or its default.`, confirmLabel: 'Reset all', danger: true });
            if (ok) void resetFlag(null);
          }}
        >
          Reset all overrides
        </Button>
      </Row>
      {groups.length === 0 ? (
        <EmptyState title="No flags match" actions={<Button variant="outline" onClick={() => (setQ(''), setOverridesOnly(false))}>Clear the search</Button>} />
      ) : (
        groups.map(([group, list]) => (
          <FlushCard key={group} title={group} hint={plural(list.length, 'flag')}>
            {embed ? (
              list.map((f) => <FlagCardRow key={f.key} flag={f} />)
            ) : (
              <Table minWidth={980} label={`${group} flags`}>
                <thead>
                  <tr>
                    <th>Flag</th>
                    <th>Type</th>
                    <th>Default</th>
                    <th>Remote</th>
                    <th>Value</th>
                    <th>Source</th>
                    <th aria-label="Reset" />
                  </tr>
                </thead>
                <tbody>
                  {list.map((f) => (
                    <tr key={f.key} data-hl={`flag:${f.key}`}>
                      <td style={{ maxWidth: 340 }}>
                        <Stack gap={2}>
                          <Text variant="mono" tone="primary" weight={600} breakAnywhere>
                            {f.key}
                          </Text>
                          {f.description && <Text variant="meta">{f.description}</Text>}
                        </Stack>
                      </td>
                      <td>
                        <Badge>{f.type}</Badge>
                      </td>
                      <td style={{ maxWidth: 180 }}>
                        <Text variant="mono" truncate title={f.defaultValue}>
                          {f.defaultValue || '–'}
                        </Text>
                      </td>
                      <td style={{ maxWidth: 180 }}>
                        <Text variant="mono" truncate title={f.remoteValue ?? undefined}>
                          {f.remoteValue ?? '–'}
                        </Text>
                      </td>
                      <td style={{ minWidth: 220 }}>
                        <ValueEditor type={f.type} value={f.value} options={f.options} label={f.key} onSave={(v) => setFlag(f.key, v)} />
                      </td>
                      <td>
                        <Badge tone={SOURCE[f.source].tone}>{SOURCE[f.source].word}</Badge>
                      </td>
                      <td>
                        {f.override != null && (
                          <Button variant="quiet" onClick={() => void resetFlag(f.key)} title={`Clear the override on ${f.key}`}>
                            Reset
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </FlushCard>
        ))
      )}
    </Stack>
  );
}

/** Phone: one flag per row, the editor under its name. */
function FlagCardRow({ flag: f }: { flag: Flag }) {
  return (
    <div data-hl={`flag:${f.key}`} style={{ padding: '12px 16px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Stack gap={2}>
        <Text variant="mono" tone="primary" weight={600} breakAnywhere>
          {f.key}
        </Text>
        {f.description && <Text variant="meta">{f.description}</Text>}
      </Stack>
      <ValueEditor type={f.type} value={f.value} options={f.options} label={f.key} onSave={(v) => setFlag(f.key, v)} />
      <Row gap={8} wrap>
        <Badge tone={SOURCE[f.source].tone}>{SOURCE[f.source].word}</Badge>
        <Text variant="meta" truncate>
          {f.type} · default {f.defaultValue || '–'}
          {f.remoteValue != null ? ` · remote ${f.remoteValue}` : ''}
        </Text>
        <Spacer />
        {f.override != null && (
          <Button variant="quiet" onClick={() => void resetFlag(f.key)}>
            Reset
          </Button>
        )}
      </Row>
    </div>
  );
}
