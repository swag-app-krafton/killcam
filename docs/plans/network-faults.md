# Plan: network conditions and fault injection

Status: implemented on `feature/network-fault-injection`.

## Why

Testers need to reproduce the bugs that only happen on bad networks: a payment
screen that hangs on 2G, a retry loop that never succeeds, a crash when the
connection drops halfway through a response, a spinner that never stops when DNS
fails after switching from Wi-Fi to mobile data. Today, Mocks can already
return a canned response, add a fixed delay, or throw one of three errors
(`timeout`, `no_network`, `connection_reset`). That covers single calls, but not
a slow network overall, or failures that only happen some of the time.

## What exists today (baseline)

| Piece | Where | Does |
|---|---|---|
| `MockEngine` | killcam-core `mock/MockEngine.kt` | Ordered rules; first enabled match wins; persisted to `mocks.json` |
| `KillcamInterceptor` | killcam `KillcamInterceptor.kt` | Applies the matched rule: `respond`, `delay`, or `fail` (3 exception types) |
| Mocks panel | dashboard `panels/MocksPanel.tsx` | Create, edit, reorder and toggle rules |
| HTTP API | `/api/mocks` | CRUD, already usable from `curl`, Maestro, Appium and so on |

## Requirements

### R1. Network conditions (global throttling)
Applies to every call that goes through `KillcamInterceptor`, mocked or not.

| Setting | Meaning |
|---|---|
| `latencyMs` | Added before each request goes out (round-trip latency) |
| `jitterMs` | Random extra latency, uniform between 0 and `jitterMs` |
| `downloadKbps` | Response body read rate cap; 0 = unlimited |
| `uploadKbps` | Request body write rate cap; 0 = unlimited |
| `lossPercent` | Chance (0–100) that a call fails as a lost connection (`SocketTimeoutException` or `SocketException: Connection reset`) |
| `offline` | Every call fails as DNS failure (`UnknownHostException`), the way a phone with no connectivity behaves |

- **Presets:** Off, GPRS, 2G (EDGE), Slow 3G, Fast 3G, 4G, Flaky Wi-Fi, Offline, and Custom. The core defines them, so the dashboard, Kotlin API and HTTP API agree.
- **Persistence:** the setting survives restarts, like mocks, so a cold start can be reproduced. While conditions are active, the dashboard shows a banner, so nobody forgets a device is throttled.
- **Replay:** every change adds a timeline event (`Network: Slow 3G`), so a bug bundle shows the conditions it was recorded under.
- **Scope:** only traffic through `KillcamInterceptor` (OkHttp, Ktor-on-OkHttp, React Native fetch). WebViews, Glide/Coil on other clients, and native sockets are not affected. This is stated in the docs.

### R2. More failure types for mock rules (`action: fail`)

| `failure` | Throws | Reproduces |
|---|---|---|
| `timeout` (existing) | `SocketTimeoutException: timeout` | Read timeout: server too slow |
| `no_network` (existing) | `UnknownHostException` | No connectivity |
| `connection_reset` (existing) | `SocketException: Connection reset` | Server or middlebox killed the socket |
| `dns_failure` | `UnknownHostException: Unable to resolve host "<host>": No address associated with hostname` | DNS can't resolve (exact Android message) |
| `connection_refused` | `ConnectException: Failed to connect to <host>` | Server down, port closed |
| `connect_timeout` | `SocketTimeoutException: failed to connect to <host> after 10000ms` | Unreachable host, captive portal |
| `ssl_handshake` | `SSLHandshakeException` | Cert pinning or TLS failure, corporate proxy |
| `network_switch` | Real call proceeds; the response body throws `SocketException: Software caused connection abort` after `dropAfterBytes` bytes | Wi-Fi ↔ mobile data switch mid-download (ECONNABORTED) |
| `unexpected_eof` | `IOException: unexpected end of stream on <url>` | Server closed a keep-alive connection; half-sent response |

- New rule field `dropAfterBytes`, used by `network_switch`. The default of 0 drops right after the headers arrive.

### R3. Intermittent rules (flaky backends, retry logic)
New fields on every rule:

- `times`: the rule applies to the first N matches only, then lets calls through (0 = always). For example, "fail the first attempt, succeed on the retry".
- `probability`: the percentage of matching calls the rule applies to (1–100, default 100). A call the rule skips falls through to the next rule, or to the real network.
- `hits` still counts applied matches, and the panel shows `2 / 3` for a rule with `times`.
- A button re-arms a rule by resetting its hits.

### R4. API-error templates (dashboard)
One click fills a `respond` rule with a realistic error:

| Template | Status and body |
|---|---|
| Server error | 500 JSON error |
| Service unavailable | 503 + `Retry-After: 30` |
| Rate limited | 429 + `Retry-After: 10` |
| Session expired | 401 `{"error":"token_expired"}` |
| Gateway error page | 502 `text/html` (the non-JSON body that breaks parsers) |
| Malformed JSON | 200 with a truncated JSON body |
| Empty body | 200 with an empty body |
| Gateway timeout | 504 after 30 s |

### R5. Programmatic API ("input APIs")
**Kotlin**, which also exists in `killcam-no-op` as no-ops:
```kotlin
Killcam.setNetworkProfile(KillcamNetworkProfile.Slow3g)
Killcam.setNetworkConditions(latencyMs = 800, downloadKbps = 64, lossPercent = 10)
Killcam.clearNetworkConditions()

val id = Killcam.failRequests("/v1/upi/pay", KillcamFailure.DnsFailure, times = 1)
Killcam.mockResponse("/v1/home", status = 503, body = """{"error":"maintenance"}""", times = 2)
Killcam.removeMock(id)
```

**HTTP**, for test automation over `adb forward`:
```
GET  /api/network-conditions                  -> NetworkConditions
PUT  /api/network-conditions  {NetworkConditions | {profile}}
DELETE /api/network-conditions                -> back to Off
POST /api/mocks                               (existing, with the new fields)
POST /api/mocks/{id}/reset                    -> re-arm a rule's hit counter
```
A new live event `conditions` pushes changes to every open dashboard.

## Scenarios this has to reproduce (acceptance)

| # | Scenario | How |
|---|---|---|
| S1 | Payment on slow 2G: spinner, timeouts, double taps | Profile 2G |
| S2 | Pay API fails once with DNS failure; the retry succeeds | Rule `fail/dns_failure`, `times: 1` |
| S3 | Wi-Fi to 4G switch while the transaction list downloads | Rule `fail/network_switch`, `dropAfterBytes: 2048` |
| S4 | Backend down | Rule `fail/connection_refused` on the host |
| S5 | Cert pinning or TLS failure | Rule `fail/ssl_handshake` |
| S6 | Flaky backend: 30% of calls 503 | Rule `respond 503`, `probability: 30` |
| S7 | Rate limiting and Retry-After handling | Template "Rate limited" |
| S8 | Airplane mode, then back online | Profile Offline, then Off; both are on the timeline |
| S9 | Server returns an HTML error page / malformed JSON | Templates |
| S10 | Lossy network: 10% of calls drop | Custom `lossPercent: 10` |
| S11 | Cold start with a failing config API | Persisted rule + conditions |
| S12 | Automated test sets conditions before a step | `curl -X PUT .../api/network-conditions -H 'X-Killcam: 1' -d '{"profile":"slow_3g"}'` |

## Design notes

- **Order in the interceptor:**
  1. Offline or loss decides first, then fails the call.
  2. Latency and jitter sleep. The sleep can be cancelled.
  3. The mock rule applies, if any.
  4. The upload throttle wraps the request body, and the download throttle wraps the response body (okio `Throttler`).
  5. For `network_switch`, the response body is wrapped to abort after N bytes.
- The decision logic (`NetworkConditionsEngine.plan()`, rule `times` and `probability`) lives in pure-JVM `killcam-core`, so it is unit-tested without a device. The random source and clock are injectable.
- Every injected failure is recorded on the call as its error (`mockRuleId`, or `Killcam network conditions`), so the Network panel shows what was simulated.
- Wire compatibility: the new rule fields have defaults, so an old `mocks.json` still loads.

## Out of scope for this change
- Throttling traffic that bypasses OkHttp (WebView, other HTTP stacks). Possible later with a local proxy.
- Per-host conditions. Per-URL behaviour is covered by mock rules with `delay`.

---

# Part 2: endpoint catalogue, repeat, breakpoints

Status: implemented on `feature/network-fault-injection`.

## R6. Endpoint catalogue (top-level API endpoint selector)

Testers should pick "which API" from a list (`/page/fetch`, `/action/view`,
`/data/sync`, and so on) instead of typing URL patterns. The list should be versioned
in GitHub so every build and every tester shares it.

| Field | Meaning |
|---|---|
| `key` | Unique name testers pick, usually the path: `/page/fetch` |
| `method` | Optional; null matches any method |
| `urlPattern` + `matchType` | How calls are matched (defaults: the key, `contains`) |
| `group` | Top-level group; defaults to the first path segment (`page`, `action`, `data`) |
| `name`, `description` | Human text |

**Sources, merged by key (later wins):**
1. **Repo:** `killcam-endpoints.json` checked into the app's GitHub repo and shipped as a debug asset (`src/debug/assets/`). It is loaded automatically at install (`KillcamConfig.endpointsAsset`).
2. **Code:** `Killcam.registerEndpoint("/page/fetch", method = "POST", group = "page")`.
3. **Dashboard:** testers add or edit endpoints. These are stored on the device and flagged as *not in repo yet*.

**Back into GitHub:**
- The dashboard's Export button, or `GET /api/endpoints/export`, produces the complete catalogue file.
- `scripts/pull-endpoints.sh <path-in-app-repo>` pulls it from a device over `adb forward` and writes it into the app repo, ready to commit and open a PR.
- The device never holds GitHub credentials, since debug builds carry payment data.

**Discovery:** the Endpoints panel lists paths seen in captured traffic that no endpoint covers yet, with IDs collapsed (`/v1/transactions/8Q2K1` → `/v1/transactions/*`). One click registers one.

**Using it:**
- A mock rule can target an endpoint. `endpoint: "/page/fetch"` fills in the method and match.
- `POST /api/mocks {"endpoint":"/data/sync","action":"fail","failure":"network_switch"}` works from scripts.
- From Kotlin, `failRequests("/data/sync", …)` and `mockResponse("/data/sync", …)` use the registered endpoint when the pattern equals its key.

## R7. Repeat a request
From a captured call in Network:
- **Repeat:** re-send it N times (1–50), one after another or all at once (to reproduce double-submit and race conditions).
- **Edit and repeat:** change the method, URL, headers or body first.

The request goes through the app's own OkHttp client (`Call.clone()`), so auth and the other interceptors apply, and so do mocks, conditions and breakpoints. The new calls are captured with source `repeat`. The app itself never sees their responses.

Limits:
- Only calls from this app process can be repeated. Killcam remembers the last 300.
- Calls with one-shot or streaming bodies can only be repeated with an edited body.
- Saved sessions can't be repeated.

## R8. Breakpoints
A mock rule action `breakpoint` pauses matching calls:
- **Request stage:** before the call goes out. The tester can edit the method, URL, headers or body, then Continue, or Fail it with any failure type.
- **Response stage:** after the response arrives, before the app sees it. The tester can edit the status, headers or body (up to 1 MB), then Continue, or Fail it.
- **Both.**

Paused calls appear in a tray on every dashboard screen, with the call's details and an editor. The app's calling thread waits. If nobody acts within 2 minutes the call continues unchanged, and cancelling the call releases it. The `times`, `probability` and endpoint selection from mock rules work for breakpoints too.

## Scenarios (part 2)
| # | Scenario | How |
|---|---|---|
| S13 | "Fail /data/sync with DNS failure" without knowing its URL | Endpoint selector in the rule editor |
| S14 | New endpoint found during testing, shared with the team | Discovered, then Register, then Export, then commit `killcam-endpoints.json` |
| S15 | Automation targets endpoints by key | `POST /api/mocks {"endpoint":"/page/fetch",…}` |
| S16 | Double-submit of a payment | Repeat ×2 concurrently |
| S17 | Replay a call with a changed amount | Edit and repeat |
| S18 | See what happens if the server returns a different field value | Response breakpoint, then edit the body, then Continue |
| S19 | Slow a single request by hand to tap Back mid-flight | Request breakpoint, wait, then Continue |
| S20 | Send a request with a missing auth header | Request breakpoint, then remove the header, then Continue |

## Verification
- `killcam-core` unit and server tests: conditions, presets, failure plans, `times` and `probability`, the endpoint catalogue, breakpoints and every new HTTP endpoint.
- `killcam` unit tests for the OkHttp fault helpers, plus end-to-end interceptor tests against MockWebServer (throttling, drops, repeat, breakpoints).
- `scripts/check-noop-api.sh` keeps `killcam-no-op` in step with the new public API.
- Dashboard `npm run typecheck` / `npm run build`, and the Node mock server updated so the UI can be exercised without a device.
