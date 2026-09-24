/**
 * Killcam wire contract.
 *
 * This file is the single source of truth for the JSON the on-device server
 * speaks. The Kotlin models in killcam-core (`com.krafton.killcam.core.model`)
 * mirror it field for field; change both together. docs/API.md lists the
 * endpoints that return these shapes.
 *
 * Conventions:
 *  - Timestamps are epoch milliseconds (`number`).
 *  - `seq` is a process-wide monotonically increasing counter shared by every
 *    stream, so events from different panels can be ordered and diffed.
 *  - Nullable fields are always present and set to `null`, never omitted.
 */

export type Millis = number;

export interface Header {
  name: string;
  value: string;
}

export interface KeyValue {
  label: string;
  value: string;
}

// ---------------------------------------------------------------- info -----

export interface InfoSection {
  title: string;
  items: KeyValue[];
}

export interface AppInfo {
  appName: string;
  packageName: string;
  versionName: string;
  versionCode: number;
  buildType: string;
  deviceName: string; // "Pixel 8 · Android 15"
  sessionId: string;
  sessionStartMs: Millis;
  killcamVersion: string;
  /** Device, runtime and app-provided extras, rendered as-is by the Device panel. */
  sections: InfoSection[];
}

export interface KillcamStatus {
  capturePaused: boolean;
  wifiEnabled: boolean;
  /** e.g. "http://192.168.1.23:8090" when Wi-Fi sharing is on, else null. */
  wifiUrl: string | null;
  /** True when the current request came over Wi-Fi and had to present the PIN. */
  remote: boolean;
  port: number;
}

// ------------------------------------------------------------- network -----

export type CallState = 'pending' | 'complete' | 'failed';

export interface NetworkSummary {
  id: string;
  seq: number;
  startMs: Millis;
  durationMs: number | null;
  method: string;
  url: string;
  scheme: string;
  host: string;
  /** Path including the query string. */
  path: string;
  status: number | null;
  state: CallState;
  error: string | null;
  requestSize: number;
  responseSize: number;
  /** Response content type, without parameters (e.g. "application/json"). */
  contentType: string | null;
  /** Id of the mock rule that produced or altered this call, if any. */
  mockRuleId: string | null;
  /** Which integration captured it: "okhttp" | "manual" | ... */
  source: string;
  /** Screen that was visible when the call started. */
  screen: string | null;
}

export interface HttpBody {
  /** Decoded text for textual content types, else null. */
  text: string | null;
  /** Base64 for binary content, else null. */
  base64: string | null;
  size: number;
  truncated: boolean;
  contentType: string | null;
}

export interface NetworkCall extends NetworkSummary {
  protocol: string | null;
  responseMessage: string | null;
  requestHeaders: Header[];
  requestBody: HttpBody | null;
  responseHeaders: Header[];
  responseBody: HttpBody | null;
}

// ---------------------------------------------------------------- logs -----

export type LogLevel = 'V' | 'D' | 'I' | 'W' | 'E' | 'A';

/** `log` = Killcam.log, `event` = analytics event, `logcat` = captured process logcat. */
export type LogKind = 'log' | 'event' | 'logcat';

export interface LogEntry {
  id: string;
  seq: number;
  ts: Millis;
  level: LogLevel;
  tag: string;
  message: string;
  throwable: string | null;
  kind: LogKind;
  attributes: Record<string, string>;
  thread: string | null;
  screen: string | null;
}

// ------------------------------------------------------------- crashes -----

export interface CrashSummary {
  id: string;
  seq: number;
  ts: Millis;
  fatal: boolean;
  exception: string; // fully-qualified class name
  message: string | null;
  thread: string;
  screen: string | null;
  /** The session the crash happened in; open its replay with /api/sessions/{sessionId}. */
  sessionId: string;
}

export interface Crash extends CrashSummary {
  stackTrace: string;
}

// ------------------------------------------------------------ timeline -----

export type TimelineType =
  | 'screen' // label = screen name
  | 'tap' // data: x, y (0..1 of screen), gesture ('tap' | 'swipe' | 'long_press'), target (string | null), x2, y2 for swipes
  | 'lifecycle' // label = "foreground" | "background" | "Activity.onCreate" ...
  | 'screenshot' // screenshotId set; data: width, height
  | 'mark' // bookmark added by a tester
  | 'custom'; // app-defined (Killcam traces, deep links, flag changes ...)

export interface TimelineEvent {
  id: string;
  seq: number;
  ts: Millis;
  type: TimelineType;
  label: string;
  screen: string | null;
  screenshotId: string | null;
  data: Record<string, string | number | boolean | null>;
}

// ------------------------------------------------------------ sessions -----

export type SessionReason = 'live' | 'crash' | 'manual';

export interface SessionSummary {
  id: string;
  label: string | null;
  startMs: Millis;
  endMs: Millis | null;
  live: boolean;
  reason: SessionReason;
  crash: CrashSummary | null;
  appVersion: string;
  screenshotCount: number;
  eventCount: number;
}

/** Everything needed to render Network, Logs, Crashes and Replay offline. */
export interface SessionBundle {
  session: SessionSummary;
  app: AppInfo;
  network: NetworkCall[];
  logs: LogEntry[];
  crashes: Crash[];
  timeline: TimelineEvent[];
}

// --------------------------------------------------------------- mocks -----

export type MatchType = 'contains' | 'exact' | 'glob' | 'regex';
export type MockAction = 'respond' | 'delay' | 'fail' | 'breakpoint';
export type BreakOn = 'request' | 'response' | 'both';
export type MockFailure =
  | 'timeout'
  | 'no_network'
  | 'connection_reset'
  | 'dns_failure'
  | 'connection_refused'
  | 'connect_timeout'
  | 'ssl_handshake'
  | 'network_switch'
  | 'unexpected_eof';

export interface MockRule {
  id: string;
  name: string;
  enabled: boolean;
  /** null matches any method. */
  method: string | null;
  urlPattern: string;
  matchType: MatchType;
  action: MockAction;
  /** respond: status, headers, body. delay: delayMs then real call. fail: failure after delayMs. */
  status: number;
  headers: Header[];
  body: string;
  delayMs: number;
  failure: MockFailure;
  hits: number;
  createdMs: Millis;
  /** network_switch: body bytes delivered before the connection drops. */
  dropAfterBytes: number;
  /** Applies to the first `times` matches only (0 = always); used-up rules let calls through. */
  times: number;
  /** Percent (1..100) of matching calls the rule applies to; the rest fall through. */
  probability: number;
  /** Catalog endpoint key the rule targets (its match was copied from it). */
  endpoint: string | null;
  /** breakpoint: where matching calls pause. */
  breakOn: BreakOn;
}

/**
 * What POST /api/mocks and PUT /api/mocks/{id} accept. With `endpoint` set, the
 * device fills method (unless given), urlPattern and matchType from the catalog.
 */
export type MockRuleInput = Omit<MockRule, 'id' | 'hits' | 'createdMs'>;

// -------------------------------------------------- network conditions -----

export type NetworkProfile = 'off' | 'gprs' | '2g' | 'slow_3g' | 'fast_3g' | '4g' | 'flaky_wifi' | 'offline' | 'custom';

/** Applied to every intercepted call, mocked or not. Rates in kbps; 0 = unlimited. */
export interface NetworkConditions {
  profile: NetworkProfile;
  latencyMs: number;
  jitterMs: number;
  downloadKbps: number;
  uploadKbps: number;
  /** Percent of calls that fail as a lost connection. */
  lossPercent: number;
  /** Every call fails DNS resolution. */
  offline: boolean;
}

/**
 * PUT /api/network-conditions. A preset `profile` (not custom) ignores the other
 * fields; otherwise they describe custom conditions and missing ones are 0.
 */
export type NetworkConditionsInput = Partial<NetworkConditions>;

/** GET /api/network-conditions/presets */
export interface NetworkPreset {
  profile: NetworkProfile;
  label: string;
  description: string;
  conditions: NetworkConditions;
}

// ------------------------------------------------------------ endpoints -----

export type EndpointSource = 'repo' | 'code' | 'dashboard';

/** GET /api/endpoints: the app's named APIs, merged from the repo file, code and the dashboard. */
export interface Endpoint {
  key: string;
  name: string | null;
  method: string | null;
  urlPattern: string;
  matchType: MatchType;
  /** Top-level group: given, or the key's first path segment. */
  group: string;
  description: string | null;
  source: EndpointSource;
  /** Not in the repo catalog yet: goes out with the next export. */
  unexported: boolean;
}

/** PUT /api/endpoints, and one entry of killcam-endpoints.json. */
export interface EndpointInput {
  key: string;
  name?: string | null;
  method?: string | null;
  urlPattern?: string | null;
  matchType?: MatchType;
  group?: string | null;
  description?: string | null;
}

// --------------------------------------------------------------- repeat -----

export interface RequestEdit {
  method?: string | null;
  url?: string | null;
  headers?: Header[] | null;
  body?: string | null;
}

/** POST /api/network/{id}/repeat */
export interface RepeatRequest {
  count: number;
  concurrent: boolean;
  edit?: RequestEdit | null;
}

// ---------------------------------------------------------- breakpoints -----

export interface PausedCall {
  id: string;
  callId: string | null;
  ruleId: string;
  ruleName: string;
  stage: 'request' | 'response';
  pausedMs: Millis;
  /** Continues unchanged by itself at this time. */
  deadlineMs: Millis;
  method: string;
  url: string;
  requestHeaders: Header[];
  requestBody: string | null;
  requestBodyEditable: boolean;
  status: number | null;
  responseHeaders: Header[];
  responseBody: string | null;
  responseBodyEditable: boolean;
}

/** POST /api/breakpoints/{id}. Null/absent fields keep the original. */
export interface ResumeRequest {
  action: 'continue' | 'fail';
  failure?: MockFailure;
  method?: string;
  url?: string;
  status?: number;
  headers?: Header[];
  body?: string;
}

// --------------------------------------------------------------- flags -----

export type FlagType = 'boolean' | 'string' | 'int' | 'double' | 'json';
export type FlagSource = 'default' | 'remote' | 'override';

export interface Flag {
  key: string;
  type: FlagType;
  description: string | null;
  group: string | null;
  /** All values are strings on the wire: "true", "42", "3.5", "{...}". */
  defaultValue: string;
  remoteValue: string | null;
  override: string | null;
  /** Effective value = override ?? remoteValue ?? defaultValue. */
  value: string;
  source: FlagSource;
  /** Allowed values for enum-like string flags, else null. */
  options: string[] | null;
}

// ------------------------------------------------------------- storage -----

export interface PrefFile {
  name: string;
  entryCount: number;
  sizeBytes: number;
}

export type PrefType = 'string' | 'boolean' | 'int' | 'long' | 'float' | 'string_set';

export interface PrefEntry {
  key: string;
  type: PrefType;
  /** string_set values are a JSON array string: '["a","b"]'. */
  value: string;
}

export interface DbTable {
  name: string;
  type: 'table' | 'view';
  rowCount: number | null;
}

export interface DbInfo {
  name: string;
  path: string;
  sizeBytes: number;
  tables: DbTable[];
}

export type Cell = string | number | null;

export interface QueryResult {
  columns: string[];
  rows: Cell[][];
  /** Rows available for a table browse (for pagination); null for ad-hoc SQL. */
  totalRows: number | null;
  /** Set for INSERT/UPDATE/DELETE statements. */
  affectedRows: number | null;
  truncated: boolean;
  elapsedMs: number;
  error: string | null;
}

export interface FileRoot {
  id: string; // "files" | "cache" | "databases" | "shared_prefs" | "external" ...
  label: string;
  path: string; // absolute device path, informational
}

export interface FileEntry {
  name: string;
  /** Path relative to the root, "/"-separated, no leading slash. */
  path: string;
  dir: boolean;
  size: number;
  modifiedMs: Millis;
}

// ---------------------------------------------------------------- mmkv -----

/**
 * MMKV stores raw bytes without a type, so `type` is inferred from the
 * encoded size and content (see docs/API.md). Edits send an explicit type.
 */
export type MmkvValueType = 'string' | 'bool' | 'int' | 'long' | 'float' | 'double' | 'bytes';

export interface MmkvInstance {
  id: string; // "mmkv.default" or an id the app registered
  keyCount: number;
  sizeBytes: number;
  encrypted: boolean;
  /** Set when the instance could not be opened; keyCount is then 0. */
  error: string | null;
}

export interface MmkvEntry {
  key: string;
  type: MmkvValueType;
  /** Human-readable value; bytes are base64. */
  value: string;
  sizeBytes: number;
}

// ------------------------------------------------------- remote config -----

export type RemoteConfigSource = 'remote' | 'default' | 'static';
export type RemoteConfigFetchStatus = 'success' | 'failure' | 'throttled' | 'no_fetch_yet';

export interface RemoteConfigValue {
  key: string;
  value: string;
  source: RemoteConfigSource;
  /**
   * Every Remote Config key is mirrored into Flags (group "Firebase Remote
   * Config"); this is the Killcam override set there, if any. Overrides reach
   * the app only where it reads the key through Killcam.*Flag().
   */
  flagOverride: string | null;
}

export interface RemoteConfigInfo {
  fetchStatus: RemoteConfigFetchStatus;
  lastFetchMs: Millis | null;
  minimumFetchIntervalSeconds: number;
  fetchTimeoutSeconds: number;
  values: RemoteConfigValue[];
}

// ------------------------------------------------------------- actions -----

export interface ActionInfo {
  id: string;
  label: string;
  description: string | null;
  group: string | null;
}

export interface ActionResult {
  ok: boolean;
  message: string | null;
}

// ----------------------------------------------------------------- live -----

/**
 * Server-sent events on GET /api/live. `event:` is the key, `data:` the JSON.
 * On (re)connect the client should refetch snapshots; `hello` marks a fresh stream.
 */
export interface LiveEvents {
  hello: { sessionId: string; seq: number };
  network: NetworkSummary; // upsert by id (pending -> complete)
  log: LogEntry;
  crash: CrashSummary;
  timeline: TimelineEvent;
  mocks: MockRule[]; // full list after any change
  conditions: NetworkConditions;
  endpoints: Endpoint[]; // full list after any change
  breakpoints: PausedCall[]; // calls held right now
  flags: Flag[]; // full list after any change
  status: KillcamStatus;
  cleared: { stream: 'network' | 'logs' | 'crashes' | 'timeline' | 'all' };
}

export interface ApiError {
  error: string;
}
