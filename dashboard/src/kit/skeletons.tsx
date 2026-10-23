/**
 * One loading skeleton per page, mirroring that page's loaded layout: the same
 * design-system cards, tables and toolbars, the real static titles and column
 * headers, and shimmer bones where the data goes.
 *
 * This module is loaded eagerly (pages are lazy chunks), so the shell's
 * Suspense fallback can show the right skeleton while a page's code downloads,
 * and the page shows the same skeleton while its data loads: one loader, then
 * the content, with nothing jumping.
 *
 * Keep each skeleton in step with its page. Column headers are repeated here on
 * purpose; importing them from the page would pull the page into this bundle.
 */
import type { CSSProperties, ReactNode } from 'react';
import { Banner, Card, ExpandableTable, FlushCard, Grid, Row, SectionTitle, Spacer, Stack, Stat, StatGrid, Table, Text, numCell, type ExpandableColumn } from '@/design';
import { useRoute, type Panel } from '../state/router';
import { appStore } from '../state/app';
import { useStore } from '../state/store';
import { Bone, Skeleton, skeletonClasses as s, widths } from './Skeleton';
import { VTable, type VColumn } from './VTable';

const useEmbed = () => useStore(appStore, (x) => x.embed);

// Bones the size of the design system's controls.
/** Like SearchInput: fills what its row leaves, at least 180 px; pass `w` outside a row. */
const SearchBone = ({ w }: { w?: number | string }) => <Bone w={w ?? 'auto'} h={36} style={w == null ? { flex: '1 1 0', minWidth: 180 } : undefined} />;
const ButtonBone = ({ w = 110, h = 32 }: { w?: number; h?: number }) => <Bone w={w} h={h} />;
/** Killcam's IconBtn: 28 px small, 34 px by default, 40 px large. Without an outline only its icon shows. */
const IconBone = ({ size = 'md', outlined }: { size?: 'sm' | 'md' | 'lg'; outlined?: boolean }) => {
  const px = size === 'sm' ? 28 : size === 'lg' ? 40 : 34;
  if (outlined) return <Bone w={px} h={px} />;
  const icon = size === 'sm' ? 14 : size === 'lg' ? 18 : 16;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: px, height: px, flex: 'none' }}>
      <Bone w={icon} h={icon} r={3} />
    </span>
  );
};
const MiniButtonBone = ({ w = 52 }: { w?: number }) => <Bone w={w} h={28} />;
const ChipBone = ({ w = 88 }: { w?: number }) => <Bone w={w} h={26} r={999} />;
const SegmentedBone = ({ segments }: { segments: number[] }) => (
  <Row gap={2}>
    {segments.map((w, i) => (
      <Bone key={i} w={w} h={28} />
    ))}
  </Row>
);
/** A line of text: a bone the height of the glyphs, in a box the height of the line. */
const Line = ({ w, h = 12, lh = Math.round(h * 1.6) }: { w: number | string; h?: number; lh?: number }) => (
  <span style={{ display: 'flex', alignItems: 'center', height: lh, minWidth: 0 }}>
    <Bone w={w} h={h} />
  </span>
);
const TitleBone = ({ w = 110 }: { w?: number }) => <Bone w={w} h={16} />;
const HintBone = ({ w = 80 }: { w?: number }) => <Bone w={w} h={11} />;
const Method = () => <Bone w={40} h={18} />;
const Badge = ({ w = 56 }: { w?: number }) => <Bone w={w} h={20} r={4} />;

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
type Placeholder = { id: string };
const placeholders = (n: number): Placeholder[] => range(n).map((i) => ({ id: String(i) }));

/** Rows of bones for a plain design-system Table, one bone per cell. */
function BoneRows({ rows, cells }: { rows: number; cells: (i: number) => ReactNode[] }) {
  return (
    <tbody>
      {range(rows).map((i) => (
        <tr key={i}>
          {cells(i).map((cell, c) => (
            <td key={c}>{cell}</td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

const fill: CSSProperties = { flex: '1 1 0', display: 'flex', flexDirection: 'column', minHeight: 0 };

// ------------------------------------------------------------------ Replay --

export function ReplaySkeleton() {
  return (
    <Skeleton label="the session" className={s.replayWrap}>
      <div className={s.replayGrid}>
        <div className={s.replayCol}>
          <div className={s.replayHud}>
            <Bone w={46} h={11} />
            <Line w={150} h={14} />
            <Spacer />
            <Bone w={96} h={14} />
          </div>
          <div className={s.replayStage}>
            <div className={s.replayPhone}>
              <div className={s.replayScreen}>
                <Bone w="100%" h="100%" r={0} block />
              </div>
            </div>
          </div>
          <div className={s.replayTransport}>
            <Stack gap={6}>
              <Bone w="100%" h={30} r={4} block />
              <Row gap={8}>
                <Line w={40} h={10} />
                <Spacer />
                <Line w={40} h={10} />
                <Spacer />
                <Line w={40} h={10} />
              </Row>
            </Stack>
            <Row gap={8} wrap>
              <Bone w={34} h={34} />
              <ButtonBone w={76} />
              <Bone w={34} h={34} />
              <SegmentedBone segments={[36, 36, 36]} />
              <Line w={120} h={13} />
              <Spacer />
              <SegmentedBone segments={[150, 76, 76]} />
              <Bone w={118} h={28} />
              <Bone w={34} h={34} />
              <Line w={140} h={11} />
            </Row>
          </div>
        </div>
        <div className={s.replayCol}>
          <div className={s.replayFeedHead}>
            <Line w={100} h={14} lh={18} />
            <Row gap={6} wrap>
              {[112, 76, 116, 78, 96].map((w, i) => (
                <Bone key={i} w={w} h={26} r={999} />
              ))}
            </Row>
          </div>
          {widths(14, [200, 150, 230, 130, 180, 160]).map((w, i) => (
            <div key={i} className={s.feedRow}>
              <Bone w={44} h={11} />
              <Bone w={20} h={20} r={4} />
              <Stack gap={0}>
                <Line w={w} h={12} />
                {i % 3 !== 2 && <Line w={110} h={10} />}
              </Stack>
            </div>
          ))}
        </div>
      </div>
    </Skeleton>
  );
}

// ----------------------------------------------------------------- Network --

/** Mirrors NetworkPanel's COLUMNS. */
const NETWORK_COLUMNS: VColumn[] = [
  { key: 'status', label: 'Status', width: '78px' },
  { key: 'method', label: 'Method', width: '64px' },
  { key: 'url', label: 'URL', width: 'minmax(200px, 1fr)' },
  { key: 'screen', label: 'Screen', width: 'minmax(0, 150px)', minTableWidth: 860 },
  { key: 'time', label: 'Time', width: '76px', align: 'right', minTableWidth: 520 },
  { key: 'size', label: 'Size', width: '76px', align: 'right', minTableWidth: 660 },
  { key: 'started', label: 'Started', width: '76px', align: 'right', minTableWidth: 980 },
];
const URL_WIDTHS = [260, 210, 320, 180, 240, 290, 200];

/** The calls list only, for NetworkPanel while its toolbar is already up. */
export function NetworkBodySkeleton() {
  const embed = useEmbed();
  if (embed) {
    return (
      <Skeleton label="calls" style={fill}>
        <div className={s.plist}>
          {widths(9, URL_WIDTHS).map((w, i) => (
            <div key={i} className={s.plistRow}>
              <Row gap={8}>
                <Bone w={36} h={18} />
                <Method />
                <Line w={Math.min(Number(w), 200)} h={13} />
              </Row>
              <Row gap={8}>
                <Line w={70} h={10} />
                <Spacer />
                <Line w={46} h={10} />
              </Row>
            </div>
          ))}
        </div>
      </Skeleton>
    );
  }
  return (
    <Skeleton label="calls" style={fill}>
      <VTable<Placeholder>
        label="Loading calls"
        columns={NETWORK_COLUMNS}
        rows={placeholders(14)}
        rowKey={(r) => r.id}
        rowHeight={40}
        cells={(r) => {
          const i = Number(r.id);
          return [
            <Bone key="s" w={40} h={20} r={999} />,
            <Method key="m" />,
            <Line key="u" w={URL_WIDTHS[i % URL_WIDTHS.length]!} />,
            <Line key="sc" w={i % 2 ? 90 : 70} />,
            <Line key="t" w={36} />,
            <Line key="z" w={40} />,
            <Line key="st" w={52} />,
          ];
        }}
      />
    </Skeleton>
  );
}

export function NetworkSkeleton() {
  const embed = useEmbed();
  return (
    <div className={s.page}>
      <Skeleton label="network">
        <div className={s.bar}>
          <SearchBone />
          {embed ? (
            <ChipBone w={92} />
          ) : (
            <>
              <Bone w={120} h={36} />
              <Bone w={120} h={36} />
              <Bone w={120} h={36} />
              <ChipBone w={110} />
              <ChipBone w={100} />
              <Line w={170} />
              <Spacer />
              <Bone w={34} h={34} />
              <ButtonBone w={64} />
              <ButtonBone w={64} />
            </>
          )}
        </div>
      </Skeleton>
      <NetworkBodySkeleton />
    </div>
  );
}

// -------------------------------------------------------------------- Logs --

const LOG_WIDTHS = ['62%', '44%', '78%', '35%', '56%', '70%', '48%', '66%'];

/** The console only, for LogsPanel while its toolbar is already up. */
export function LogsBodySkeleton() {
  const embed = useEmbed();
  return (
    <Skeleton label="logs" style={fill}>
      <div className={s.console}>
        {embed
          ? widths(8, LOG_WIDTHS).map((w, i) => (
              <div key={i} className={s.consoleLinePhone}>
                <Row gap={8}>
                  <Bone console w={78} h={10} />
                  <Bone console w={12} h={12} />
                  <Bone console w={90} h={10} />
                </Row>
                <Bone console w={w} h={12} />
                {i % 2 === 0 && <Bone console w="40%" h={12} />}
              </div>
            ))
          : widths(22, LOG_WIDTHS).map((w, i) => (
              <div key={i} className={s.consoleLine}>
                <Bone console w={84} h={10} />
                <Bone console w={10} h={12} />
                <Bone console w={i % 3 ? 96 : 130} h={10} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <Bone console w={w} h={10} />
                </span>
              </div>
            ))}
      </div>
    </Skeleton>
  );
}

export function LogsSkeleton() {
  const embed = useEmbed();
  return (
    <div className={s.page}>
      <Skeleton label="logs">
        {embed ? (
          <Stack gap={10}>
            <div className={s.bar}>
              <SearchBone />
              <Bone w={40} h={40} />
              <Bone w={40} h={40} />
            </div>
            <Row gap={6}>
              {[44, 44, 44, 44, 44, 44, 80, 80].map((w, i) => (
                <Bone key={i} w={w} h={36} r={999} />
              ))}
            </Row>
          </Stack>
        ) : (
          <div className={s.bar}>
            <SearchBone />
            {range(6).map((i) => (
              <ChipBone key={i} w={48} />
            ))}
            <ChipBone w={56} />
            <ChipBone w={70} />
            <ChipBone w={70} />
            <Line w={90} />
            <Spacer />
            <Bone w={34} h={34} />
            <ButtonBone w={64} />
          </div>
        )}
      </Skeleton>
      <LogsBodySkeleton />
    </div>
  );
}

// ----------------------------------------------------------------- Crashes --

export function CrashesSkeleton() {
  const embed = useEmbed();
  const columns: ExpandableColumn[] = embed
    ? [
        { key: 'ex', label: 'Exception', width: 'minmax(0, 1fr)' },
        { key: 'fatal', label: 'Kind', width: '96px' },
      ]
    : [
        { key: 'when', label: 'When', width: '130px' },
        { key: 'ex', label: 'Exception', width: 'minmax(220px, 2fr)' },
        { key: 'fatal', label: 'Kind', width: '110px' },
        { key: 'session', label: 'Session', width: '150px' },
        { key: 'screen', label: 'Screen', width: 'minmax(130px, 1fr)' },
      ];
  return (
    <Skeleton label="crashes">
      <Stack as="section" gap={20}>
        {!embed && (
          <Grid min={180} gap={12}>
            {['Fatal crashes', 'Non-fatal errors', 'Sessions with a crash', 'Latest'].map((label) => (
              <div key={label} className={s.kpiTile}>
                <span className={s.kpiLabel}>{label}</span>
                <Bone w={64} h={34} />
                <Line w={120} h={11} />
              </div>
            ))}
          </Grid>
        )}
        <FlushCard title="Crashes and errors" hint={<Line w={300} h={11} />} aside={<SegmentedBone segments={[64, 76, 96]} />}>
          <ExpandableTable<Placeholder>
            label="Loading crashes"
            minWidth={embed ? 0 : 760}
            columns={columns}
            rows={placeholders(7)}
            rowKey={(r) => r.id}
            toggleLabel={() => 'Loading'}
            openKey={null}
            onToggle={() => undefined}
            detail={() => null}
            cells={(r) => {
              const i = Number(r.id);
              const ex = (
                <Stack key="ex" gap={4}>
                  <Line w={[220, 170, 250][i % 3]!} h={13} />
                  <Line w={[160, 210, 120][i % 3]!} h={10} />
                </Stack>
              );
              const kind = <Badge key="k" w={i % 3 ? 70 : 52} />;
              return embed ? [ex, kind] : [<Line key="w" w={90} />, ex, kind, <Line key="s" w={96} />, <Line key="sc" w={i % 2 ? 110 : 80} />];
            }}
          />
        </FlushCard>
      </Stack>
    </Skeleton>
  );
}

// ------------------------------------------------------------------- Mocks --

/**
 * The rules. `conditions` is the page's own network-conditions card, which does not wait for
 * the rules; without it (the page's code still loading) the card is drawn in bones.
 */
export function MocksSkeleton({ conditions }: { conditions?: ReactNode }) {
  const embed = useEmbed();
  return (
    <Stack as="section" gap={20}>
      {conditions ?? (
        <Skeleton label="network conditions">
          <FlushCard
            title="Network conditions"
            hint="Applies to every call through KillcamInterceptor, mocked or not, and stays on across app restarts until turned off. Each change is marked on the replay timeline."
            aside={<Bone w={150} h={22} r={999} />}
          >
            <Stack gap={12} style={{ padding: '12px 24px 20px' }}>
              <Row gap={4} wrap style={{ marginLeft: -8 }}>
                {[36, 52, 66, 64, 58, 34, 72, 58, 70].map((w, i) => (
                  <Bone key={i} w={w} h={28} />
                ))}
              </Row>
            </Stack>
          </FlushCard>
        </Skeleton>
      )}
      <Skeleton label="mock rules">
        <Stack gap={20}>
          {embed ? (
            <Stack gap={10}>
              <Stack gap={0}>
                <Line w="100%" />
                <Line w={60} />
              </Stack>
              <Row>
                <Spacer />
                <ButtonBone w={86} />
              </Row>
            </Stack>
          ) : (
            <Row gap={10} wrap>
              <Line w={340} />
              <Spacer />
              <ButtonBone w={96} />
            </Row>
          )}
          {embed ? (
            <FlushCard>
              {range(4).map((i) => (
                <div key={i} style={{ display: 'flex', gap: 8, padding: '10px 8px 10px 12px', borderBottom: '1px solid var(--line)' }}>
                  <Stack gap={0}>
                    <IconBone size="lg" />
                    <IconBone size="lg" />
                  </Stack>
                  <Stack gap={6} grow>
                    <Line w={180} h={14} />
                    <Row gap={6}>
                      <Method />
                      <Line w={140} />
                    </Row>
                    <Line w={160} h={10} />
                    <Row gap={4}>
                      <Bone w={70} h={24} r={999} />
                      <Spacer />
                      <MiniButtonBone />
                    </Row>
                  </Stack>
                </div>
              ))}
            </FlushCard>
          ) : (
            <FlushCard title="Rules" hint="In the order they are tried. Hits count the calls a rule answered; a rule limited to its first calls lets later ones through.">
              <Table minWidth={920} label="Loading mock rules">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>On</th>
                    <th>Rule</th>
                    <th>Answer</th>
                    <th className={numCell}>Hits</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <BoneRows
                  rows={4}
                  cells={(i) => [
                    <Row key="o" gap={8}>
                      <Line w={18} />
                      <IconBone size="sm" />
                      <IconBone size="sm" />
                    </Row>,
                    <Row key="on" gap={8}>
                      <Bone w={30} h={16} r={999} />
                      <Line w={22} />
                    </Row>,
                    <Stack key="r" gap={6}>
                      <Line w={[240, 190, 300, 210][i]!} h={13} />
                      <Row gap={6}>
                        <Method />
                        <Bone w={70} h={18} />
                        <Line w={120} />
                      </Row>
                    </Stack>,
                    <Line key="a" w={[150, 120, 200, 170][i]!} />,
                    <div key="h" style={{ textAlign: 'right' }}>
                      <Line w={18} />
                    </div>,
                    <Row key="x" gap={6}>
                      <IconBone />
                      <MiniButtonBone w={44} />
                      <IconBone />
                    </Row>,
                  ]}
                />
              </Table>
            </FlushCard>
          )}
        </Stack>
      </Skeleton>
    </Stack>
  );
}

// --------------------------------------------------------------- Endpoints --

export function EndpointsSkeleton() {
  const embed = useEmbed();
  return (
    <Skeleton label="endpoints">
      <Stack as="section" gap={20}>
        {embed ? (
          <Stack gap={10}>
            <Line w={290} />
            <Row gap={10}>
              <ButtonBone w={150} />
              <ButtonBone w={96} />
            </Row>
          </Stack>
        ) : (
          <Row gap={10} wrap>
            <Line w={260} />
            <Spacer />
            <SearchBone />
            <ButtonBone w={196} />
            <ButtonBone w={116} />
          </Row>
        )}
        {[2, 1].map((n, g) => (
          <FlushCard key={g} title={<TitleBone w={g ? 50 : 70} />} hint={<HintBone w={76} />}>
            {embed ? (
              range(n).map((i) => (
                // Mirrors EndpointsPanel's EndpointCard.
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
                  <Row gap={8}>
                    <Method />
                    <Line w={[120, 170][i % 2]!} h={12} lh={19} />
                  </Row>
                  <Line w={[210, 250][i % 2]!} h={10} lh={18} />
                  <Row gap={4}>
                    <ButtonBone w={46} />
                    <ButtonBone w={56} />
                    <ButtonBone w={90} />
                    <Spacer />
                    <Line w={26} />
                  </Row>
                </div>
              ))
            ) : (
              <Table minWidth={920} label="Loading endpoints">
                <thead>
                  {/* Mirrors EndpointsPanel: fixed widths so the columns line up across groups. */}
                  <tr>
                    <th style={{ width: 90 }}>Method</th>
                    <th>Endpoint</th>
                    <th style={{ width: 200 }}>Source</th>
                    <th className={numCell} style={{ width: 80 }}>
                      Calls
                    </th>
                    <th className={numCell} style={{ width: 80 }}>
                      Errors
                    </th>
                    <th aria-label="Actions" style={{ width: 360 }} />
                  </tr>
                </thead>
                <BoneRows
                  rows={n}
                  cells={(i) => [
                    <Method key="m" />,
                    <Stack key="e" gap={6}>
                      <Line w={[150, 190][i % 2]!} h={13} />
                      <Line w={[80, 110][i % 2]!} h={11} />
                    </Stack>,
                    <Badge key="s" w={52} />,
                    <div key="c" style={{ textAlign: 'right' }}>
                      <Line w={22} />
                    </div>,
                    <div key="x" style={{ textAlign: 'right' }}>
                      <Line w={14} />
                    </div>,
                    <Row key="a" gap={6}>
                      <MiniButtonBone w={48} />
                      <MiniButtonBone w={56} />
                      <MiniButtonBone w={92} />
                      <MiniButtonBone w={40} />
                    </Row>,
                  ]}
                />
              </Table>
            )}
          </FlushCard>
        ))}
      </Stack>
    </Skeleton>
  );
}

/** The export dialog's JSON, while the catalogue is built. */
export function JsonSkeleton() {
  return (
    <Skeleton label="the catalogue" delay={0}>
      <Stack gap={8} style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', minHeight: 300 }}>
        {widths(12, ['30%', '55%', '48%', '62%', '40%', '70%']).map((w, i) => (
          <Line key={i} w={w} />
        ))}
      </Stack>
    </Skeleton>
  );
}

// ------------------------------------------------------------------- Flags --

export function FlagsSkeleton() {
  const embed = useEmbed();
  return (
    <Skeleton label="flags">
      <Stack as="section" gap={20}>
        <Row gap={10} wrap>
          <SearchBone />
          <ChipBone w={108} />
          <Line w={50} />
          <Spacer />
          <ButtonBone w={150} />
        </Row>
        {[3, 2].map((n, g) => (
          <FlushCard key={g} title={<TitleBone w={g ? 90 : 70} />} hint={<HintBone w={50} />}>
            {embed ? (
              range(n).map((i) => (
                // Mirrors FlagsPanel's FlagCardRow.
                <div key={i} style={{ padding: '12px 16px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Stack gap={2}>
                    <Line w={[170, 130, 200][i % 3]!} h={12} lh={19} />
                    <Line w={[200, 170, 150][i % 3]!} h={10} lh={18} />
                  </Stack>
                  {i % 3 === 0 ? (
                    <Row gap={8}>
                      <Bone w={34} h={20} r={999} />
                      <Line w={30} />
                    </Row>
                  ) : (
                    <Bone w="100%" h={36} />
                  )}
                  <Row gap={8}>
                    <Badge w={60} />
                    <Line w={[170, 210, 150][i % 3]!} h={10} lh={18} />
                  </Row>
                </div>
              ))
            ) : (
              <Table minWidth={980} label="Loading flags">
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
                <BoneRows
                  rows={n}
                  cells={(i) => [
                    <Stack key="f" gap={2}>
                      <Line w={[160, 130, 190][i % 3]!} h={12} lh={19} />
                      <Line w={[170, 150, 120][i % 3]!} h={10} lh={18} />
                      {i % 3 !== 2 && <Line w={60} h={10} lh={18} />}
                    </Stack>,
                    <Badge key="t" w={54} />,
                    <Line key="d" w={40} />,
                    <Line key="r" w={i % 2 ? 50 : 18} />,
                    <div key="v" style={{ minWidth: 220 }}>
                      <Bone w={i % 3 === 0 ? 56 : '100%'} h={i % 3 === 0 ? 20 : 32} r={i % 3 === 0 ? 999 : undefined} />
                    </div>,
                    <Badge key="s" w={60} />,
                    i === 1 ? <Bone key="x" w={46} h={28} /> : <span key="x" />,
                  ]}
                />
              </Table>
            )}
          </FlushCard>
        ))}
      </Stack>
    </Skeleton>
  );
}

// ----------------------------------------------------------- Remote Config --

export function RemoteConfigSkeleton() {
  const embed = useEmbed();
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
    <Skeleton label="Remote Config">
      <Stack as="section" gap={20}>
        <StatGrid min={170}>
          <Stat label="Last fetch" value={<Bone w={80} h={22} r={999} />} size="sm" note={<Line w={130} h={10} />} />
          <Stat label="Keys" value={<Bone w={28} h={22} />} size="sm" note={<Line w={100} h={10} />} />
          <Stat label="Minimum fetch interval" value={<Bone w={60} h={22} />} size="sm" />
          <Stat label="Fetch timeout" value={<Bone w={40} h={22} />} size="sm" />
        </StatGrid>
        <Row gap={10} wrap>
          <SearchBone />
          <Spacer />
          <ButtonBone w={140} />
        </Row>
        <Banner tone="neutral" title="Every key is also a flag">
          Remote Config keys are mirrored into Flags, under Firebase Remote Config, where you can override them. An override reaches only code that reads the key through Killcam.*Flag().
        </Banner>
        <FlushCard title="Values" hint={<HintBone w={50} />}>
          <ExpandableTable<Placeholder>
            label="Loading values"
            minWidth={embed ? 0 : 820}
            columns={columns}
            rows={placeholders(8)}
            rowKey={(r) => r.id}
            toggleLabel={() => 'Loading'}
            openKey={null}
            onToggle={() => undefined}
            detail={() => null}
            cells={(r) => {
              const i = Number(r.id);
              const key = <Line key="k" w={[170, 130, 210, 150][i % 4]!} h={13} />;
              const source = <Badge key="s" w={58} />;
              return embed
                ? [key, source]
                : [key, <Line key="v" w={[90, 220, 60, 160][i % 4]!} />, source, i % 4 === 1 ? <Badge key="o" w={70} /> : <Line key="o" w={12} />, <MiniButtonBone key="a" w={70} />];
            }}
          />
        </FlushCard>
      </Stack>
    </Skeleton>
  );
}

// ----------------------------------------------------------------- Actions --

/** The action cards, below the deep-link card that ActionsPanel always shows. */
export function ActionGroupsSkeleton() {
  return (
    <Skeleton label="actions">
      <Stack gap={28}>
        {[3, 2].map((n, g) => (
          <Stack key={g} as="section" gap={14}>
            <SectionTitle aside={<HintBone w={60} />}>
              <TitleBone w={g ? 60 : 80} />
            </SectionTitle>
            <Grid min={300} gap={12}>
              {range(n).map((i) => (
                <Card key={i}>
                  <Row gap={12} align="start">
                    <Stack gap={8} grow>
                      <TitleBone w={[130, 110, 150][i % 3]!} />
                      <Line w="80%" h={11} />
                    </Stack>
                    <ButtonBone w={52} />
                  </Row>
                  <div style={{ height: 22 }} />
                  <Line w={170} h={11} />
                </Card>
              ))}
            </Grid>
          </Stack>
        ))}
      </Stack>
    </Skeleton>
  );
}

export function ActionsSkeleton() {
  return (
    <Stack as="section" gap={28}>
      <Skeleton label="the deep-link launcher">
        <Card title="Open a deep link" hint="Starts the app’s handler for a URI, as if another app had opened it.">
          <Row gap={8}>
            <Bone w="100%" h={36} />
            <ButtonBone w={80} h={36} />
          </Row>
        </Card>
      </Skeleton>
      <ActionGroupsSkeleton />
    </Stack>
  );
}

// ---------------------------------------------------------------- Sessions --

export function SessionsSkeleton() {
  const embed = useEmbed();
  return (
    <Skeleton label="sessions">
      <Stack as="section" gap={20}>
        <Row gap={10} wrap>
          <SearchBone />
          <SegmentedBone segments={[40, 44, 90, 80]} />
          <Line w={100} />
        </Row>
        <FlushCard>
          {embed ? (
            // Mirrors SessionsPanel's list on the phone.
            range(4).map((i) => (
              <div key={i} style={{ padding: '12px 16px', borderTop: i ? '1px solid var(--line)' : undefined, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Row gap={8}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <Line w={[110, 200, 230, 170][i]!} h={13} lh={21} />
                  </span>
                  <Bone w={i ? 64 : 48} h={20} r={999} />
                </Row>
                <Line w={[240, 210, 190, 220][i]!} h={10} lh={18} />
                <Row gap={8}>
                  <ButtonBone w={i ? 52 : 64} />
                  {i > 0 && <IconBone size="lg" />}
                </Row>
              </div>
            ))
          ) : (
            <Table minWidth={1080} label="Loading sessions">
              <thead>
                <tr>
                  {/* Mirrors SessionsPanel's COLS. */}
                  <th>Session</th>
                  <th>Started</th>
                  <th className={numCell}>Length</th>
                  <th>Ended</th>
                  <th>App version</th>
                  <th className={numCell}>Screenshots</th>
                  <th className={numCell}>Events</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <BoneRows
                rows={6}
                cells={(i) => [
                  <Stack key="t" gap={6}>
                    <Line w={[150, 120, 170][i % 3]!} h={13} />
                    <Line w={90} h={10} />
                  </Stack>,
                  <Line key="st" w={110} />,
                  <div key="l" style={{ textAlign: 'right' }}>
                    <Line w={50} />
                  </div>,
                  <Badge key="e" w={i % 3 === 1 ? 64 : 48} />,
                  <Line key="v" w={70} />,
                  <div key="sh" style={{ textAlign: 'right' }}>
                    <Line w={20} />
                  </div>,
                  <div key="ev" style={{ textAlign: 'right' }}>
                    <Line w={26} />
                  </div>,
                  <Row key="a" gap={6}>
                    <MiniButtonBone w={56} />
                    <MiniButtonBone w={60} />
                    <IconBone />
                  </Row>,
                ]}
              />
            </Table>
          )}
        </FlushCard>
      </Stack>
    </Skeleton>
  );
}

// ----------------------------------------------------------------- Storage --

type StoreKind = 'prefs' | 'mmkv' | 'db' | 'files';
const STORE_LIST: Record<Exclude<StoreKind, 'files'>, string> = { prefs: 'Files', mmkv: 'Instances', db: 'Databases' };

/** A store list (preference files, MMKV instances, databases) beside the selected store. */
export function StoreSkeleton({ kind }: { kind: Exclude<StoreKind, 'files'> }) {
  return (
    <Skeleton label={STORE_LIST[kind].toLowerCase()}>
      <div className={s.storageLayout}>
        <FlushCard title={STORE_LIST[kind]} hint={<HintBone w={50} />}>
          {kind === 'db' && (
            <div className={s.storeGroupHead}>
              <Line w={90} h={12} />
              <Spacer />
              <Line w={40} h={10} />
            </div>
          )}
          {range(4).map((i) => (
            <div key={i} className={`${s.storeItem} ${kind === 'db' ? s.storeSub : ''}`}>
              <Bone w={14} h={14} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <Line w={[130, 110, 150, 90][i]!} h={12} lh={19} />
              </span>
              <Line w={kind === 'db' ? 44 : 50} h={10} />
            </div>
          ))}
        </FlushCard>
        {kind === 'db' ? (
          <Stack gap={14}>
            <Row gap={10} wrap>
              <Line w={120} h={17} />
              <Spacer />
              <SegmentedBone segments={[120, 76]} />
            </Row>
            <FlushCard title={<TitleBone w={100} />} hint={<HintBone w={130} />} aside={<Bone w={190} h={28} />}>
              <TableRowsTable />
            </FlushCard>
          </Stack>
        ) : (
          <EntriesCardSkeleton mmkv={kind === 'mmkv'} />
        )}
      </div>
    </Skeleton>
  );
}

/** Mirrors StoragePanel's EntriesCard: a prefs file's or MMKV instance's keys. */
function EntriesCardSkeleton({ mmkv }: { mmkv?: boolean }) {
  const embed = useEmbed();
  return (
    <FlushCard
      title={<TitleBone w={140} />}
      hint={<HintBone w={110} />}
      aside={
        <Row gap={8}>
          <IconBone outlined />
          <ButtonBone w={92} />
        </Row>
      }
    >
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Row>
          <SearchBone />
        </Row>
        {mmkv && (
          <Text variant="small" tone="muted">
            MMKV stores raw bytes, so each type is inferred from the stored size and content. Pick the right one when editing: it decides how the value is written.
          </Text>
        )}
      </div>
      {embed ? (
        range(5).map((i) => (
          <div key={i} className={s.entryRow}>
            <Row gap={8}>
              <Line w={[150, 120, 180, 100, 140][i]!} h={12} lh={19} />
              <Spacer />
              <IconBone size="lg" />
            </Row>
            <Bone w="100%" h={36} />
            <Badge w={50} />
          </div>
        ))
      ) : (
        <Table minWidth={720} label="Loading entries">
          <thead>
            <tr>
              <th>Key</th>
              <th>{mmkv ? 'Type (inferred)' : 'Type'}</th>
              <th>Value</th>
              {mmkv && <th className={numCell}>Size</th>}
              <th aria-label="Delete" />
            </tr>
          </thead>
          <BoneRows
            rows={6}
            cells={(i) => [
              <Line key="k" w={[150, 120, 180, 100][i % 4]!} h={12} lh={19} />,
              mmkv ? <Bone key="t" w={120} h={36} /> : <Badge key="t" w={50} />,
              // As StoragePanel: the value cell is at least 260 px, its editor fills it.
              <div key="v" style={{ minWidth: 260 }}>
                {i === 0 ? (
                  <Row gap={8}>
                    <Bone w={34} h={20} r={999} />
                    <Line w={30} />
                  </Row>
                ) : (
                  <Bone w="100%" h={36} />
                )}
              </div>,
              ...(mmkv
                ? [
                    <div key="z" style={{ textAlign: 'right' }}>
                      <Line w={40} />
                    </div>,
                  ]
                : []),
              <IconBone key="x" />,
            ]}
          />
        </Table>
      )}
    </FlushCard>
  );
}

/** One prefs file's or MMKV instance's keys, while the store list is already up. */
export function EntriesSkeleton({ mmkv }: { mmkv?: boolean }) {
  return (
    <Skeleton label="entries">
      <EntriesCardSkeleton mmkv={mmkv} />
    </Skeleton>
  );
}

function TableRowsTable() {
  return (
    <Table minWidth={640} density="dense" label="Loading rows">
      <thead>
        <tr>
          <th className={numCell}>#</th>
          {range(5).map((c) => (
            <th key={c}>
              <Line w={[70, 90, 60, 80, 70][c]!} h={10} />
            </th>
          ))}
        </tr>
      </thead>
      <BoneRows rows={10} cells={(i) => [<Line key="n" w={16} />, ...range(5).map((c) => <Line key={c} w={[60, 110, 40, 90, 70][(i + c) % 5]!} />)]} />
    </Table>
  );
}

/** A database table's rows, inside the table browser's card. */
export function TableRowsSkeleton() {
  return (
    <Skeleton label="rows">
      <TableRowsTable />
    </Skeleton>
  );
}

/** File rows inside the files table, while a folder is listed. */
export function FileRowsSkeleton() {
  const embed = useEmbed();
  return (
    <>
      {range(6).map((i) => (
        <tr key={i} aria-hidden="true">
          <td>
            <Row gap={8}>
              <Bone w={14} h={14} />
              <Line w={[120, 160, 90, 140, 110, 150][i]!} />
            </Row>
          </td>
          <td className={numCell}>
            <Line w={40} />
          </td>
          {!embed && (
            <td>
              <Line w={110} />
            </td>
          )}
          <td>
            <Row gap={4}>
              {i >= 4 && !embed && <Bone w={83} h={28} />}
              <IconBone size={embed ? 'lg' : 'md'} />
            </Row>
          </td>
        </tr>
      ))}
    </>
  );
}

/** Mirrors StoragePanel's FilesView: folder picker and path, then the folder's table. */
export function FilesSkeleton() {
  const embed = useEmbed();
  return (
    <Skeleton label="files">
      <Stack gap={14}>
        <Row gap={10} wrap>
          <Bone w={embed ? 250 : 200} h={36} />
          <Line w={embed ? 200 : 320} h={13} />
          <Spacer />
          <IconBone outlined />
        </Row>
        <FlushCard>
          <Table minWidth={embed ? 320 : 640} label="Loading files">
            <thead>
              <tr>
                <th>Name</th>
                <th className={numCell}>Size</th>
                {!embed && <th>Modified</th>}
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              <FileRowsSkeleton />
            </tbody>
          </Table>
        </FlushCard>
      </Stack>
    </Skeleton>
  );
}

/** A file's text, before it is fetched. */
export function TextLinesSkeleton({ lines = 10 }: { lines?: number }) {
  return (
    <Skeleton label="the file">
      <Stack gap={8} style={{ background: 'var(--con-bg)', border: '1px solid var(--line)', padding: '12px' }}>
        {widths(lines, ['70%', '45%', '85%', '60%', '30%', '75%']).map((w, i) => (
          <Bone key={i} console w={w} h={10} />
        ))}
      </Stack>
    </Skeleton>
  );
}

export function StorageSkeleton() {
  const embed = useEmbed();
  const p0 = useRoute().parts[0];
  const kind: StoreKind = p0 === 'db' || p0 === 'files' || p0 === 'mmkv' ? p0 : 'prefs';
  return (
    <Stack as="section" gap={20}>
      <Skeleton label="storage">
        <SegmentedBone segments={[embed ? 110 : 160, 64, 96, 56]} />
      </Skeleton>
      {kind === 'files' ? <FilesSkeleton /> : <StoreSkeleton kind={kind} />}
    </Stack>
  );
}

// --------------------------------------------------------- Detail panes --

/** A call's Overview tab, while the call is fetched. */
export function CallDetailSkeleton() {
  return (
    <Skeleton label="the call">
      <Stack gap={18}>
        <Row gap={8}>
          <Bone w={46} h={22} r={999} />
          <Method />
        </Row>
        <Line w="80%" h={13} />
        {[6, 3].map((n, g) => (
          <Stack key={g} gap={0}>
            <Line w={g ? 60 : 70} h={15} />
            <div style={{ height: 8 }} />
            {range(n).map((i) => (
              <div key={i} className={s.detailRow}>
                <Line w={80} h={11} />
                <Line w={[120, 160, 90, 140, 70, 110][i % 6]!} h={11} />
              </div>
            ))}
          </Stack>
        ))}
      </Stack>
    </Skeleton>
  );
}

/** A crash's stack trace block, while it is fetched. */
export function StackTraceSkeleton() {
  return (
    <Skeleton label="the stack trace">
      <Stack gap={0} style={{ background: 'var(--con-bg)', border: '1px solid var(--line)', padding: '10px 0' }}>
        {widths(12, ['70%', '58%', '64%', '52%', '48%', '60%']).map((w, i) => (
          <div key={i} className={s.consoleLine}>
            <Bone console w={i === 0 ? '85%' : w} h={10} />
          </div>
        ))}
      </Stack>
    </Skeleton>
  );
}

// ------------------------------------------------------------ By route --

const BY_PANEL: Record<Panel, () => ReactNode> = {
  replay: () => <ReplaySkeleton />,
  network: () => <NetworkSkeleton />,
  logs: () => <LogsSkeleton />,
  crashes: () => <CrashesSkeleton />,
  mocks: () => <MocksSkeleton />,
  endpoints: () => <EndpointsSkeleton />,
  flags: () => <FlagsSkeleton />,
  'remote-config': () => <RemoteConfigSkeleton />,
  actions: () => <ActionsSkeleton />,
  sessions: () => <SessionsSkeleton />,
  storage: () => <StorageSkeleton />,
};

/** The shell's Suspense fallback: the skeleton of the page whose code is loading. */
export function RouteSkeleton({ panel }: { panel: Panel }) {
  return <>{BY_PANEL[panel]()}</>;
}
