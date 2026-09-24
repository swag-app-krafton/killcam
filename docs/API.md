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

Rules are evaluated in list order; the first enabled match wins.

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
