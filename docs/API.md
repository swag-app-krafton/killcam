# Killcam HTTP API

The debug build hosts this API and the dashboard on one port (default `8090`).
Response shapes are defined in [`dashboard/src/api/types.ts`](../dashboard/src/api/types.ts);
the Kotlin models in `killcam-core` mirror them.

All paths are relative to the server root. The dashboard uses relative URLs so it
works both when served from the device and behind the Vite dev proxy.

## Access rules

| Rule | Why |
|---|---|
| Requests arriving on loopback (`adb forward`, the in-app window) need no auth. | USB access already implies device control. |
| Requests from any other address are refused unless Wi-Fi sharing is on, and then need the `killcam_token` cookie from `POST /api/auth`. | Keeps payment data off the LAN by default. |
| `Host` must be `localhost`, `127.0.0.1`, `[::1]` or an IP literal. | Blocks DNS-rebinding from a web page in the tester's browser. |
| Every non-GET request must send `X-Killcam: 1`. | A custom header forces a CORS preflight, which the server never approves, so other origins cannot write. |

Failures return `{ "error": "..." }` with `401` (`pin_required`), `403`, `404` or `400`.

## Endpoints

### Session and status
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/info` | | `AppInfo` |
| GET | `/api/status` | | `KillcamStatus` |
| POST | `/api/auth` | `{ pin }` | `204` + `Set-Cookie`, or `401` |
| POST | `/api/capture` | `{ paused: boolean }` | `KillcamStatus` |
| DELETE | `/api/data?stream=network\|logs\|crashes\|timeline\|all` | | `204` |
| GET | `/api/live` | | `text/event-stream`, see `LiveEvents` |

### Network
| Method | Path | Returns |
|---|---|---|
| GET | `/api/network` | `NetworkSummary[]`, oldest first |
| GET | `/api/network/{id}` | `NetworkCall` |
| GET | `/api/network/{id}/curl` | `text/plain` cURL command |
| GET | `/api/network.har` | HAR 1.2 of the live session |
| POST | `/api/network/{id}/repeat` | Body `RepeatRequest` (`{ count: 1..50, concurrent, edit? }`); returns `{ started }` |

Repeat re-sends the call through the app's own OkHttp client (`Call.clone()`), so its
auth and interceptors run, and so do mocks, conditions and breakpoints. Repeats are
captured with `source: "repeat"`. The app never sees their responses. `edit` (a
`RequestEdit`) changes the method, URL, headers or body first; a header sent back as
`██ redacted` keeps its real value. It fails with `409 not_repeatable` for calls older
than the last 300, or for a one-shot body when no edited body is given.

### Logs and crashes
| Method | Path | Returns |
|---|---|---|
| GET | `/api/logs` | `LogEntry[]`, oldest first |
| GET | `/api/crashes` | `CrashSummary[]`: this session plus crashes saved from earlier ones, newest first |
| GET | `/api/crashes/{id}` | `Crash` |

### Timeline, screenshots, sessions (Killcam replay)
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/timeline` | | `TimelineEvent[]`, oldest first |
| POST | `/api/timeline/mark` | `{ label }` | `TimelineEvent` |
| POST | `/api/screenshot` | | `TimelineEvent` or `204` if nothing could be captured |
| GET | `/api/sessions` | | `SessionSummary[]`, live session first, then saved newest first |
| POST | `/api/sessions` | `{ label }` | `SessionSummary`, a snapshot of the live session saved to disk |
| GET | `/api/sessions/{id}` | | `SessionBundle` (`live` works too) |
| DELETE | `/api/sessions/{id}` | | `204` |
| GET | `/api/sessions/{id}/screenshots/{screenshotId}` | | `image/jpeg` |
| GET | `/api/sessions/{id}/export` | | `application/zip` bug bundle: `session.json`, `network.har`, `screenshots/*.jpg` |

`{id}` may be the literal `live` for the current session.

### Mocks
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/mocks` | | `MockRule[]` |
| POST | `/api/mocks` | `MockRuleInput` | `MockRule` |
| PUT | `/api/mocks/{id}` | `MockRuleInput` | `MockRule` |
| DELETE | `/api/mocks/{id}` | | `204` |
| PUT | `/api/mocks` | `string[]`, every rule id in the new order | `MockRule[]` |
| POST | `/api/mocks/{id}/reset` | | `MockRule` with `hits: 0` (re-arms a rule limited by `times`) |

Rules are evaluated in list order; the first enabled match wins. A rule with
`times > 0` stops matching after that many hits, and a rule with `probability < 100`
applies to only that share of matching calls. Either way, a skipped call falls
through to later rules, then to the real network. With `endpoint` set to a catalog key,
the device fills `method` (unless given), `urlPattern` and `matchType` from that endpoint.

`action: "fail"` takes a `failure`. Each one throws the exception Android throws, with the same wording:

| `failure` | Exception | Reproduces |
|---|---|---|
| `dns_failure` | `UnknownHostException: Unable to resolve host "<host>": No address associated with hostname` | No connectivity; DNS lost after a network switch |
| `network_switch` | Headers arrive, then after `dropAfterBytes` of body: `SocketException: Software caused connection abort` | Wi-Fi ↔ mobile data mid-download |
| `connection_refused` | `ConnectException: Failed to connect to <host>/<port>` | Server down, port closed |
| `connect_timeout` | `SocketTimeoutException: failed to connect to … after 10000ms` | Unreachable host, captive portal |
| `timeout` | `SocketTimeoutException: timeout` | Read timeout: server too slow |
| `connection_reset` | `SocketException: Connection reset` | Peer or middlebox killed the socket |
| `unexpected_eof` | `IOException: unexpected end of stream on <redacted url>` | Server closed a reused connection |
| `ssl_handshake` | `SSLHandshakeException` | Pinning or TLS failure |
| `no_network` | Same as `dns_failure` | Kept for older rules |

`action: "breakpoint"` pauses matching calls at `breakOn`: `request` (before sending),
`response` (before the app reads the body) or `both`. See Breakpoints below.

### Network conditions
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/network-conditions` | | `NetworkConditions` |
| GET | `/api/network-conditions/presets` | | `NetworkPreset[]` |
| PUT | `/api/network-conditions` | `NetworkConditionsInput` | `NetworkConditions` |
| DELETE | `/api/network-conditions` | | `NetworkConditions` (off) |

These conditions apply to every call through `KillcamInterceptor`, mocked or not:

- **Latency and jitter** delay each call.
- **Download and upload caps** (kbps, 0 = unlimited) pace the bodies.
- **Loss** fails that percentage of calls with a timeout or a connection reset.
- **Offline** fails every call as `dns_failure`.

A preset `profile` (`gprs`, `2g`, `slow_3g`, `fast_3g`, `4g`, `flaky_wifi`, `offline`,
`off`) ignores the other fields; `custom` or no profile takes the fields as given.
The setting survives app restarts. Every change is added to the replay timeline
(`Network: Slow 3G`) and pushed as the `conditions` live event. Traffic that bypasses
OkHttp (WebViews, other HTTP stacks, raw sockets) is not affected.

### Endpoint catalog
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/endpoints` | | `Endpoint[]`, grouped then sorted by key |
| PUT or POST | `/api/endpoints` | `EndpointInput` | `Endpoint` (added or replaced on this device) |
| DELETE | `/api/endpoints?key=` | | `204`; only endpoints added from the dashboard |
| GET | `/api/endpoints/export[?download=1]` | | The merged catalog as a pretty `killcam-endpoints.json` |

The catalog merges three layers by key, later winning:

1. `killcam-endpoints.json` shipped as a debug asset (`KillcamConfig.endpointsAsset`).
2. `Killcam.registerEndpoint` in code.
3. Endpoints added from the dashboard, which are stored on the device.

`unexported: true` marks endpoints that differ from the repo file. Export the catalog,
or run `scripts/pull-endpoints.sh <path>`, and commit the file to share them. The file
format is `{ "version": 1, "endpoints": [EndpointInput, …] }`. `urlPattern` defaults to
the key (matched as "contains"), and `group` defaults to the key's first path segment.

### Breakpoints
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/breakpoints` | | `PausedCall[]`, oldest first |
| POST | `/api/breakpoints/{id}` | `ResumeRequest` | `204`, or `404` if it already resumed or timed out |
| POST | `/api/breakpoints/resume-all` | | `204`; every held call continues unchanged |

A paused call blocks the app's request thread until it is resumed. It also ends when the
call is cancelled, or after 2 minutes, when it continues unchanged.

- `{"action":"continue"}` continues the call. Optional `method`, `url`, `headers` and `body` edit the request at the `request` stage. Optional `status`, `headers` and `body` edit the response at the `response` stage. Response bodies up to 1 MB can be edited, if not compressed.
- `{"action":"fail","failure":"…"}` throws that failure instead.

The `breakpoints` live event carries the full list after every change.

#### From test automation

With `adb forward tcp:8090 tcp:8090`, a test script (Maestro, Appium, a shell step) can set up a scenario before a step:

```bash
K=http://localhost:8090/api; H=(-H 'X-Killcam: 1' -H 'Content-Type: application/json')

curl "${H[@]}" -X PUT  $K/network-conditions -d '{"profile":"slow_3g"}'
curl "${H[@]}" -X PUT  $K/network-conditions -d '{"latencyMs":800,"downloadKbps":64,"lossPercent":10}'
curl "${H[@]}" -X DELETE $K/network-conditions

# Pay fails DNS once; the app's retry reaches the server (targets a catalog endpoint by key)
curl "${H[@]}" -X POST $K/mocks -d '{"name":"","urlPattern":"","endpoint":"/v1/upi/pay","action":"fail","failure":"dns_failure","times":1}'

# Transaction list download drops after 2 KB
curl "${H[@]}" -X POST $K/mocks -d '{"name":"txn switch","urlPattern":"/v1/transactions","action":"fail","failure":"network_switch","dropAfterBytes":2048}'

# 30% of home calls get a 503 with Retry-After
curl "${H[@]}" -X POST $K/mocks -d '{"name":"flaky home","urlPattern":"/v1/home","status":503,"probability":30,"headers":[{"name":"Retry-After","value":"30"}],"body":"{\"error\":\"maintenance\"}"}'
```

### Feature flags
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/flags` | | `Flag[]` |
| PUT | `/api/flags` | `{ key, value }` | `Flag` (sets an override) |
| DELETE | `/api/flags?key=...` | | `204` (clears one override; no `key` clears all) |

### Storage
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/prefs` | | `PrefFile[]` |
| GET | `/api/prefs/{file}` | | `PrefEntry[]` |
| PUT | `/api/prefs/{file}` | `PrefEntry` | `PrefEntry` (create or replace) |
| DELETE | `/api/prefs/{file}?key=...` | | `204` |
| GET | `/api/db` | | `DbInfo[]` |
| GET | `/api/db/{name}/tables/{table}?offset=0&limit=50&orderBy=col&desc=true` | | `QueryResult` |
| POST | `/api/db/{name}/query` | `{ sql }` | `QueryResult` (errors come back in `error`, status 200) |
| GET | `/api/files/roots` | | `FileRoot[]` |
| GET | `/api/files?root=files&path=sub/dir` | | `FileEntry[]`, directories first |
| GET | `/api/files/content?root=...&path=...[&download=1]` | | raw bytes |
| DELETE | `/api/files?root=...&path=...` | | `204` |

### MMKV
Only the default instance (once the app has called `MMKV.initialize`) and ids the
app registered with `Killcam.registerMmkv(id, cryptKey)` are opened. Opening an
encrypted store without its key makes MMKV's CRC check fail and discard the file,
so Killcam never scans the MMKV directory for other stores. For react-native-mmkv
stores use Rozenite's `@rozenite/storage-plugin` (see rozenite-plugin/README.md).

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/mmkv` | | `MmkvInstance[]` (`501 mmkv_unavailable` without com.tencent:mmkv) |
| GET | `/api/mmkv/{id}` | | `MmkvEntry[]` |
| PUT | `/api/mmkv/{id}` | `{ key, type, value }` | `MmkvEntry` |
| DELETE | `/api/mmkv/{id}?key=...` | | `204` |

Type inference: MMKV stores no types, so Killcam infers one from the encoded size and content. Length-prefixed
valid UTF-8 → `string`, other length-prefixed → `bytes` (base64), 1 byte 0/1 → `bool`,
8 bytes → `double` (react-native-mmkv numbers), 4 bytes → `float`, else varint `long`.

### Firebase Remote Config
Works whenever the app has firebase-config and a default FirebaseApp. Every key is
also mirrored into Flags (group `Firebase Remote Config`, remote value = the fetched
value), so testers override through the existing Flags API.

| Method | Path | Returns |
|---|---|---|
| GET | `/api/remote-config` | `RemoteConfigInfo` (`501 remote_config_unavailable`) |
| POST | `/api/remote-config/fetch` | `RemoteConfigInfo` after fetch (min interval 0) + activate |

### Actions
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/actions` | | `ActionInfo[]` |
| POST | `/api/actions/{id}` | | `ActionResult` |
| POST | `/api/deeplink` | `{ uri }` | `ActionResult` |

### Static
`GET /` serves `index.html`, and `GET /assets/*` serves the built dashboard.
Any other non-`/api` path falls back to `index.html`.

## In-app native bridge

Inside the Android in-app window (`?embed=1`) the page also gets
`window.KillcamNative`. It is never present in a desktop browser, so feature-detect it.
Only the dashboard served by the local server is ever loaded in that WebView.

| Method | Does |
|---|---|
| `close()` | Dismisses the in-app window |
| `shareBundle()` | Zips the live session and opens the Android share sheet |
| `getConnection(): string` | JSON `{ port, usbCommand, wifiEnabled, wifiUrl, pin }` |
| `setWifiSharing(enabled)` | Rebinds the server; fires `killcam-native` `{type:"connection"}` on `window` when done |
| `setChrome(background, light)` | Paints the status/navigation bar strips to match the page theme |
| `copy(text)` | Native clipboard |
