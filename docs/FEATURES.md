# Killcam feature reference

A reference for everything Killcam does: what each feature gives you, how it works, where its code is, its limits, what it was checked on, and what is still open. Open items live in [TRACKER.md](TRACKER.md) and are named here by ID. Long write-ups are in [BACKLOG.md](BACKLOG.md), the HTTP API is in [API.md](API.md), and setup is in the [README](../README.md).

## About this document

**When it was written.** 2026-09-24, about 16:30 IST. Sources:
- `main` at `b474131`;
- the local branch `feature/network-fault-injection` at `0a5ea3e` (section 8, the in-flight table and the commit timeline were updated at about 17:10 from `main` at `44ec8e0` and F-002's merge, `ac1b09f`);
- the `main` working tree at that time;
- the transcripts of the sessions that built Killcam that day.

Another session was rebuilding `dashboard/` while this was written (F-001), so dashboard line numbers refer to `b474131`. Check `git status` before relying on dashboard details.

**Status labels:**

| Label | Meaning |
|---|---|
| ✅ | On `main`, with the commit |
| 🌿 | Committed on a branch not merged into `main` |
| 🚧 | Built but not committed |
| 📝 | Designed; no code |

**Checked on** says how far a feature has been exercised. It uses one or more of these values:
- `device <model>`: the only device so far is the vivo V2514 on Android 16 (API 36), running Swag Pay;
- `demo server`: `./gradlew :killcam-core:demo`;
- `mock server`: `npm run mock`;
- `unit tests`;
- `compiled only`.

**Path shorthand:**

| Short | Full path |
|---|---|
| `core/` | `killcam-core/src/main/kotlin/com/krafton/killcam/core/` |
| `core-test/` | `killcam-core/src/test/kotlin/com/krafton/killcam/core/` |
| `android/` | `killcam/src/main/kotlin/com/krafton/killcam/` (`android/internal/` for internals) |
| `shared/` | `killcam/src/shared/kotlin/com/krafton/killcam/`, shared with the no-op |
| `noop/` | `killcam-no-op/src/main/kotlin/com/krafton/killcam/` |
| `dash/` | `dashboard/src/` |
| `sample/` | `sample/src/main/kotlin/com/krafton/killcam/sample/` |

## Contents

- [The product](#the-product)
- [Product decisions](#product-decisions)
- [What is in flight](#what-is-in-flight)

**Capture and the server**
1. [Install and lifecycle](#1-install-and-lifecycle)
2. [KillcamConfig](#2-killcamconfig)
3. [Server, access control and Wi-Fi sharing](#3-server-access-control-and-wi-fi-sharing)
4. [Live events](#4-live-events)
5. [Network capture](#5-network-capture)
6. [cURL and HAR export](#6-curl-and-har-export)
7. [Mocks](#7-mocks)
8. [Network conditions, fault injection, endpoint catalogue, repeat and breakpoints](#8-network-conditions-fault-injection-endpoint-catalogue-repeat-and-breakpoints)
9. [Logs](#9-logs)
10. [Crashes](#10-crashes)

**Replay and sessions**

11. [Timeline: screens, lifecycle, marks and markers](#11-timeline-screens-lifecycle-marks-and-markers)
12. [Screenshots](#12-screenshots)
13. [Taps](#13-taps)
14. [The Replay page](#14-the-replay-page)
15. [Sessions and bug bundles](#15-sessions-and-bug-bundles)
16. [Pausing capture and clearing data](#16-pausing-capture-and-clearing-data)

**App state**

17. [Flags](#17-flags)
18. [Firebase Remote Config](#18-firebase-remote-config)
19. [Storage: SharedPreferences](#19-storage-sharedpreferences)
20. [Storage: SQLite](#20-storage-sqlite)
21. [Storage: MMKV](#21-storage-mmkv)
22. [Storage: Files](#22-storage-files)
23. [Device info and Session details](#23-device-info-and-session-details)
24. [Actions and deep links](#24-actions-and-deep-links)

**On the phone and in the browser**

25. [Entry points: bubble, shake and notification](#25-entry-points-bubble-shake-and-notification)
26. [In-app window and native bridge](#26-in-app-window-and-native-bridge)
27. [Dashboard shell](#27-dashboard-shell)
28. [Network, Logs and Crashes pages](#28-network-logs-and-crashes-pages)
29. [Design system](#29-design-system)
30. [Rozenite panel](#30-rozenite-panel)

**Building and shipping**

31. [No-op artifact and API parity](#31-no-op-artifact-and-api-parity)
32. [Sample app](#32-sample-app)
33. [Desktop demo and mock server](#33-desktop-demo-and-mock-server)
34. [Swag Pay integration](#34-swag-pay-integration)
35. [Build, commands and bundling](#35-build-commands-and-bundling)

**Reference**
- [Reference](#reference): memory budgets, threads, files on the phone, tests
- [Commit timeline](#commit-timeline)

---

## The product

**Killcam** runs inside an Android app's **debug build** and shows what the app is doing, live:
- network traffic;
- logs;
- crashes;
- feature flags;
- Firebase Remote Config;
- storage;
- a replay of the moments before something broke.

It is inspired by PhonePe's Lens and was built first for **Swag Pay**, a UPI payments app from Krafton India / Kinvrs. It is shown in three places:
- a laptop browser;
- a window inside the app;
- React Native DevTools.

The name comes from games: a killcam replays the seconds before you died. Killcam replays the screens, taps, requests and logs before a crash, or before a tester marks a bug, and packages them as one **bug bundle** (a zip) to share in Slack or JIRA. The name was chosen by the user on 2026-09-24 from a list that included Scope, Spectate, Minimap, Kinspect and Glassbox.

**Who uses it**
- Testers, on the phone: the bubble, marking a moment, sharing a bug bundle.
- Developers, on a laptop: inspecting traffic, mocking, flipping flags, editing storage.

**Pages** (in the rebuilt dashboard's order):

| Group | Page | What it is for |
|---|---|---|
| Analyse | Replay | Screenshots, taps, screens, calls and logs on one timeline, with a player |
| Analyse | Network | Every call through `KillcamInterceptor`, with headers, bodies, timing, cURL and "Mock this" |
| Analyse | Logs | `Killcam.log`, analytics events and the app's own logcat |
| Analyse | Crashes | Fatal and non-fatal crashes, with a link into Replay |
| Run | Mocks | Rules that answer, delay or fail matching calls |
| Run | Flags | Declared flags with default, remote and override values |
| Run | Remote Config | Firebase Remote Config values, and fetch-and-activate |
| Run | Actions | App-defined buttons, and a deep-link launcher |
| Run | Endpoints | 🌿 The app's APIs by name, to target with rules and export to the app's repository (section 8) |
| Data | Sessions | Saved and crash sessions. A placeholder in the rebuilt shell. |
| Data | Storage | SharedPreferences, SQLite, MMKV and files |
| — | Session details | A dialog: app, device and runtime info, and how to connect. It replaced the Device page. |

**Glossary**
- **Live session:** what is being recorded now, since the process started.
- **Saved session:** a snapshot a tester saved.
- **Crash session:** the live session written to disk as the process died, listed on the next launch.
- **Mark a moment:** a bookmark on the timeline, with a forced screenshot.
- **Bug bundle:** a zip of a session: `session.json`, `network.har`, the screenshots and a `README.txt`.

## Product decisions

Each decision below has its reason and the alternatives that were turned down. The product-manager skill lists the decisions every new item must respect.

| Decision | Why | Turned down |
|---|---|---|
| **Swag Pay first** | It is native Kotlin and Compose (Kotlin Multiplatform) with some React Native screens, the closest to Lens. | The Swag app first, an Expo WebView shell that needs JS hooks and an Expo config plugin (F-015); or both in v1. |
| **An on-device server, the Lens model** | No backend; no payment data leaves the phone. | A hosted dashboard with uploaded sessions and share links: it needs a backend, auth and a data-retention policy. |
| **Android only in v1** | Scope. The HTTP API doesn't depend on the platform, so an iOS agent can serve the same dashboard later (F-014). | — |
| **`killcam-core` is pure JVM** | No phone was attached at first, so the server had to run on the laptop with fake data (the demo). It also keeps the logic unit-testable. | — |
| **Contract first** | `dash/api/types.ts` is the single source of truth, mirrored by `core/model/Models.kt` and documented in `docs/API.md`. The dashboard and the Kotlin side were built in parallel against it. | — |
| **Closed by default** | Killcam holds payment traffic. So: loopback only; Wi-Fi only with a fresh PIN; a Host check; the `X-Killcam` header on writes; sandboxed paths; SQL identifiers checked against the schema. | — (gaps remain: T-001, T-002) |
| **No-op for release** | Release builds compile unchanged, with no server and no Ktor. | Guarding with `BuildConfig` checks in the app. |
| **In-app window = the dashboard in a WebView** | The phone and the laptop always show the same thing. It uses plain framework views, with no AppCompat or Compose, so nothing can clash with the app's own versions. | A native header plus the WebView (v1, 12:46), removed at 15:10 after the user said it was "very clumsy". |
| **The built dashboard is committed** | Android builds need no Node toolchain. | Building it in Gradle. |
| **Dashboard stack** | React 19 with no router library, UI kit or icon font. Zero external requests at runtime, because the phone may be offline. Live updates over SSE. | — |
| **The design system is vendored from swagperf** | The same UI/UX as swagperf (F-001), and "the later merge is a deletion". | Building inside swagperf's `frontend/` (swagperf's product manager's recommendation; Q2). |
| **Logcat is polled, not tailed** | On Android 16 (vivo) an app can dump its own log but not stream it: the stream delivered the backlog and then nothing. | Tailing a child `logcat` process (the first version). |
| **Only known MMKV instances are opened** | Opening an encrypted store without its key fails the CRC check, and MMKV then discards the file. | Scanning the MMKV directory. |
| **`FLAG_SECURE` windows are never screenshotted** | UPI PIN entry. | — (taps still leak: B-003) |
| **Screenshots are stamped at capture time** | Stamping when encoding finished put frames on the wrong screen and out of order. This was found on the vivo. | — |
| **Integrate Swag Pay through `SwagTrace`** | It is the single choke point swagperf already relies on, so screens need no per-composable code. | — |
| **The Rozenite panel embeds the dashboard** | Chosen by the user: "Killcam native + Rozenite bridge". Rozenite only works inside React Native DevTools with Metro attached, and has no Firebase or Remote Config plugin. | Rozenite only; Killcam native only. |

## What is in flight

As of 2026-09-24, about 17:10 IST:

| Work | Where | State |
|---|---|---|
| Dashboard rebuilt on swagperf's design system (F-001) | `44ec8e0` on `main` | ✅ Committed and pushed. F-001 stays in progress in the tracker until its remaining checks (the real server and the vivo) are done. |
| Swag Pay integration | Worktree `~/Documents/swag-pay-killcam`, branch `killcam-integration` | 🚧 Uncommitted. |
| `main` doesn't build (B-001), and phones load a stale bundle (B-002) | `main` | `44ec8e0` commits the missing shell and a rebuilt bundle, and the dashboard typechecks there. Both rows stay open in the tracker for a developer to close. |

F-002 (network conditions, fault injection, endpoint catalogue, repeat and breakpoints) was merged into `main` on 2026-09-24; see section 8.

---

## 1. Install and lifecycle

- **Status:** ✅ `b474131`
- **What it gives you:** one call in `Application.onCreate` starts everything: capture, the server, the bubble, the notification and the crash handler. In a release build it does nothing.
- **How it works:**
  - **Install.** `Killcam.install` uses double-checked locking. A second call returns `true`, and a different config on that call is ignored. It returns `false`, with a `Log.w`, when:
    - the build isn't debuggable (`FLAG_DEBUGGABLE`) and `allowNonDebuggable` is false;
    - or it runs in a secondary process. On API 28+ it compares `Application.getProcessName()` with the package; below that it reads `/proc/self/cmdline`.
  - **Start**, on the main thread (`KillcamRuntime.start()`):
    1. registers the built-in "Restart app" action;
    2. installs `CrashHandler` (if `captureCrashes`);
    3. registers `ActivityTracker`;
    4. adds a "Process start" event;
    5. starts `LogcatReader` (if `captureLogcat`);
    6. spawns the daemon thread `killcam-server`. That thread starts the server, logs "Dashboard ready: adb forward…", mirrors Remote Config into Flags once, then posts the notification and the ready callbacks to the main thread.
  - If the server fails, the error is kept in `serverError`, and capture carries on without a dashboard.
  - **Restart app** (group "Killcam") builds `makeRestartActivityTask(launch)`, waits 300 ms, then calls `Runtime.exit(0)`.
- **Code:** `android/Killcam.kt:49-67` (install), `:269-276` (main-process check); `android/internal/KillcamRuntime.kt:30-39` (wiring), `:64-87` (start), `:89-100` (Restart app).
- **API:** `Killcam.install(application, config = KillcamConfig()): Boolean`; `Killcam.isInstalled`; `Killcam.open(context)`.
- **Limits:** the Restart app delay is 300 ms. There is no stop or uninstall: the threads live as long as the process.
- **Survives a restart:** everything under `files/killcam/` (see [Files on the phone](#files-on-the-phone)).
- **Security:** refuses non-debuggable builds unless `allowNonDebuggable = true`. Release builds should depend on the no-op anyway (section 31).
- **Checked on:** device vivo V2514 in Swag Pay ("Dashboard ready"; `/api/status` and `/api/info` correct).
- **Tests:** untested. The `killcam` module has no tests.
- **Notes:**
  - Calls made before `install` are dropped: logs, events, timeline, screen, mark, `recordException`, `recordError`.
  - Kept from before install: flag declarations, actions, `setInfo` rows and `registerMmkv`.
  - Flag reads before install see no overrides.
  - `install` does disk I/O on the main thread (T-005).
  - A main process with a custom `android:process` name never installs (inferred).
- **Open items:** T-005, F-004.

## 2. KillcamConfig

- **Status:** ✅ `b474131`
- **What it gives you:** the switches an app can set at install. It is a `data class` in `shared/KillcamConfig.kt:8-55`, used verbatim by the no-op.

| Field | Default | Effect |
|---|---|---|
| `port` | `8090` | Server port. The server tries `port` to `port + 9`. |
| `showBubble` | `true` | The floating bubble (section 25) |
| `showNotification` | `true` | The ongoing notification (section 25) |
| `shakeToOpen` | `true` | Two shakes open the in-app window |
| `captureScreenshots` | `true` | Screenshots (section 12) |
| `captureTaps` | `true` | Taps (section 13) |
| `captureLogcat` | `true` | The logcat reader (section 9) |
| `captureCrashes` | `true` | The crash handler (section 10) |
| `maxNetworkCalls` | `500` | Calls kept, oldest dropped |
| `maxBodyBytes` | `131072` (128 KiB) | Kept per request body and per response body, enforced in the interceptor |
| `redactHeaders` | empty | Header names whose values are stored as `██ redacted`. Case-insensitive. |
| `allowNonDebuggable` | `false` | Lets Killcam start in a non-debuggable build |
| `ignoredLogTags` | `DEFAULT_IGNORED_LOG_TAGS` | Logcat tags dropped. A trailing `*` means prefix, and matching is case-sensitive. The default list has 38 entries: framework rendering, IME and autofill, media and camera probes, and the vivo, OPPO/OnePlus/realme, Xiaomi, Huawei and Samsung layers. |

On `feature/network-fault-injection` (🌿) it also has `endpointsAsset` (section 8).

**Not configurable** (hard-coded in the core):

| Limit | Value | Where |
|---|---|---|
| Body budget | 24 MiB | `core/store/KillcamStore.kt:42` |
| Log entries kept | 5,000 | `KillcamStore.kt:36` |
| Timeline events kept | 5,000 | `:37` |
| Crashes kept | 50 | `:38` |
| Saved sessions kept | 10 | `core/KillcamCore.kt:46` |
| Screenshots kept for the live session | 300 | `:47` |

There is also no switch to disable Wi-Fi sharing, to start paused, or to redact bodies (T-002). **Open items:** T-002, T-013.

## 3. Server, access control and Wi-Fi sharing

- **Status:** ✅ `b474131`
- **What it gives you:** the dashboard and the HTTP API, served from the phone. Over USB (`adb forward tcp:8090 tcp:8090`) and from the in-app window, no login is needed. Over Wi-Fi, a tester turns sharing on and enters a 6-digit PIN.
- **How it works:**
  - **The server.** Ktor CIO is embedded. It binds `127.0.0.1`, or `0.0.0.0` while sharing is on. It tries 10 ports, `port` to `port + 9`, and treats "address in use" as a reason to try the next. `restart` keeps the same port, so `adb forward` and the in-app window keep working after a Wi-Fi toggle. That was a bug found during the build.
  - **The guard** runs on every request, in this order:
    1. `Host` must be `localhost`, a dotted IPv4 literal or a bracketed IPv6 literal. Otherwise: 403 `host_not_allowed`. This blocks DNS rebinding.
    2. Every non-GET under `/api/*` needs `X-Killcam: 1`. Otherwise: 403 `missing_x_killcam_header`. The custom header forces a CORS preflight, which the server never approves.
    3. Loopback callers are allowed.
    4. If sharing is off, other callers get 403 `wifi_sharing_off`.
    5. Pages and `/api/auth` are allowed, so the PIN screen can load.
    6. Otherwise the caller needs a valid `killcam_token` cookie, or gets 401 `pin_required`.
  - **The PIN** (`POST /api/auth {pin}`):
    - the PIN is trimmed and compared in constant time;
    - success sets `killcam_token` (24 random bytes, `HttpOnly; SameSite=Strict`) and returns 204;
    - a wrong PIN returns 401 `wrong_pin`;
    - five failures lock `/api/auth` for everyone for 60 s, answered with 429.
  - **Turning sharing on** generates a new PIN (`SecureRandom`, 6 digits), clears tokens and lockouts, and rebinds. The Wi-Fi URL is `http://<first site-local IPv4, wlan* preferred>:<port>`.
  - **Toggling** is possible only through the in-app window's bridge (`setWifiSharing`, section 26). There is no HTTP endpoint and no `Killcam.*` call.
  - **Pages:** `GET /` serves `index.html` (`no-store`), and assets are cached for a year. Unknown non-API paths fall back to `index.html`, and paths with `..` are rejected. If the bundle is missing, a "run `npm run build`" page is served.
- **Code:** `core/server/KillcamServer.kt`: start `:80-101`, restart `:110-115`, guard `:144-159`, `/api/auth` `:169-183`, static files `:431-470`, `PORT_ATTEMPTS` `:533`. `core/server/AccessControl.kt`. `core/KillcamCore.kt:95-108`; `android/internal/KillcamRuntime.kt:149-158`.
- **API:** `KillcamConfig.port`. HTTP: `POST /api/auth`, and `GET /api/status` (`{capturePaused, wifiEnabled, wifiUrl, remote, port}`, where `remote` says whether the caller is off the phone).
- **Limits:** 10 port attempts; 5 failures before the lock; a 60,000 ms lock; a 6-digit PIN; a 48-hex-character token.
- **Survives a restart:** nothing. Sharing, the PIN and tokens all reset.
- **Security:**
  - Loopback is fully trusted, so any app on the phone can use the whole API.
  - Wi-Fi is plain HTTP.
  - Tokens don't expire.
  - The lockout is global.
  - The PIN is shown in the notification.
  - All of this is T-001.
- **Checked on:**
  - device vivo V2514: loopback only;
  - unit tests: `ServerTest.wifiSharingRequiresPinFromLan` exercised the PIN flow over the Mac's real LAN interface.
  - Wi-Fi sharing has not been used on a phone (T-003).
- **Tests:** `CoreUnitTest.hostAndLoopbackRules`, `pinLocksOutAfterRepeatedFailures`; `ServerTest.rejectsForeignHostHeader`, `writesNeedKillcamHeader`, `wifiSharingRequiresPinFromLan` (skipped on a machine with no LAN IPv4), `servesInfoAndDashboardFallback`. The 429 over HTTP is untested.
- **Open items:** T-001, T-012, T-003.

## 4. Live events

- **Status:** ✅ `b474131`
- **What it gives you:** every open dashboard updates live, without polling.
- **How it works:**
  - **The stream.** `GET /api/live` is a `text/event-stream`. It sends `retry: 2000`, then `hello {sessionId, seq}`, then typed events: `network`, `log`, `crash`, `timeline`, `mocks`, `flags`, `status` and `cleared`. An idle connection gets `: ping` every 15 s.
  - **On the phone:** each connection has a buffer of 512 events that drops the oldest when full, so app threads never block.
  - **In the dashboard** (`dash/api/live.ts`):
    - on `hello` it loads nine snapshots in parallel and buffers events until they arrive;
    - it applies events in one update per 60 ms;
    - it caps network at 1,000, logs at 5,000 and timeline at 5,000.
    - A new `sessionId` means the app restarted. The dashboard clears the live streams and shows "The app restarted: now showing its new live session."
    - Reconnect backoff starts at 1,000 ms, doubles, and is capped at 10,000 ms. If the stream was closed, for example by a 401, it probes `/api/status`, which can raise the PIN screen.
  - **Ordering** (🚧 working tree): the timeline is sorted by `ts`, then `seq`.
- **Code:** `core/server/KillcamServer.kt:192,403-427`; `core/store/KillcamStore.kt:28-32,84-112`; `dash/api/live.ts:22,44-57,71-113,117-161,197-252`.
- **API:** `GET /api/live`. The event types are in `dash/api/types.ts` (`LiveEvents`).
- **Limits:** 512 events buffered per connection on the phone; a 15,000 ms heartbeat; a 2,000 ms client retry; a 60 ms batch in the dashboard.
- **Survives a restart:** no.
- **Security:** the same guard as the rest of the API. Remote callers need the cookie.
- **Checked on:** demo server, mock server, and device vivo V2514 (Logs updated live).
- **Tests:** `ServerTest.liveStreamDeliversEvents` (`hello` plus a timeline event).
- **Open items:** T-005 (events are JSON-encoded even with no listener), T-012 (API.md doesn't describe `hello`, ping, `retry` or the buffer).

## 5. Network capture

- **Status:** ✅ `b474131`
- **What it gives you:** for every call through an OkHttp client that has `KillcamInterceptor`:
  - method, URL, headers and bodies (text, or base64 for binary);
  - status, protocol, timing and errors;
  - the screen it happened on, and which mock rule applied.
- **How it works:**
  - **Order.** Mocks are matched first, which also bumps the rule's hit count. Then the request body is captured and the call begins. While capture is paused, the call is not recorded, but mocks still apply.
  - **Request body.** It is written once into a capped sink that keeps the first `maxBodyBytes`. One-shot and duplex bodies are recorded as "[one-shot body not captured]".
  - **Response.** It is recorded when the headers arrive. The body is teed as the app reads it and reported at EOF, on close, or on a read error. Nothing is read ahead, so streaming behaves exactly as without Killcam. A body the app never reads is never captured.
  - **Decoding** (`core/net/Bodies.kt`):
    - gzip and deflate are inflated, even when truncated; other encodings such as `br` are kept as base64;
    - textual types include JSON, XML, form, GraphQL and NDJSON;
    - with no content type, a body is treated as text if at most 1/50 of its first 512 characters are bad.
  - **Redaction.** Header values named in `redactHeaders` become `██ redacted` before they are stored, so exports carry the mask too.
  - **Errors.** An `IOException` or `RuntimeException` marks the call failed ("SimpleName: message") and is rethrown.
  - **Other clients:**
    - Ktor is captured only through its OkHttp engine: `HttpClient(OkHttp) { engine { addInterceptor(KillcamInterceptor()) } }`.
    - React Native `fetch` needs `OkHttpClientProvider.setOkHttpClientFactory { … addInterceptor(KillcamInterceptor("react-native")) }`.
    - WebSocket frames are not captured.
  - Add it as an **application** interceptor (`addInterceptor`), so mocks short-circuit before any I/O and bodies arrive decompressed. As an application interceptor it sees request headers before OkHttp adds Host, User-Agent, Accept-Encoding and cookies (inferred).
- **Code:** `android/KillcamInterceptor.kt`: `intercept` `:46-104`, `respond` `:106-131`, `pause` `:134-142`, `captureRequest` `:156-171`, `CappedSink` `:174-188`, `CapturingBody` `:191-242`. `core/net/Bodies.kt:16-102`. `core/store/KillcamStore.kt`: `beginCall` `:120-166`, `completeCall` `:169-192`, `failCall` `:204-209`.
- **API:** `KillcamInterceptor(source: String = "okhttp")`; config `maxBodyBytes`, `maxNetworkCalls`, `redactHeaders`. HTTP: `GET /api/network` (summaries, oldest first) and `GET /api/network/{id}`. Live event: `network`.
- **Limits:**
  - 131,072 B kept per body, applied to wire bytes, so inflated text can be larger;
  - 500 calls;
  - a 24 MiB body budget, after which the oldest calls' bodies become `[evicted: …]`;
  - call ids are 12 base-36 characters;
  - `path` includes the query string.
- **Survives a restart:** only inside saved sessions.
- **Security:** `Authorization`, `Cookie` and `Set-Cookie` are stored in clear unless redacted. Bodies and query strings are never redacted (T-002).
- **Checked on:** demo server, mock server and unit tests. **Never on a device:** Swag Pay makes no HTTP calls (F-005), and the sample app was never installed (T-003).
- **Tests:** `ServerTest.networkLifecycleAndCurl` (store and endpoints, not the interceptor); `CoreUnitTest.decodesGzipEvenWhenTruncated`, `binaryBodiesAreBase64`, `countCapDropsOldestCalls`, `bodyBudgetEvictsOldestBodiesFirst`. **The interceptor itself is untested.**
- **Open items:** F-005, T-002, T-003, B-016, T-005.

## 6. cURL and HAR export

- **Status:** ✅ `b474131`
- **What it gives you:** a copy-paste cURL command per call, and a HAR 1.2 file of the live session.
- **How it works:**
  - **cURL:**
    - `-X METHOD` is added unless it's a GET with no body;
    - `Content-Length` and `Host` are skipped;
    - text bodies use `--data-raw` (with `# truncated by Killcam` when cut), and binary bodies use `--data-binary @body.bin`;
    - `--compressed` is added when `Accept-Encoding` was captured.
  - **HAR:**
    - creator `Killcam 0.1.0`;
    - wait time = duration;
    - query values are not URL-decoded;
    - custom fields `_error`, `_killcamMockRuleId` and `_killcamScreen`.
  - **In the dashboard:** for a saved session, cURL is built in the browser (`dash/lib/curl.ts`), and the dashboard also falls back to that if the phone's cURL request fails.
- **Code:** `core/net/Exports.kt:18-40` (cURL), `:43-127` (HAR).
- **API:** `GET /api/network/{id}/curl` (`text/plain`); `GET /api/network.har` (live session only, `killcam-<sessionId>.har`). Every session export also contains `network.har`.
- **Limits:** evicted or truncated bodies are exported as stored.
- **Survives a restart:** n/a.
- **Security:** redacted headers stay redacted.
- **Checked on:** demo server, mock server.
- **Tests:** `ServerTest.networkLifecycleAndCurl` (`--data-raw` present; HAR returns 200).
- **Open items:** F-006 (HAR for saved sessions, and from the phone).

## 7. Mocks

- **Status:** ✅ `b474131` (more on the branch: section 8)
- **What it gives you:** rules that return a canned response, add a delay, or fail a call as a timeout, no network or a connection reset. Rules survive restarts. From any captured call, **Mock this** fills in a rule.
- **How it works:**
  - **Matching** (`core/mock/MockEngine.kt`):
    - rules run in list order, and **the first enabled match wins**;
    - the method match is case-insensitive, and a null method matches any;
    - match types, all against the full URL including the query: `contains` (substring), `exact`, `glob` (whole URL; `*` also matches `/`, `?` matches one character) and `regex` (found anywhere).
    - Compiled regexes are cached per rule.
  - **Actions**, applied in the interceptor:
    - the rule's delay always runs first, in 100 ms steps, and is cancellable;
    - `respond` builds a response with the rule's headers, a default `Content-Type: application/json`, and `X-Killcam-Mock: <rule name>`;
    - `fail` throws `SocketTimeoutException`, `UnknownHostException` or `SocketException("Connection reset")`;
    - `delay` then goes to the real network.
  - **Every hit** pushes the full rule list to dashboards (`mocks` event).
  - **The Mocks page** (`dash/panels/MocksPanel.tsx`, at `b474131`):
    - the rules in order, each with ▲▼ reorder, an enable switch, a hit count, Edit and Delete;
    - an editor with method, match type and pattern;
    - "Test a URL", and a live preview of up to 50 captured URLs that match (4 shown);
    - a Respond action (status with quick picks, delay, headers, JSON body with Format), a Delay action, and a Fail action.
  - **Mock this** (`NetworkDetail.tsx:38-60`) makes an **exact-URL** rule from the call. It keeps its status, its headers minus hop-by-hop ones, and its body if that is JSON and not truncated.
- **Code:** `core/mock/MockEngine.kt`: `create` `:31-42`, `update` `:44-60`, `reorder` `:69-75`, `match` `:78-88`, `validate` `:105-111`, `globToRegex` `:128-138`. `android/KillcamInterceptor.kt:51,66-72,106-148`. Models: `core/model/Models.kt:247-300`. Browser-side matching: `dash/lib/match.ts`.
- **API:** no `Killcam.*` calls at `b474131`; the branch adds some (section 8). HTTP:
  - `GET /api/mocks` and `POST /api/mocks`;
  - `PUT /api/mocks/{id}` and `DELETE /api/mocks/{id}`;
  - `PUT /api/mocks` with every rule id in the new order;
  - live event `mocks`.

  `MockRuleInput` defaults: enabled, any method, `contains`, `respond`, status 200, delay 0, failure `timeout`.
- **Limits:**
  - `delayMs` is kept within 0 to 120,000;
  - the status must be 100–599;
  - an invalid regex or a blank pattern returns 400.
- **Survives a restart:** `files/killcam/mocks.json`, written atomically. Hit counts reset to 0.
- **Security:** user regexes run on the app's network threads, so a pathological pattern could stall requests (inferred).
- **Checked on:** demo server (the demo only uses a rule's status and body), mock server, unit tests. Never on a device.
- **Tests:** `CoreUnitTest.globMatchesWholeUrl`; `ServerTest.mockCrudAndMatching`. `PUT /api/mocks/{id}`, the interceptor actions and `lib/match.ts` are untested.
- **Open items:**
  - B-004 (a non-ASCII rule name or header crashes the request);
  - B-010 (cancelling Delete closes the editor);
  - B-011;
  - F-002;
  - F-012 (import and export);
  - T-004.
  - "Mock this" makes exact-URL rules, so calls with changing query strings won't match again.

## 8. Network conditions, fault injection, endpoint catalogue, repeat and breakpoints

- **Status:** ✅ on `main`, merged 2026-09-24 as a fast-forward: `d2448a5` (plan), `1b6d521` (Kotlin, server and tests), `190c042` (README and API.md) and `ac1b09f` (dashboard and bundle). The branch `feature/network-fault-injection` was rebased onto `44ec8e0` first, and its dashboard rebuilt on the design system.
- **What it gives you:**
  - A simulated slow, lossy or offline network for every intercepted call.
  - Failures thrown the way Android throws them.
  - Rules that fail only the first N calls, or a share of calls.
  - The app's APIs picked by name from a catalogue that lives in the app repo.
  - Repeating a captured request.
  - Pausing a call to edit it before it is sent, or before the app reads the response.
- **How it works:**
  - **Conditions** (`core/mock/NetworkConditionsEngine.kt`):
    - `plan()` decides per call: offline gives a DNS failure; loss gives a read timeout or a connection reset at random; latency plus random jitter; download and upload caps;
    - the interceptor sleeps (cancellable), throttles the bodies (okio `Throttler`, in chunks of about 100 ms of data) and throws;
    - conditions are persisted like mocks, and every change adds a timeline event such as "Network: Slow 3G". Conditions left on from the last run are logged at startup and marked on the timeline.
  - **Presets:**

    | Preset | Latency | Jitter | Down / up | Loss |
    |---|---|---|---|---|
    | GPRS | 500 ms | 200 ms | 50 / 20 kbps | 2% |
    | 2G (EDGE) | 300 ms | 100 ms | 250 / 50 kbps | 1% |
    | Slow 3G | 400 ms | 100 ms | 400 / 400 kbps | 0% |
    | Fast 3G | 150 ms | 50 ms | 1,600 / 750 kbps | 0% |
    | 4G | 50 ms | 20 ms | 12,000 / 6,000 kbps | 0% |
    | Flaky Wi-Fi | 80 ms | 600 ms | 2,000 / 1,000 kbps | 10% |
    | Offline | – | – | – | every call fails DNS |

  - **Failures** (`KillcamFailure`; `android/internal/NetworkFaults.kt`): `Timeout`, `DnsFailure`, `ConnectionReset`, `ConnectionRefused`, `ConnectTimeout`, `SslHandshake`, `NetworkSwitch` (the real call goes out, then the body aborts after `dropAfterBytes` with "Software caused connection abort") and `UnexpectedEof` (worded with OkHttp's own redacted URL).
  - **Rule fields:** `times` (apply to the first N matches; 0 means always), `probability` (1–100%), `dropAfterBytes`, `endpoint`, `breakOn`, and a re-arm that resets hits.
  - **Endpoint catalogue** (`core/endpoints/EndpointRegistry.kt`):
    - sources are merged by key, later winning: `killcam-endpoints.json` as a debug asset (`KillcamConfig.endpointsAsset`, read at install by `KillcamRuntime.loadEndpointCatalog`), `Killcam.registerEndpoint`, and the dashboard;
    - a rule with `endpoint` copies that endpoint's method, pattern and match type;
    - export writes the merged catalogue in the repo file's format, and `scripts/pull-endpoints.sh` writes it into the app's repository.
  - **Repeat** (`android/internal/OkHttpReplayer.kt`):
    - `Call.clone()` through the app's own client, so auth, interceptors, mocks, conditions and breakpoints apply; an edit is applied inside `KillcamInterceptor`, so headers added by earlier interceptors are kept;
    - 1–50 calls, one after another or all at once, as captured or edited;
    - captured with source `repeat`.
  - **Breakpoints** (`core/mock/BreakpointManager.kt`): the app's thread blocks until a tester resumes the call, the call is cancelled, or 120 s pass, when it continues unchanged.
  - **In the dashboard** (on the design system and `kit/`):
    - **Mocks** (`panels/MocksPanel.tsx`, `panels/NetworkConditions.tsx`) has the Network conditions card at the top, the new failure kinds with what each reproduces, API-error templates (500; 503 with `Retry-After: 30`; 429 with `Retry-After: 10`; 401 `token_expired`; an HTML 502; a 504 after 30 s; malformed JSON; an empty 200), a "When" section (the first N calls, a share of calls, re-arm), a Breakpoint action, and an Endpoint choice that fixes the method and pattern.
    - **Endpoints** (`panels/EndpointsPanel.tsx`) is a page in the Run group (code `EP`): one table per group with each endpoint's source, calls and errors, and Fail…, Mock…, Breakpoint… and Edit; up to 30 paths seen in traffic that no endpoint covers, with ids collapsed as in `/v1/transactions/*`; Export with Copy and Download. The in-app window shows compact cards.
    - **The shell** (`shell/AppShell.tsx`) shows a warning banner on every page but Mocks while conditions are on, and a banner listing calls held at breakpoints (`panels/BreakpointTray.tsx`), whose editor opens by itself.
    - **Network's call detail** adds Repeat beside Mock this (`panels/RepeatDialog.tsx`).
- **Code:** `core/mock/NetworkConditionsEngine.kt`, `core/mock/BreakpointManager.kt`, `core/endpoints/EndpointRegistry.kt`, `core/net/CallReplayer.kt`; `android/internal/NetworkFaults.kt`, `android/internal/OkHttpReplayer.kt`; `shared/KillcamNetwork.kt`; `android/KillcamInterceptor.kt`; `dash/panels/NetworkConditions.tsx`, `EndpointsPanel.tsx`, `BreakpointTray.tsx`, `RepeatDialog.tsx`, `MocksPanel.tsx`, `NetworkDetail.tsx`; `dash/shell/AppShell.tsx`; `dash/lib/endpoints.ts`; `scripts/pull-endpoints.sh`; `sample/src/debug/assets/killcam-endpoints.json`.
- **API:** `Killcam.setNetworkProfile(KillcamNetworkProfile)`; `setNetworkConditions(latencyMs, jitterMs, downloadKbps, uploadKbps, lossPercent, offline)`; `clearNetworkConditions()`; `failRequests(urlPattern, failure, method?, times, probability, delayMs, dropAfterBytes, regex)`; `mockResponse(urlPattern, status, body, headers, method?, times, probability, delayMs, regex)`; `removeMock(id)`; `registerEndpoint(key, method?, name?, group?, description?, urlPattern?, regex)`. `failRequests` and `mockResponse` return the new rule's id, or null before `install`; a `urlPattern` equal to a registered endpoint's key targets that endpoint. Config: `KillcamConfig.endpointsAsset` (default `"killcam-endpoints.json"`). HTTP:
  - `GET`, `PUT` and `DELETE /api/network-conditions`, and `GET /api/network-conditions/presets`;
  - `POST /api/mocks/{id}/reset`;
  - `GET`, `POST`, `PUT` and `DELETE /api/endpoints`, and `GET /api/endpoints/export`;
  - `POST /api/network/{id}/repeat`;
  - `GET /api/breakpoints`, `POST /api/breakpoints/{id}` and `POST /api/breakpoints/resume-all`.
  - Live events: `conditions`, `endpoints` and `breakpoints`.
- **Limits:**
  - latency and jitter 0–60,000 ms; loss 0–100%;
  - repeat count 1–50; the last 300 calls can be repeated (`OkHttpReplayer.MAX_REMEMBERED`);
  - a breakpoint times out after 120,000 ms, polled every 200 ms;
  - a request or response body edited at a breakpoint can be up to 1 MiB (`MAX_EDITABLE_BYTES`, `KillcamInterceptor.kt`); compressed, binary and one-shot bodies are view-only.
- **Survives a restart:** conditions (`files/killcam/network-conditions.json`), rules (`files/killcam/mocks.json`) and endpoints added from the dashboard (`files/killcam/endpoints.json`), which are flagged "Not in repo" until exported and committed.
- **Security:** Repeat sends real requests with the app's credentials; a header sent back as "██ redacted" is replaced by its real value on the phone, so the dashboard never sees it. A breakpoint on a main-thread call freezes the app for up to 120 s.
- **Checked on:** unit tests; mock server (the dashboard on desktop and in `?embed=1`), 2026-09-24. Not on a phone.
- **Tests:** `core-test/NetworkFaultsTest.kt` (11 tests), `core-test/EndpointsAndBreakpointsTest.kt` (6), `core-test/ServerTest.kt` (`networkConditionsAndRuleResetOverHttp`, `endpointCatalogBreakpointsAndRepeatOverHttp`); `killcam/src/test/kotlin/com/krafton/killcam/internal/NetworkFaultsTest.kt` (4). Eighteen interceptor tests against MockWebServer (throttling, drops, DNS-once-then-retry, repeat, breakpoints) passed on 2026-09-24 but live outside the repository, because `KillcamInterceptor` reads `Killcam.runtime`, which needs an `Application` (T-004).
- **Open items:** T-003 (a phone run), T-004 (a seam so the interceptor tests can live in the repository). Remaining work is in [BACKLOG](BACKLOG.md#network-conditions-fault-injection-endpoint-catalogue-repeat-and-breakpoints).

## 9. Logs

- **Status:** ✅ `b474131`
- **What it gives you:** one Logs stream with three kinds of line:
  - explicit `Killcam.*` logs;
  - analytics events;
  - the app's own logcat, so `Log.*`, `println`, OkHttp's logging interceptor and React Native `console.log` (tag `ReactNativeJS`) all appear with no code changes.
- **How it works:**
  - **API logs** record the thread, the current screen and stringified attributes.
  - **Events** (`Killcam.event`) become Info logs with tag `event` and kind `event`. They appear on the Replay feed in the dashboard, but not in `/api/timeline`.
  - **The logcat reader** runs on the daemon thread `killcam-logcat`, at minimum priority:
    - every poll spawns `logcat -d -v epoch --pid=<pid> -b main,system,crash -T <since>`, waits up to 2 s, then destroys the process;
    - it polls every 1 s in the foreground and every 5 s in the background;
    - lines at the boundary millisecond are de-duplicated;
    - continuation lines are merged, which keeps stack traces together;
    - ignored tags are dropped;
    - any tag over 40 lines per 5 s is rate-limited, with a "… N more lines from TAG suppressed" summary line. **Errors are never rate-limited.**
  - **Why it polls:** on Android 16 (vivo) an app's live logcat stream stalls after the backlog. The vivo compositor alone was about 85% of the app's log, which is why its tags are ignored by default.
  - **The Logs page** (`dash/panels/LogsPanel.tsx`, at `b474131`):
    - search, level chips (double-click one for "this level and above") and kind chips;
    - a tag filter, with up to 400 known tags suggested;
    - Follow, and Clear logs;
    - rows expand to the full message, attributes and stack.

    The rebuilt page (🚧) adds a tag menu (show only, hide, copy), hidden tags persisted in `killcam.logs.hiddenTags`, and 64 px rows on the phone.
- **Code:** `android/Killcam.kt:85-124`; `android/internal/LogcatReader.kt`: poll `:57-88`, parse `:91-120`, publish `:122-145`, constants `:171-182`; `core/store/KillcamStore.kt:262-294`.
- **API:** `Killcam.log(level, tag, message, throwable?, attributes)`, `v`, `d`, `i`, `w`, `e`, `event(name, properties)`; `KillcamLevel`; config `captureLogcat`, `ignoredLogTags`. HTTP: `GET /api/logs` (by arrival); `DELETE /api/data?stream=logs`; live event `log`.
- **Limits:**
  - 5,000 entries across all kinds;
  - polls every 1,000 ms (foreground) or 5,000 ms (background);
  - a 5,000 ms rate window, 40 lines per tag;
  - a 2 s wait for each logcat process.
- **Survives a restart:** only inside saved sessions.
- **Security:** logcat is copied verbatim, including any tokens other libraries log.
- **Checked on:** device vivo V2514 in Swag Pay. Before the polling fix it showed 9 lines; after it, 291 and then 351 lines, with a lag of about 1–3 s.
- **Tests:** only indirectly (`CoreUnitTest.pausedStoreDropsDataButKeepsMarks`). `LogcatReader` is untested.
- **Notes:**
  - Logcat lines arrive 1–5 s late, so `/api/logs` is in arrival order, not `ts` order.
  - Two separate logs with the same millisecond, thread, level and tag are merged (inferred).
  - `Log.getStackTraceString` returns "" when the cause chain includes `UnknownHostException`, including Killcam's own no-network mock (inferred).
  - **Lines logged while capture is paused are lost for good.** The reader keeps polling while paused, and publishes every line, which `KillcamStore.log` drops (`KillcamStore.kt:272`). It still moves its read position forward (`LogcatReader.kt:69-86`), so resuming doesn't bring those lines back. The only way to stop reading is `KillcamConfig(captureLogcat = false)` at install.
- **Open items:** T-005 (logcat is spawned every second even while paused), T-004.

## 10. Crashes

- **Status:** ✅ `b474131`
- **What it gives you:** the Crashes page lists this session's crashes plus fatal crashes from earlier sessions. For a fatal JVM crash, the whole session is saved as the process dies, and can be replayed on the next launch. The link is "Watch killcam" at `b474131`, and "Replay the last 15 s" in the new wording.
- **How it works:**
  - **Fatal crashes.** `CrashHandler` wraps the default uncaught-exception handler, so Crashlytics, Sentry or the system dialog still run. On a crash:
    1. a crash frame is captured (section 12);
    2. `onFatalCrash` records the crash, which is kept even while paused;
    3. `session.json` and `summary.json` are written synchronously on the dying thread, with reason `crash`.

    With no previous handler, it kills the process with exit code 10.
  - **Non-fatal:** `recordException` records a crash with `fatal = false`, including causes, plus an Error log with tag "Killcam".
  - **Non-JVM errors:** `recordError(type, message, stackTrace, fatal)` does the same without a Throwable. It was added for JS errors. Swag Pay's `KillcamTraceBridge` reassembles SwagErrors' chunked `swagerr|id|seq/total|chunk` records and calls it.
  - **Listing.** `/api/crashes` returns this session's crashes plus the crash of each saved crash session, newest first.
  - **The Crashes page:**
    - All, Fatal and Non-fatal;
    - "This session" or "Previous session";
    - the screen the crash was on;
    - the **blamed frame**, which is the first app frame;
    - Copy stack trace;
    - Replay, which seeks to 15 s before the crash and plays.
- **Code:** `android/internal/CrashHandler.kt:12-33`; `android/Killcam.kt:127-142`; `core/KillcamCore.kt:202-246`; `core/store/KillcamStore.kt:298-329`; `dash/panels/CrashesPanel.tsx:19-28,123-198`; `dash/components/StackTrace.tsx`.
- **API:** `recordException(throwable, message?)`, `recordError(type, message, stackTrace?, fatal = false)`; config `captureCrashes`. HTTP: `GET /api/crashes`, `GET /api/crashes/{id}`, `DELETE /api/data?stream=crashes`; live event `crash`.
- **Limits:** 50 crashes per session; exit code 10; the crash frame waits 400 ms.
- **Survives a restart:** `files/killcam/sessions/<id>/` (session, summary and screenshots). The newest 10 are kept.
- **Security:** the crash bundle holds all captured traffic on disk, in app-private storage.
- **Checked on:** demo server (a seeded crash session, replayed in headless Chrome); unit tests. **No real crash on a device**, and the JS-error path has never run end to end (T-003).
- **Tests:** `ServerTest.saveExportAndCrashRecovery`; `CoreUnitTest.recordsNonJvmErrorsAsNonFatalCrashes`. `CrashHandler` is untested.
- **Notes:**
  - Native (NDK) crashes and ANRs are not captured (F-011).
  - Crashes inside manually saved sessions are not listed in `/api/crashes`.
- **Open items:**
  - B-008 (a crash session can be lost on out-of-memory, and `recordError(fatal)` never saves);
  - B-013 (only `com.swag.*` frames are highlighted or blamed);
  - F-007 (no Clear in the UI);
  - F-011;
  - T-003.

## 11. Timeline: screens, lifecycle, marks and markers

- **Status:** ✅ `b474131`
- **What it gives you:** screen names, app lifecycle, tester bookmarks and custom markers on one timeline, which feeds Replay.
- **How it works:**
  - **Screens.** `Killcam.screen(name, props)` sets the current screen, which is stamped on every later event, and asks for a frame 450 ms later. A repeated name is ignored. If the app never reports screens, the activity's name is used 800 ms after it resumes. Once the app calls `screen()`, that fallback is off for the rest of the process.
  - **Lifecycle:** "Process start", "<Activity> created", "Foreground" and "Background".
  - **Marks** come from four places, each with its own label:
    - `Killcam.mark(label)`;
    - long-pressing the bubble ("Marked from bubble");
    - the notification's action ("Marked from notification");
    - `POST /api/timeline/mark` ("Marked moment").

    Each adds a `mark` event and a forced frame. **Marks are kept even while paused**, but the frame isn't.
  - **Custom markers:** `Killcam.timeline(label, props)`, "Action: <label>", "Deep link: <uri>", and the note "Screenshots skipped: secure window (FLAG_SECURE)".
  - Events are inserted in `ts` order. Types: `screen`, `tap`, `lifecycle`, `screenshot`, `mark`, `custom`.
  - **In Swag Pay**, `KillcamTraceBridge` turns SwagTrace `screen:` markers into `Killcam.screen` calls, with properties such as `kind: compose`, `rn` or `native_view`. `action:` and `step:` markers become timeline markers, and `nav:` is skipped.
- **Code:** `android/Killcam.kt:151-168`; `android/internal/KillcamRuntime.kt:107-122`; `android/internal/ActivityTracker.kt:21-57`; `core/store/KillcamStore.kt:337-369`; `core/server/KillcamServer.kt:216-227`.
- **API:** `screen(name, properties)`, `timeline(label, properties)`, `mark(label)`. HTTP: `GET /api/timeline`, `POST /api/timeline/mark {label?}`; live event `timeline`.
- **Limits:** 5,000 events; screen fallback after 800 ms; frame after a screen change at 450 ms.
- **Survives a restart:** only inside saved sessions.
- **Security:** n/a.
- **Checked on:** device vivo V2514 in Swag Pay: lifecycle, screens from SwagTrace, `action:` and `step:` markers, all in time order. Marking a moment from the phone was not tried.
- **Tests:** `CoreUnitTest.pausedStoreDropsDataButKeepsMarks`; `ServerTest.writesNeedKillcamHeader`, `liveStreamDeliversEvents`.
- **Open items:** T-013 (an unreachable 409), T-003.

## 12. Screenshots

- **Status:** ✅ `b474131`
- **What it gives you:** a strip of frames on the timeline, taken on screen changes, around taps, when the screen settles, on marks, on demand and at a crash. The bubble never appears in frames, and secure windows are never captured.
- **How it works:**
  - **Capture.** PixelCopy copies the **activity window**, downscaled to at most 540 px wide.
  - **Processing**, on the `killcam-capture` thread:
    - an 8×8 average hash, dropping a non-forced frame within 2 bits of the previous one;
    - a JPEG at quality 70;
    - a `screenshot` timeline event.
  - Frames are stamped with the time and screen **at capture**, not when encoding finishes.
  - **Triggers:**

    | Trigger | When | Forced |
    |---|---|---|
    | `screen` | 450 ms after a screen change | no |
    | `touch` | on finger down | no |
    | `after-tap` | 700 ms after finger up | no |
    | `settle` | every 2,500 ms in the foreground, if nothing was captured in the last 2,500 ms | no |
    | `mark` | on a mark | yes |
    | `manual` | `POST /api/screenshot` | yes |
    | `crash` | at a crash | yes |

  - Non-forced captures are at least 300 ms apart. Nothing is captured when paused, when the in-app window is on top, or before the view is laid out.
  - **Secure windows.** For a window with `FLAG_SECURE`, no frame is taken, and "Screenshots skipped: secure window (FLAG_SECURE)" is added once per screen.
  - **The crash frame** is drawn in software from the view tree on the main thread. Off the main thread it uses PixelCopy with a 400 ms wait.
- **Code:** `android/internal/ScreenCapture.kt`: `request` `:61-72`, `capture` `:89-118`, `capturable` `:121-135`, `store` `:138-146`, `averageHash` `:149-159`, `captureForCrash` `:166-201`, constants `:203-208`; `core/KillcamCore.kt:289-313`; `core/session/SessionStore.kt:48-57`.
- **API:** config `captureScreenshots`. HTTP: `POST /api/screenshot` (the event, or 204 when nothing could be captured); `GET /api/sessions/{id}/screenshots/{shot}` (`image/jpeg`, cached as immutable; `{id}` may be `live`).
- **Limits:** 540 px wide; JPEG quality 70; 300 ms between non-forced frames; a 2,500 ms settle period; a dedupe threshold of 2 of 64 bits; 300 screenshots for the live session.
- **Survives a restart:** `files/killcam/sessions/<liveId>/screenshots/`. An unsaved session is deleted at the next launch.
- **Security:** frames of non-secure screens can contain personal data. Taps on secure screens still leak (B-003).
- **Checked on:** device vivo V2514 in Swag Pay: a frame pulled from the phone looked right, with no bubble. Timestamps and order were fixed and checked on the phone.
- **Tests:** only through the demo's AWT renderer (`ServerTest.saveExportAndCrashRecovery`). PixelCopy, the hash, dedupe and `FLAG_SECURE` are untested.
- **Notes:**
  - Dialogs, bottom sheets, popups and toasts are separate windows and never appear (F-008).
  - The software crash frame misses SurfaceView, TextureView and GPU content.
  - `POST /api/screenshot` has no timeout if the main thread is blocked (inferred).
- **Open items:** B-003, B-015, F-008, F-004.

## 13. Taps

- **Status:** ✅ `b474131`
- **What it gives you:** taps, long presses and swipes on the timeline, drawn over the frames in Replay. In View-based screens, the tapped element is named.
- **How it works:**
  - **Hooking.** In `onActivityCreated`, the activity's `Window.Callback` is wrapped in a proxy that sees every touch before any view does.
  - **Finger down** stores the position and asks for a `touch` frame.
  - **Finger up** classifies the gesture: `swipe` if it moved more than twice the touch slop; else `long_press` if it lasted longer than the long-press timeout; else `tap`.
  - **The event** holds `{x, y}` as fractions of the window, plus `x2`/`y2` for swipes and the duration. Then an `after-tap` frame is requested.
  - **The target**, for a non-swipe, is the deepest visible clickable view, TextView or leaf. It is named by its content description (≤ 60 characters), else its text (≤ 40, quoted), else `#<resource id>`, else its class. For Compose, React Native and WebView host views it is null, and only the position is kept.
- **Code:** `android/internal/TouchTracker.kt`: `wrap` `:32-41`, `record` `:74-102`, `describeTarget` `:110-120`, `HOST_VIEWS` `:136`; hooked from `ActivityTracker.kt:23`.
- **API:** config `captureTaps`. HTTP: through `/api/timeline`.
- **Limits:** part of the 5,000-event timeline.
- **Survives a restart:** only inside saved sessions.
- **Security:** **taps are recorded on secure windows too, with button text** (B-003).
- **Checked on:** device vivo V2514 in Swag Pay: taps and swipes with positions. Swag Pay is Compose and React Native, so no targets were named.
- **Tests:** untested.
- **Notes:** only activity windows are wrapped, so dialogs and popups aren't tracked. Multi-touch and cancel are ignored.
- **Open items:** B-003, F-008, F-009.

## 14. The Replay page

- **Status:** ✅ `b474131`. 🚧 being rebuilt (F-001, step 2).
- **What it gives you:** a player for any session:
  - a phone frame that shows the screenshot at the playhead, with tap markers;
  - a scrubber with ticks for screens, taps, error calls, marks and crashes;
  - an event feed;
  - and for a crash, "play the last 15 s".
- **How it works** (`dash/panels/ReplayPanel.tsx`, at `b474131`):
  - **The stage.** The newest screenshot at or before the playhead stays up until the next one has loaded, and the next 3 are preloaded while playing. Taps show within ±1,500 ms of the playhead. A HUD shows the screen name, and a crash overlay shows from 30 ms before the crash.
  - **Transport:**
    - previous and next frame, play and pause, and 1×, 2× and 4× speed;
    - the Killcam button seeks to the crash minus 15 s, plays, and stops 300 ms after the crash;
    - zoom: All, 60 s or 15 s;
    - for the live session, a Live button that follows the head, and "Capture a screenshot now".
  - **The scrubber** is a slider (←/→ ±1 s, Shift ±5 s), with the last 15 s banded.
  - **The feed** merges timeline events, every network call, events, W/E/A log lines and this session's crashes, sorted by `ts` then `seq`. Its filters are UI, Network, Logs, Events and Shots; Shots is off by default. Clicking an item seeks to it. Calls and crashes open a drawer with their detail.
  - **Where it starts:** 15 s before a focus link, or before a crash; else at the live head; else at the start.
- **Code:** `dash/panels/ReplayPanel.tsx`: feed `:93-144`, start position `:199-207`, playback `:222-249`, hotkeys `:322-328`, scrubber `:585-651`, ticks `:653-690`.
- **API:** reads `view.timeline`, `view.network`, `view.logs` and `view.sessionCrashes`, plus screenshots and `POST /api/screenshot`.
- **Limits:**
  - a 15,000 ms crash window;
  - a ±1,500 ms tap window;
  - at most 250 ms of advance per animation frame;
  - the live end is re-read every 1,000 ms;
  - a feed row is 34 px.
- **Survives a restart:** n/a.
- **Security:** n/a.
- **Checked on:** demo server and mock server (the crash replay, in headless Chrome at 1440×900 and 390×844). Not on a phone.
- **Tests:** untested.
- **Notes:**
  - Ticks aren't virtualised: up to 5,000 DOM nodes live (inferred).
  - The drawer has no focus management.
  - The feed hides V, D and I log lines, with no toggle.
- **Open items:** F-001, T-010, B-015.

## 15. Sessions and bug bundles

- **Status:** ✅ `b474131`. The Sessions page is a 🚧 placeholder in the rebuilt shell.
- **What it gives you:**
  - a live session;
  - saved snapshots, made by hand or at a crash, listed in a session picker;
  - any session exported as a zip bug bundle;
  - on the phone, **Share bug bundle**, which opens the Android share sheet.
- **How it works:**
  - **The live session id** is `yyyyMMdd-HHmmss-xxxx`.
  - **A manual save** gets the id `<liveId>-s<n>` and an optional label. It copies only the screenshots the timeline references, then writes `session.json` and `summary.json`.
  - **A crash save** writes into the live directory (section 10).
  - **Pruning at startup:** directories without `summary.json` are deleted, then the newest 10 saved sessions are kept, by directory name.
  - **The zip** holds `session.json`, `network.har`, `screenshots/<id>.jpg` and `README.txt` (app, device, session, crash and a file guide).
  - **Share** (`KillcamActivity.shareBundle`):
    - builds `cache/killcam-share/killcam-<id>.zip` of the **live** session;
    - shares it through a `FileProvider` (authority `${applicationId}.killcam.files`);
    - uses the subject "Killcam bug bundle · <app>".
  - **The session picker:**
    - at `b474131`, a dropdown with delete;
    - rebuilt (🚧), a sortable table in a popover with "Follow live", no delete, and a session box in each page header.
  - **Saved sessions are read-only.** Mocks, Flags, Storage and Actions still act on the live app.
- **Code:** `core/session/SessionStore.kt`: save `:75-88`, delete `:99-102`, export `:105-127`, readme `:129-140`, prune `:142-147`; `core/KillcamCore.kt:150-193`; `android/internal/ui/KillcamActivity.kt:172-198`; `dash/shell/SessionPicker.tsx`, `dash/shell/actions.ts` (🚧).
- **API:** HTTP:
  - `GET /api/sessions` and `POST /api/sessions {label?}`;
  - `GET /api/sessions/{id}` and `DELETE /api/sessions/{id}` (404 for the live session);
  - `GET /api/sessions/{id}/export`;
  - screenshots as in section 12.

  On the phone: the bridge's `shareBundle()`.
- **Limits:** 10 saved sessions, enforced only at startup; 300 live screenshots; ids must be 1–64 characters of letters, digits, `-` and `_`.
- **Survives a restart:** saved and crash sessions under `files/killcam/sessions/`, and the last shared zip in the cache.
- **Security:** ids are checked before touching disk. A bundle holds everything captured, including unredacted bodies, and sharing sends it to any app the tester picks.
- **Checked on:** demo server and mock server; unit tests. **Sharing from a phone has not been tried** (T-003).
- **Tests:** `ServerTest.saveExportAndCrashRecovery`. Delete, pruning, exporting saved sessions and sharing are untested.
- **Open items:** F-006 (share and export saved sessions; the download-listener watch-out), F-001 (the Sessions page and delete), B-015, T-013.

## 16. Pausing capture and clearing data

- **Status:** ✅ `b474131`
- **What it gives you:** stop recording without uninstalling, and clear one stream or all of them.
- **How it works:**
  - **While paused**, these are dropped: new calls (mocks still apply), logs, timeline events and screenshots. **Marks and crashes are kept.**
  - Pausing emits a `status` event.
  - **Clearing** takes one of `network`, `logs`, `crashes`, `timeline` or `all`, and emits `cleared`. It doesn't touch saved sessions, mocks, flags or screenshot files.
  - **Dashboard:**
    - Pause/Resume is in the top bar (or the ⋯ sheet on the phone), with the toast "Capture paused: nothing new is recorded";
    - Network and Logs each have Clear; there is no Clear for crashes, the timeline or everything (F-007).
- **Code:** `core/store/KillcamStore.kt:70,130,272,345,373-388`; `core/KillcamCore.kt:110-113`; `core/server/KillcamServer.kt:184-191`; `dash/shell/actions.ts:11-20` (🚧).
- **API:** HTTP: `POST /api/capture {paused}` (returns `KillcamStatus`); `DELETE /api/data?stream=…` (204; an unknown stream gives 400).
- **Limits:** n/a.
- **Survives a restart:** no; a restart always records.
- **Security:** n/a.
- **Checked on:** mock server; unit tests at the store level.
- **Tests:** `CoreUnitTest.pausedStoreDropsDataButKeepsMarks`. The endpoints are untested.
- **Notes:** pausing does not stop the logcat process, request-body serialisation or event encoding (T-005). Logcat lines from the paused period are skipped for good, not held back (section 9).
- **Open items:** B-005 (the phone doesn't show the pause), B-015, F-007, T-005.

## 17. Flags

- **Status:** ✅ `b474131`
- **What it gives you:** every flag the app declares, with its default, remote and override values. Testers flip flags live, and overrides survive restarts.
- **How it works:**
  - **Effective value** = override ?: remote ?: default. `source` says which one applied.
  - **Declaring** is idempotent, but a new type silently replaces the old one.
  - **Overrides** are normalised by type:
    - boolean accepts true/1/on/yes and false/0/off/no;
    - int must parse as a Long;
    - double must parse as a number;
    - json must parse;
    - string is kept as is.
  - Overriding an undeclared key gives 404, and "Reset all" clears every override.
  - **Listeners** run on the thread that made the change, which is a server thread for dashboard edits.
  - **The Flags page:**
    - search, an "Overrides N" chip, and "Reset all overrides";
    - grouped by `group`;
    - an editor per type: a switch, a select for options, a JSON dialog, or number and string inputs;
    - `#/flags/<key>` (from Remote Config's Override) finds and highlights the flag.
  - Flags read once at startup need **Restart app** to take effect.
- **Code:** `core/flags/FlagRegistry.kt`: `register` `:59-82`, `setRemote` `:92-100`, `setOverride` `:102-110`, `clearOverride` `:112-120`, `normalize` `:155-170`; `android/Killcam.kt:180-228`; `dash/panels/FlagsPanel.tsx:12-33,179-287`.
- **API:** `booleanFlag`, `stringFlag(…, options)`, `intFlag`, `doubleFlag`, `jsonFlag` (each with `key`, `default`, `description?`, `group?`); `setRemoteFlag(key, value?)`; `addFlagListener` and `removeFlagListener` (`KillcamFlagListener`). HTTP: `GET /api/flags`, `PUT /api/flags {key, value}`, `DELETE /api/flags?key=` (with no key, it clears all); live event `flags`.
- **Limits:** none.
- **Survives a restart:** overrides in `files/killcam/flags.json`. Declarations and remote values are in memory only.
- **Security:** n/a.
- **Checked on:** demo server, mock server, unit tests. Swag Pay declares no flags, so none were checked on the phone.
- **Tests:** `ServerTest.flagOverridesPersistAcrossRestart`, `mmkvAndRemoteConfig`.
- **Notes:** in release, the no-op's flag reads return the value from `setRemoteFlag`, else the default (section 31).
- **Open items:** B-018, B-007.

## 18. Firebase Remote Config

- **Status:** ✅ `b474131`
- **What it gives you:**
  - the Remote Config page: every active key with its source (remote, default or static), the last fetch status and time, and the minimum-interval and timeout settings;
  - **Fetch & activate**;
  - every key mirrored into Flags, under the group "Firebase Remote Config", so testers can override it.
- **How it works:**
  - **Detection.** `killcam` compiles against `firebase-config` as `compileOnly`. A provider is created only if the class is present at runtime. If Firebase isn't initialised, the page gets 503.
  - **Reading** takes a snapshot, with no network call.
  - **Fetch & activate** runs `fetch(0)`, which ignores the minimum interval, then `activate()`. Timeouts are swallowed, and the status reports what happened.
  - **Mirroring** registers each new key as a flag, with its type inferred from the value: boolean, int, double, JSON or string. It then sets the flag's remote value to the fetched value if the source is `remote`, else to null. Mirroring runs at server start, and on every `GET /api/remote-config` and fetch.
  - **An override only reaches code that reads the key through Killcam**, because Firebase has no local override hook. For example: `Killcam.intFlag("upi_lite_limit_paise", default = remoteConfig.getLong("upi_lite_limit_paise").toInt())`.
  - **Where the values come from today:** the code path is real Firebase, but no real project is configured anywhere. Swag Pay has no `firebase-config`, and its page reports unavailable. The sample starts Firebase with **placeholder options** (`projectId "killcam-sample"`) and hard-coded defaults, so there "Fetch & activate reports an honest failure" by design.
- **Code:** `android/internal/Integrations.kt:32-36,150-198`; `core/KillcamCore.kt:39,256-284`; `core/platform/Platform.kt:79-84`; `dash/panels/RemoteConfigPanel.tsx`.
- **API:** no `Killcam.*` call. HTTP: `GET /api/remote-config` (501 `remote_config_unavailable`); `POST /api/remote-config/fetch`.
- **Limits:** fetch timeout = the app's `fetchTimeoutInSeconds` + 5 s; activate 10 s. Times on the page refresh every 30 s. There is no live event, so use Reload.
- **Survives a restart:** only flag overrides. Firebase persists its own activated values.
- **Security:** Fetch & activate changes the running app's config, outside its own activation timing.
- **Checked on:** unit tests with `FakeRemoteConfig`; demo server; mock server. On the vivo: it correctly reported unavailable in Swag Pay. **Never run against a real Firebase project.**
- **Tests:** `ServerTest.mmkvAndRemoteConfig`. The Android provider is untested.
- **Open items:** B-007 (mirroring wipes app-pushed remote values; the type is fixed at first sight).

## 19. Storage: SharedPreferences

- **Status:** ✅ `b474131`
- **What it gives you:** list, view, edit, add and delete prefs, applied live to the app's in-memory `SharedPreferences`.
- **How it works:**
  - **On the phone:**
    - lists `shared_prefs/*.xml`, hiding `killcam_*`;
    - writes by type (String, Boolean, Int, Long, Float, or StringSet as a JSON array) with `commit()`, then reads the value back.
  - **The Prefs tab of the Storage page:**
    - file list, filter, Reload and Add entry;
    - editors per type: a switch; chips for a string set, with a one-per-line dialog; a date shown under epoch-millisecond longs; a textarea for long strings;
    - a value commits on blur.
- **Code:** `android/internal/AndroidStorage.kt:28-86`; `core/server/KillcamServer.kt:285-298`; `dash/panels/StoragePanel.tsx:78-360`.
- **API:** HTTP: `GET /api/prefs`, `GET /api/prefs/{file}`, `PUT /api/prefs/{file} {key, type, value}`, `DELETE /api/prefs/{file}?key=`.
- **Limits:** none.
- **Survives a restart:** it is the app's own data.
- **Security:** a file name with `/` is rejected.
- **Checked on:** device vivo V2514 in Swag Pay (3 prefs files listed; editing not tried); demo server; unit tests.
- **Tests:** `ServerTest.storageEndpoints` against in-memory prefs. The Android provider is untested.
- **Notes:**
  - Writing a type the app doesn't expect can throw `ClassCastException` in the app (inferred).
  - EncryptedSharedPreferences show ciphertext.
  - DataStore is not supported (F-010).
- **Open items:** B-017, F-010.

## 20. Storage: SQLite

- **Status:** ✅ `b474131`
- **What it gives you:** the app's databases with their tables, views and row counts; paged, sortable browsing; and a SQL console for reads and writes.
- **How it works:**
  - **On the phone:**
    - each request opens its own read-write connection and closes it;
    - `-journal`, `-wal` and `-shm` files are hidden.
  - **Browse:**
    - the table must exist in the schema;
    - `orderBy` must be a real column, or it is dropped;
    - identifiers are quoted.
  - **The console:**
    - a statement starting with `select`, `pragma`, `with`, `explain` or `values` is run as a query;
    - anything else is run with `execSQL`, and `affectedRows` comes from `changes()`;
    - errors come back in `error` with status 200.
  - **Cells** are NULL, integer, real, `<blob N bytes>`, or text cut at 4,000 characters.
  - **The Databases tab:**
    - Browse is 50 per page, with First, Prev, Next and Last and a sort by header;
    - SQL runs with ⌘/Ctrl+Enter;
    - clicking a cell opens it with a JSON tree and epoch decoding.
- **Code:** `android/internal/AndroidStorage.kt`: `databases` `:96-108`, `browse` `:110-125`, `query` `:127-145`, `tables` `:154-168`; `core/server/KillcamServer.kt:325-343`; `dash/panels/StoragePanel.tsx:723-1000`.
- **API:** HTTP: `GET /api/db`; `GET /api/db/{name}/tables/{table}?offset&limit&orderBy&desc`; `POST /api/db/{name}/query {sql}`.
- **Limits:** browse `limit` 1–500 (default 50); query results capped at 500 rows (`truncated`); cells cut at 4,000 characters, and at 140 in the dashboard's table.
- **Survives a restart:** writes go to the app's database.
- **Security:** database names are sandboxed. The console runs **any SQL, including DROP and DELETE**, by design. "SQL identifiers are validated" applies to browse only.
- **Checked on:** device vivo V2514 in Swag Pay (ML Kit's database, 12,750 rows, browsed); demo server; unit tests.
- **Tests:** `ServerTest.storageEndpoints` (a canned 137-row database; the syntax-error path). The Android provider is untested.
- **Notes:**
  - `GET /api/db` counts every table on every call, which is slow on large databases.
  - Writes bypass Room's invalidation (inferred).
  - SQLCipher databases list with empty tables.
- **Open items:** B-012, B-017.

## 21. Storage: MMKV

- **Status:** ✅ `b474131`
- **What it gives you:** view, edit and delete keys in the default MMKV instance and in instances the app registers, encrypted ones included.
- **How it works:**
  - **Detection.** A provider exists only if `com.tencent.mmkv.MMKV` is on the classpath. If `MMKV.initialize()` hasn't run, the page gets 409.
  - **Which instances.** It opens only `mmkv.default` and the ids registered with `Killcam.registerMmkv(id, cryptKey, multiProcess)`, and **never scans** the directory. Opening an encrypted store without its key fails the CRC check, and MMKV then **discards the file**.
  - **Types are inferred**, because MMKV stores none. Using the encoded size and the payload size, in this order:
    1. 1 byte: 0 or 1 is Bool, else Int;
    2. length-prefixed: valid UTF-8 is String, else Bytes (base64);
    3. 8 bytes: Double if finite, else Long;
    4. 4 bytes: Float;
    5. anything else: a varint Long.
  - **The MMKV tab:**
    - instances with key count, size, an "encrypted" badge and any error, such as a CRC failure;
    - a type select per key: **changing it re-encodes the value immediately**;
    - base64 bytes with a hex preview.
  - **react-native-mmkv** stores live in the JS runtime. Use Rozenite's `@rozenite/storage-plugin` for those.
- **Code:** `android/internal/Integrations.kt:29-30,38,45-143`; `android/Killcam.kt:43,237-241`; `core/server/KillcamServer.kt:301-314`; `dash/panels/StoragePanel.tsx:364-719`.
- **API:** `Killcam.registerMmkv(id, cryptKey = null, multiProcess = false)`, before or after install. HTTP: `GET /api/mmkv` (501 `mmkv_unavailable`), `GET /api/mmkv/{id}`, `PUT /api/mmkv/{id} {key, type, value}`, `DELETE /api/mmkv/{id}?key=`.
- **Limits:** none.
- **Survives a restart:** the app's MMKV files. Registrations are in memory only.
- **Security:** the crypt key is kept in memory and never returned, only `encrypted: true`. Registering an encrypted id with a wrong key or the wrong process mode could trigger the same discard (inferred).
- **Checked on:** unit tests with `FakeMmkv`; demo and mock servers (an encrypted instance, and one with a CRC error). Swag Pay has no MMKV, so its page correctly reports unavailable. The sample's MMKV was never run.
- **Tests:** `ServerTest.mmkvAndRemoteConfig`. The Android provider and the inference are untested.
- **Open items:** B-009 (misread types; a type change rewrites the value), T-012 (API.md's inference rules are incomplete).

## 22. Storage: Files

- **Status:** ✅ `b474131`
- **What it gives you:** browse, view, download and delete files in the app's own directories.
- **How it works:**
  - **Roots** (listed only if they exist): `files`, `cache`, `databases`, `shared_prefs`, `no_backup` and `external` (`getExternalFilesDir`).
  - **Paths** are canonicalised, symlinks included, and must stay inside the root.
  - **Listings** put directories first. Delete is recursive, and a root can't be deleted.
  - **The Files tab:**
    - breadcrumbs, size and modified time;
    - a viewer: files over 1 MiB load only on request; binary is detected by a NUL byte in the first 8,192 bytes and shown as a hex dump of 512 bytes; JSON shows as a tree or raw;
    - Download (hidden in the in-app window) and Delete.
- **Code:** `core/platform/Platform.kt:91-126` (`DirectoryFilesProvider`); `android/internal/AndroidPlatform.kt:59-71`; `core/server/KillcamServer.kt:346-363`; `dash/panels/StoragePanel.tsx:1004-1208`.
- **API:** HTTP: `GET /api/files/roots`; `GET /api/files?root&path`; `GET /api/files/content?root&path[&download=1]`; `DELETE /api/files?root&path`.
- **Limits:** none on the phone.
- **Survives a restart:** n/a.
- **Security:** traversal is blocked (`../` and `..%2F` give 404, tested). Any private file can be downloaded, including tokens in prefs and the databases, by design.
- **Checked on:** device vivo V2514 in Swag Pay (listed); demo server; unit tests.
- **Tests:** `ServerTest.storageEndpoints` (list, content, traversal). Delete and roots are untested.
- **Notes:** nothing stops deleting `files/killcam`, which holds Killcam's own sessions, flags and mocks (T-013).
- **Open items:** F-013 (image preview, upload, edit), T-013.

## 23. Device info and Session details

- **Status:** ✅ `b474131` (the Device page). 🚧 the Session details dialog replaces it.
- **What it gives you:** everything about the app, the phone, the runtime and the connection, with Copy.
- **How it works:** `infoSections()` is rebuilt on every request, and saved into every bundle:
  - **App:** package, version, build type, min and target SDK, installed and updated times, installer, data dir.
  - **Device:** model, Android version and API, security patch, ABIs, screen, locale and time zone, battery, network, and whether it is an emulator.
  - **Runtime:** pid and uptime, Java and native heap, device memory, thread count.
  - **App-provided:** `Killcam.setInfo` rows. Swag Pay adds "Repositories = FakeMobileRepository (prototype data)".
  - **Killcam:** version, session, port, the USB command, Wi-Fi sharing, and whether capture is on.
  - **In the rebuilt shell (🚧):**
    - the session box in each page header opens **Session details**, which shows the session in view (`bundle.app` for a saved one);
    - it has a Connection section for the live app, and Copy details;
    - it does not refresh `/api/info` when opened.
- **Code:** `android/internal/AndroidPlatform.kt:44-55,76-124,166-188`; `core/KillcamCore.kt:73-74,117-146`; `android/Killcam.kt:171-176`; `dash/shell/SessionDetails.tsx` (🚧); `dash/panels/DevicePanel.tsx` (at `b474131`).
- **API:** `Killcam.setInfo(key, value?)`; a null value removes the row. HTTP: `GET /api/info` (`AppInfo`), `GET /api/status`.
- **Limits:** none.
- **Survives a restart:** no; `setInfo` rows are in memory, and copied into saved bundles.
- **Security:** shows the data dir and installer (debug builds only).
- **Checked on:** device vivo V2514 in Swag Pay; demo server; mock server.
- **Tests:** `ServerTest.servesInfoAndDashboardFallback` (package name only).
- **Notes:** section failures are swallowed, and the section comes back empty.
- **Open items:** F-001 (refresh on open), T-012 (the README still lists a Device page).

## 24. Actions and deep links

- **Status:** ✅ `b474131`
- **What it gives you:** buttons the app defines, such as "Reset onboarding" or "Expire session", plus the built-in **Restart app**, and a deep-link launcher limited to the app.
- **How it works:**
  - **Actions:**
    - an action's id is a slug of its label, so re-registering a label replaces the action;
    - actions run on the **main thread**, and every exception is caught and shown as a failure;
    - each run adds "Action: <label>" to the timeline.
  - **Deep links** use `ACTION_VIEW`, limited to the app's own package. With no matching activity, the result is "No activity in … handles …". A launch adds "Deep link: <uri>" to the timeline.
  - **The Actions page:**
    - a URI box, and chips for up to 8 recent URIs;
    - action cards grouped by `group`, each with Run and its last result;
    - a confirm for groups named like `danger` or `destructive`, and for labels like crash, wipe, clear data or log out.
- **Code:** `core/platform/ActionRegistry.kt:12-34`; `android/internal/AndroidPlatform.kt:128-147`; `android/Killcam.kt:249-253`; `core/server/KillcamServer.kt:366-375`; `dash/panels/ActionsPanel.tsx`.
- **API:** `Killcam.registerAction(label, description?, group?) { … ; "result text" }`, before or after install. HTTP: `GET /api/actions`; `POST /api/actions/{id}` (`{ok, message}`); `POST /api/deeplink {uri}`.
- **Limits:** none. A long action blocks the UI thread.
- **Survives a restart:** no. Recent deep links are kept in the browser (`killcam.deeplinks`).
- **Security:** anyone with API access can run app code (see T-001).
- **Checked on:** device vivo V2514 in Swag Pay: Restart app and Reset onboarding were listed but **not run**. Mock server.
- **Tests:** untested.
- **Open items:** B-006 ("Trigger test crash" can't crash), B-014 (Swag Pay examples are hard-coded), T-001.

## 25. Entry points: bubble, shake and notification

- **Status:** ✅ `b474131`
- **What it gives you:**
  - **The bubble:** a draggable 44 dp button over the app. Tap it to open the in-app window. Long-press it to mark a moment, which gives a haptic and the toast "Killcam: moment marked". Drag it and it snaps to the nearer edge.
  - **Shake:** two firm shakes open the in-app window.
  - **The notification:** an ongoing, low-importance notification, "Killcam · recording". It shows the `adb` command, or the Wi-Fi URL and PIN. Tapping it opens the window, and it has a **Mark moment** action.
- **How it works:**
  - **The bubble** is a `PopupWindow`, a window of its own. So it needs no overlay permission and never appears in screenshots. It is attached on every activity resume except the in-app window's. Its dot pulses every 600 ms while recording.
  - **Shake** uses the accelerometer, only in the foreground. A shake is at least 2.7 g, the second must come 200–1,000 ms after the first, and there is a 2,000 ms cooldown.
  - **The notification** uses channel `killcam` (low importance, no badge). The in-app window asks for `POST_NOTIFICATIONS` on API 33+. `KillcamReceiver` (not exported) handles the mark action.
- **Code:** `android/internal/Bubble.kt` (attach `:33-42`, long-press `:88-93`, touch `:119-155`, constants `:172-177`); `android/internal/ShakeDetector.kt:12-54`; `android/internal/Notifier.kt:16-59`; `android/internal/KillcamReceiver.kt`.
- **API:** config `showBubble`, `shakeToOpen`, `showNotification`; `Killcam.open(context)`.
- **Limits:** a 44 dp bubble with a 6 dp edge; the shake values above; notification id `0x4B1C`.
- **Survives a restart:** the bubble's side and height in `shared_prefs/killcam_ui.xml`, which is hidden from the Prefs tab.
- **Security:** the notification shows the Wi-Fi PIN while sharing is on (T-001).
- **Checked on:** device vivo V2514 in Swag Pay: tapping the bubble opened the window, and the bubble was absent from frames. **Long-press, shake and the notification were not tried** (T-003).
- **Tests:** untested.
- **Notes:** the bubble still has the old palette (amber ring `#F2A900`), not the rebuilt dashboard's red.
- **Open items:** B-005 (pause isn't reflected), T-003.

## 26. In-app window and native bridge

- **Status:** ✅ `b474131` (native side). The page it shows is being rebuilt (F-001), and phones load a stale bundle (B-002).
- **What it gives you:** the full dashboard on the phone (`?embed=1`), plus native abilities: close, share a bug bundle, Wi-Fi sharing with the PIN, the clipboard, and system-bar colours that follow the theme.
- **How it works:**
  - **The activity** (`KillcamActivity`):
    - a plain `Activity`, with no AppCompat or Compose;
    - `singleTask`, with its own task affinity, so it shows as "Killcam" in recents;
    - not exported;
    - handles rotation and theme changes itself.
  - **The WebView** loads `http://127.0.0.1:<port>/?embed=1`:
    - it retries every 600 ms, up to 10 times, while the server binds;
    - any other URL opens outside the window;
    - Back goes through WebView history, then closes;
    - insets pad the system bars, cutout and keyboard;
    - **every download is turned into `shareBundle()`**.
  - **The page** needs cleartext to `127.0.0.1` in the app's debug network-security config. Swag Pay's already allowed it for Metro, and the sample has a debug-only overlay.
  - **The rebuilt phone layout** (🚧):
    - a 48 px top bar: live swatch, session, Mark, ⋯ and ✕;
    - bottom tabs: Logs, Network, Replay, Crashes and More, with the last tab remembered;
    - a ⋯ sheet: Pause, Save, Share bug bundle, Connect a laptop (USB command, Wi-Fi switch, URL and PIN) and Theme.
  - **The bridge** is `window.KillcamNative`. It exists only in the in-app window, so feature-detect it. `dev/fake-native.js` (`?fakeNative=1`) stubs it for testing.

    | Method | Does |
    |---|---|
    | `close()` | Closes the window |
    | `shareBundle()` | Zips the **live** session and opens the share sheet |
    | `getConnection()` | JSON `{port, usbCommand, wifiEnabled, wifiUrl, pin}`; `pin` only while sharing |
    | `setWifiSharing(on)` | Rebinds the server, then fires `killcam-native {type:"connection"}` on `window` |
    | `setChrome(background, light)` | Paints the status and navigation bars to match the page |
    | `copy(text)` | Native clipboard |

- **Code:** `android/internal/ui/KillcamActivity.kt`: `onCreate` `:52-65`, `buildWebView` `:80-100`, `loadDashboard` `:105-119`, `NativeBridge` `:130-167`, `shareBundle` `:172-198`, `applyInsets` `:219-231`, `setChrome` `:234-241`; `dash/lib/native.ts`; `dash/shell/Embed.tsx` (🚧); `killcam/src/main/AndroidManifest.xml:11-33`.
- **API:** `Killcam.open(context)`; the bridge above.
- **Limits:** 10 load attempts, 600 ms apart. The bridge's `setWifiSharing` waits for the event, or 8,000 ms, in the dashboard.
- **Survives a restart:** the WebView's local storage (theme, last tab).
- **Security:**
  - the bridge is exposed to every frame in the WebView (the dashboard has no iframes);
  - any XSS in the dashboard could read the PIN or turn sharing on;
  - the server-error page is inserted unescaped (low risk).
- **Checked on:** device vivo V2514 in Swag Pay: it opens full screen from the bubble, with no status-bar overlap and no duplicate header, and Logs shows 351 lines. That was with the **old** page UI. The bridge features (Close, Share, the Wi-Fi switch) need the new bundle (B-002) and were not tried.
- **Tests:** untested.
- **Open items:** B-002, F-001, F-006 (the download listener; sharing saved sessions), T-001, T-003.

## 27. Dashboard shell

- **Status:** ✅ `b474131` (the old shell, which doesn't typecheck: B-001). ✅ the new shell: `44ec8e0`.
- **What it gives you:** navigation, the session picker, the live connection, capture controls, the theme, keyboard shortcuts, the PIN screen, and three layouts: desktop, phone (`?embed=1`) and DevTools (`?embed=devtools`).
- **How it works:**
  - **Routing** is by hash: `#/<page>/<segments>?focus=<id>`. An unknown page goes home, which is Replay on the desktop and Logs on the phone. Selecting in a list replaces the history entry, so it doesn't stack.
  - **Navigation** (🚧):
    - Analyse, Run and Data groups, numbered;
    - the sidebar is 232 px, the rail 72 px, and the drawer 264 px below 760 px;
    - each page has a one-line hint in its header;
    - there are no count badges yet.
  - **The top bar** (🚧):
    - the session picker, and capture status in words (Connecting…, Reconnecting…, Paused, Recording);
    - Pause/Resume, **Mark moment**, Save session and Export .zip;
    - a Dark/Light theme button.
  - **The theme** is dark by default. It is stored in `killcam.theme`, read before first paint, and passed to the bridge's `setChrome`. The system preference is ignored.
  - **The PIN screen** appears on any `pin_required`:
    - it accepts 4–8 digits (`autocomplete=one-time-code`);
    - it parks requests and replays them after a correct PIN;
    - it shows "Wrong PIN, try again." or "Device unreachable.".
  - **Dialogs** are the dashboard's own, because `window.confirm` and `window.prompt` do nothing in an Android WebView. Opening a new one resolves the open one with null.
  - **Android Back:** each sheet or dialog owns one history entry, so Back closes it.
  - **Shortcuts:**

    | Key | Where | Does |
    |---|---|---|
    | `/` | everywhere | focus the page's search |
    | Esc | search | clear, then blur |
    | `j` / ↓, `k` / ↑, Esc | Network, Logs, Crashes | next, previous, close |
    | Space or `k`, ← / → | Replay | play/pause, previous/next frame |
    | ⌘/Ctrl+Enter | SQL console | run |
    | Enter / Esc | inline editors | commit / revert |

    Keys are ignored with modifiers and inside inputs.
  - **Browser storage:**

    | Key | Holds |
    |---|---|
    | `killcam.theme` | the theme |
    | `killcam.rail` | whether the rail is pinned (`killcam.navCollapsed` in the old bundle) |
    | `killcam.embed.lastPanel` | the last page on the phone |
    | `killcam.split.*` | split-view widths |
    | `killcam.dock.width` | the detail dock's width |
    | `killcam.deeplinks` | recent deep links |
    | `killcam.logs.hiddenTags` | hidden log tags |

    Storage is per origin, so `localhost:8090`, the Wi-Fi address and Vite's `:5173` each keep their own.
- **Code:** `dash/state/router.ts`, `dash/shell/routes.ts`, `dash/state/app.ts`, `dash/state/store.ts`, `dash/state/ui.ts`, `dash/api/client.ts`, `dash/lib/back.ts`, `dash/lib/hooks.ts`, `dash/lib/storage.ts`; 🚧 `dash/shell/AppShell.tsx`, `Sidebar.tsx`, `TopBar.tsx`, `PageHeader.tsx`, `SessionPicker.tsx`, `SessionDetails.tsx`, `PinScreen.tsx`, `Embed.tsx`, `actions.ts`; `dash/kit/overlays.tsx`.
- **API:** the HTTP client sends `X-Killcam: 1` on writes, uses page-relative `api/…` URLs, and turns a network failure into "Device unreachable".
- **Limits:** up to 4 toasts, removed after 3,800 ms each.
- **Survives a restart:** the browser storage above.
- **Security:** the dashboard makes no external requests, and fonts are bundled.
- **Checked on:**
  - mock server and demo server: headless Chrome at 1440×900 and 390×844 for the old shell;
  - the new shell at 1440 px and 412 px (`?embed=1&fakeNative=1`) on 2026-09-24 16:07, with no console errors and no overflow.
  - Not on a phone.
- **Tests:** none (T-004).
- **Open items:** B-001, F-001 (with the "Checks before it lands" list), B-011, B-014, T-009, T-010.

## 28. Network, Logs and Crashes pages

These pages present features described above: calls in section 5, logs in section 9, crashes in section 10. What follows is what the pages add. **Status:** ✅ `b474131`; 🚧 being rebuilt (F-001, steps 2–3).

- **Network page:**
  - filter by text (URL or screen), method, status class (2xx–5xx, Failed, Pending) and host;
  - Mocked-only and Errors-only chips, and Follow;
  - Download HAR (live session only, not on the phone) and Clear calls;
  - a virtualised list, 28 px rows at `b474131` and 40 px in the rebuild.

  The rebuild (🚧) adds KPIs (Calls, Errors, Median time, Received, Mocked), responsive columns, and a card list on the phone.
- **Call detail:**
  - Overview (with a timing bar scaled to 3 s), Request (query parameters, headers, body), Response, and cURL;
  - bodies as a JSON tree or raw, images inline, and a hex dump of 512 bytes for other binary;
  - Mock this.

  The rebuild (🚧) moves the detail into a dock, and shows other calls started within 5 s of this one.
- **JSON trees** render 200 children at a time, and nothing over 4,000,000 characters is parsed.
- **Logs page:** section 9.
- **Crashes page:** section 10.
- **Code:** `dash/panels/NetworkPanel.tsx`, `NetworkDetail.tsx`, `LogsPanel.tsx`, `CrashesPanel.tsx`; `dash/components/BodyView.tsx`, `JsonTree.tsx`, `VirtualList.tsx`, `SplitView.tsx`.
- **Checked on:** mock server, demo server.
- **Tests:** none.
- **Open items:** F-001, T-010, B-013.

## 29. Design system

- **Status:** ✅ `b474131` (vendored); used by the rebuilt shell and pages (🚧).
- **What it gives you:** the same look, components and conventions as swagperf.
- **How it works:**
  - **Vendored.** `dash/design/` is an exact copy of `~/Documents/perfetto-monitor/frontend/src/design`, made by `scripts/sync-design-system.sh [path] [--fonts]`, which runs `rsync --delete` and writes `dashboard/design-system.lock`. The lock records source commit `d007f5a`, synced 2026-09-24T09:44:49Z, 104 files.
  - **Never edit `design/`;** wrap it in `dash/kit/`.
  - Feature code imports only from `@/design`.
  - **Fonts:** Zalando Sans Expanded for display and Poppins for the UI, bundled in `dash/fonts/` (latin and latin-ext, OFL). `--fonts` fetches them once.
  - **Tokens:**
    - dark and light themes, with the accent `#f9423a`;
    - status tokens `--pass`, `--warn` and `--fail`;
    - the console is dark in both themes;
    - page padding is 32 px, or 16 px at 759 px and below.
  - **Killcam's own parts** in `dash/kit/`:
    - `controls.tsx` (icon buttons with 40 px targets, inputs, HTTP status, method tag);
    - `console.tsx` (JSON and body blocks, stack lines, the blamed frame);
    - `VTable`, `VirtualList` and `Icon`;
    - `overlays.tsx` (🚧: Sheet, Dock, Dialog and Toast hosts, and a point menu).
- **Code:** `dash/design/`, `dash/kit/`, `scripts/sync-design-system.sh`, `dashboard/design-system.lock`, `dashboard/dev/fetch-fonts.mjs`.
- **Survives a restart:** n/a.
- **Checked on:** mock server (the rebuilt shell).
- **Tests:** the vendored tests can't run here (T-004).
- **Open items:** T-008 (two copies that can drift; Q2), T-009.

## 30. Rozenite panel

- **Status:** ✅ `b474131`
- **What it gives you:** Killcam as a panel inside React Native DevTools, next to Rozenite's own panels. It needs no code in the app.
- **How it works:**
  - **The package** is `@swag/rozenite-killcam-plugin` 0.1.0, with one panel, "Killcam".
  - **Connecting.** It probes `http://localhost:<port>/api/status` with a 1,500 ms timeout, and again every 3,000 ms while nothing answers. When something answers, it shows an iframe of `/?embed=devtools`: the desktop layout, denser, with no brand, and the rail pinned.
  - The port defaults to 8090, is editable, and is stored in `killcam.devtools.port`.
  - **When disconnected**, it shows setup steps: the `adb forward` command with Copy.
  - **In Swag Pay**, Metro loads it when `WITH_ROZENITE=true`.
- **Code:** `rozenite-plugin/src/killcam-panel.tsx`, `rozenite-plugin/rozenite.config.ts`, `rozenite-plugin/react-native.ts`.
- **API:** none in the app.
- **Limits:** the timeouts above.
- **Survives a restart:** the port, in DevTools' storage.
- **Security:** it assumes `adb forward` to localhost.
- **Checked on:** Metro logged "Loaded 1 plugin(s)", and the panel rendered from Metro's plugin route in headless Chrome. **Never inside a live React Native DevTools window** (T-003).
- **Tests:** none.
- **Notes:** `dist/` is gitignored, so run `npm run build` in `rozenite-plugin/` before an app can load it.
- **Open items:** T-011, T-003.

## 31. No-op artifact and API parity

- **Status:** ✅ `b474131`
- **What it gives you:** release builds compile against the same API and do nothing: no server, no Ktor, no manifest entries.
- **How it works:**
  - **`noop/Killcam.kt`** mirrors every public member:
    - `install` returns false, and everything else does nothing;
    - flag reads return the value pushed with `setRemoteFlag`, else the default;
    - `setRemoteFlag` notifies listeners.
  - **`KillcamInterceptor`** just proceeds.
  - `KillcamConfig`, `KillcamLevel` and `KillcamFlagListener` come from `shared/`, so both artifacts use identical files. On the branch, `KillcamNetwork.kt` joins them.
  - **`scripts/check-noop-api.sh`:**
    - compiles both modules;
    - runs `javap -public` on the shared types;
    - drops mangled `internal` members, sorts and diffs;
    - exits 1 on any difference and writes `/tmp/killcam-api.diff`.
- **Code:** `noop/Killcam.kt:13-120`, `noop/KillcamInterceptor.kt:7-11`, `scripts/check-noop-api.sh`.
- **API:** identical signatures.
- **Limits:** n/a.
- **Survives a restart:** n/a.
- **Security:** nothing ships in release.
- **Checked on:**
  - compiled: 53 signatures matched at build time;
  - the sample's minified release APK has no Killcam or Ktor classes;
  - Swag Pay's release has 6 no-op classes and no Ktor.
- **Tests:** the script only; it isn't wired into Gradle or CI (T-004).
- **Notes:** "R8 strips the calls" (README) is unverified. The empty calls stay unless R8 inlines them.
- **Open items:** T-004, T-012.

## 32. Sample app

- **Status:** ✅ `b474131`
- **What it gives you:** a demo app (`com.krafton.killcam.sample`) that exercises every page on a real phone: `./gradlew :sample:installDebug`.
- **How it works:**
  - **Install:** `Killcam.install(this, KillcamConfig(redactHeaders = setOf("Authorization")))`, and OkHttp with `KillcamInterceptor()`.
  - **Setup:**
    - `setInfo("Environment", "sample")`;
    - actions "Reset onboarding" and "Trigger test crash" (which can't crash: B-006).
  - **Storage seeds:**
    - prefs `sample-startup`;
    - MMKV default, plus encrypted `sample.secure` with key `"sample-key"`;
    - SQLite `transactions.db` (3 rows and a view `recent`);
    - `files/receipts/txn_8Q2K.json`;
    - a placeholder Firebase with 4 Remote Config defaults.
  - **Buttons**, all calling httpbin.org with `Bearer sample-token`: Home, Scan, Pay ₹249, Slow PSP (`/delay/3`), Server error (`/status/500`), Receipt image, Gzip response, Log a warning (both `Killcam.w` and `Log.w`), Non-fatal, and Crash the app.
  - **Flags read:** `pay.new_pin_pad` and `home.banner_variant`.
  - **Network security:** the release config forbids cleartext. The debug overlay allows only `127.0.0.1` and `localhost`.
- **Code:** `sample/SampleApp.kt:21-95`, `sample/MainActivity.kt`, `sample/src/debug/res/xml/network_security_config.xml`.
- **Checked on:** debug and minified release **built**; **never installed on a phone** (T-003).
- **Notes:**
  - Not exercised: `mark`, `recordError`, `setRemoteFlag`, int, double and JSON flags, listeners, and Ktor.
  - "Gzip response" doesn't exercise Killcam's own decompression, because OkHttp gunzips transparently (inferred).
- **Open items:** T-003, B-006.

## 33. Desktop demo and mock server

- **Status:** ✅ `b474131`
- **What it gives you:** the dashboard running without a phone, in two ways:
  - the **demo server**: the real Kotlin server with fake Swag Pay data;
  - the **mock server**: a Node imitation of the whole API.
- **How it works:**
  - **The demo server** (`./gradlew :killcam-core:demo`; port `KILLCAM_PORT` or 8090):
    - `FakePlatform` provides in-memory prefs, a canned `swag-pay.db` (137 rows), real files, `FakeMmkv`, `FakeRemoteConfig`, and AWT-drawn 360×780 screenshots;
    - it seeds a previous crash session once: `IllegalStateException("VPA handle missing for payee")` on the PIN screen;
    - a simulator steps every 1.5–3.5 s through Home, Scan, EnterAmount, Pin and TransactionDetail, with taps, calls, logs, errors and non-fatals;
    - Wi-Fi sharing can't be turned on (there is no endpoint).
  - **The mock server** (`cd dashboard && npm run mock`; `dev/mock-server.mjs`):
    - it implements every endpoint with seeded fake data and serves the built dashboard;
    - scenarios: a previous crash session, a labelled saved session, and a live session with three passes of the pay flow (200, 402, 500), a mocked call, a timeout, a DNS failure, a truncated response and a long-poll;
    - a live beat every 2–4 s, with SSE `retry: 2000` and a ping every 15 s;
    - its SQL understands simple `SELECT`s only, capped at 500 rows;
    - "Trigger test crash" simulates a process death and a restart, which exercises reconnect;
    - **it serves screenshots as SVG**, where the real API serves JPEG.

    Environment variables:
    - `PORT`;
    - `MOCK_REQUIRE_PIN=1` (PIN `123456`, or `MOCK_PIN`);
    - `MOCK_NO_STORAGE=1`, or a list such as `prefs,mmkv`;
    - `MOCK_QUIET=1`.

    It enforces `X-Killcam`, but not the Host or loopback rules.
  - **Vite dev** (`npm run dev`, :5173) proxies `/api` to `KILLCAM_URL`. It keeps `Host: localhost:5173`, which the phone accepts, and passes SSE through unbuffered.
- **Code:** `core-test/demo/DemoServer.kt`, `core-test/demo/FakePlatform.kt`, `killcam-core/build.gradle.kts:33-39`; `dashboard/dev/mock-server.mjs`, `dashboard/dev/fake-native.js`, `dashboard/vite.config.ts`.
- **Checked on:** both were used to check every page in headless Chrome.
- **Notes:** the demo only uses a mock rule's status and body. The mock server implements F-002's endpoints too (`ac1b09f`).
- **Open items:** T-001 (the watch-out that the mocks must follow any new access rule).

## 34. Swag Pay integration

- **Status:** 🚧 uncommitted, in the worktree `~/Documents/swag-pay-killcam`, branch `killcam-integration`, based on `aa5482a`.
- **What it gives you:** Killcam in Swag Pay's debug build, with every Compose, React Native and native screen named from SwagTrace, with no per-screen code.
- **How it works:**
  - **`apps/mobile/settings.gradle.kts`:** `includeBuild` of the sibling Killcam checkout (default `../../../killcam`, overridden by `-Pkillcam.dir`), only if it exists.
  - **`composeApp/build.gradle.kts`:** `debugImplementation("com.krafton.killcam:killcam:0.1.0")` and `releaseImplementation("…:killcam-no-op:0.1.0")`.
  - **`SwagPayApplication.kt`:** `installKillcam()` runs **first** in `onCreate`, before `SoLoader.init`, so startup itself is on the timeline.
  - **`debugtools/KillcamSetup.kt`:**
    - `installKillcam()` installs with the default config and adds a Device row and a "Reset onboarding" action;
    - `KillcamTraceBridge` maps SwagTrace markers to screens and markers, and reassembles SwagErrors' JS-error records into `Killcam.recordError(…, fatal)`.
  - **`trace/SwagTrace.android.kt`** and **`trace/SwagErrors.android.kt`** call the bridge.
  - **React Native:** `metro.config.js` wraps Metro in `withRozenite(…, { enabled: process.env.WITH_ROZENITE === 'true' })`, and `package.json` adds `@rozenite/metro` plus the plugin as `file:../../../../killcam/rozenite-plugin`.
- **Checked on:** device vivo V2514 (see the Host apps table in TRACKER.md for exactly what was and wasn't checked). Debug is about 3 MB bigger than without Killcam (183.3 MB against 180.4 MB); the dashboard is 0.4 MB of that.
- **Tests:** none.
- **Open items:**
  - T-006 (needs a sibling checkout);
  - T-007 (the bridge runs in release);
  - F-005 (no network capture);
  - T-002 (no redaction);
  - F-004 and swagperf B-009 (never a performance run);
  - T-003.

## 35. Build, commands and bundling

- **Status:** ✅ `b474131`
- **Modules:**
  - `:killcam-core`: pure JVM, JDK 17, explicit API. It depends on Ktor server CIO 3.6.0, coroutines 1.11.0 and serialization 1.9.0.
  - `:killcam`: Android library, compileSdk 36, minSdk 26. `compileOnly`: OkHttp 4.12.0, MMKV 2.4.2 and firebase-config 23.1.0. Its consumer rules keep `com.krafton.killcam.**`.
  - `:killcam-no-op`: Android library. Its only dependency is `compileOnly` OkHttp.
  - `:sample`: the sample app.
- **Tool versions:** AGP 8.12.1, Kotlin 2.4.10, Gradle 8.14.3. The dashboard uses React 19.3.0, Vite 8 and TypeScript 7.
- **Group and version:** `com.krafton.killcam` and `0.1.0` (`gradle.properties`). The version is also hard-coded in `core/KillcamCore.kt:36` (T-013). Nothing is published (T-006).
- **Commands:**

  | Command | Does |
  |---|---|
  | `./gradlew :killcam-core:test` | 20 JVM tests |
  | `./gradlew :killcam-core:demo` | Demo server on :8090 |
  | `./scripts/check-noop-api.sh` | API parity check |
  | `./gradlew :sample:installDebug` | Sample app on a phone |
  | `cd dashboard && npm run build` | `tsc --noEmit && vite build` into `killcam-core/src/main/resources/killcam-web/` (the whole folder is replaced) |
  | `cd dashboard && npm run mock` | Mock server |
  | `cd dashboard && npm run dev` | Vite on :5173, proxying to `KILLCAM_URL` |
  | `cd rozenite-plugin && npm run build` | Rozenite panel |
  | `scripts/sync-design-system.sh [path] [--fonts]` | Re-sync swagperf's design system |

- **Bundling:** the built dashboard ships inside the killcam-core JAR and is served from the classpath (`killcam-web/…`). It is committed, so Android builds need no Node. Nothing checks that it matches `dashboard/src` (B-002).
- **Open items:** B-001, B-002, T-004, T-006, T-013.

---

## Reference

### Memory budgets

| Stream | Cap | When full | Where |
|---|---|---|---|
| Network calls | 500 (`maxNetworkCalls`) | Oldest calls dropped | `KillcamStore.kt:229-235` |
| Body, per request or response | 131,072 B (`maxBodyBytes`) | Cut in the interceptor, marked truncated | `KillcamInterceptor.kt:163-167` |
| Bodies, total | 24 MiB (in-heap weight: text × 2 + base64) | Oldest calls' bodies replaced with `[evicted: …]` | `KillcamStore.kt:236-252` |
| Logs | 5,000 | Oldest dropped | `:288` |
| Timeline | 5,000 | Oldest dropped | `:363` |
| Crashes | 50 | Oldest dropped | `:323` |
| Live screenshots | 300 files | Oldest file deleted | `SessionStore.kt:48-57` |
| Saved sessions | 10 | Pruned at startup | `SessionStore.kt:142-147` |
| Dashboard live store | network 1,000, logs 5,000, timeline 5,000 | Oldest dropped | `dash/api/live.ts:22` |

### Threads

| Thread | Runs |
|---|---|
| App and OkHttp threads | The interceptor, mock delays, store updates (one lock; live events go out after it is released) |
| Main | Install, activity callbacks, the bubble, capture scheduling, the shake sensor, actions and deep links, the bridge's UI work |
| `killcam-server` | Starts Ktor. Requests run on Ktor's pool; disk work hops to `Dispatchers.IO`. |
| `killcam-logcat` (minimum priority) | Spawns `logcat` every 1 s or 5 s |
| `killcam-capture` (background) | PixelCopy callbacks, hashing, JPEG encoding, screenshot files |
| `killcam-wifi` | Server rebinds |
| Unnamed daemon | Share-bundle zip |
| The dying thread | The crash save |
| The caller's thread | Flag listeners |

### Files on the phone

Under `files/killcam/`:
- `flags.json`: flag overrides.
- `mocks.json`: mock rules. Hit counts reset.
- `sessions/<id>/{session.json, summary.json, screenshots/*.jpg}`: saved and crash sessions (the newest 10). The previous live directory is deleted at startup unless it has `summary.json`.
- On the branch, also network conditions and dashboard-added endpoints.

Elsewhere:
- `shared_prefs/killcam_ui.xml`: the bubble's position.
- `cache/killcam-share/killcam-<id>.zip`: the last shared bundle.

Not kept across a restart: the unsaved session, pause, Wi-Fi sharing and its PIN and tokens, `setInfo` rows, actions, MMKV registrations, and remote flag values.

### Tests

All 20 are in `killcam-core` (JUnit 4). The branch adds `NetworkFaultsTest`, `EndpointsAndBreakpointsTest` and an Android `NetworkFaultsTest`.

- `CoreUnitTest`:
  - `globMatchesWholeUrl`
  - `decodesGzipEvenWhenTruncated`
  - `binaryBodiesAreBase64`
  - `bodyBudgetEvictsOldestBodiesFirst`
  - `countCapDropsOldestCalls`
  - `pausedStoreDropsDataButKeepsMarks`
  - `hostAndLoopbackRules`
  - `pinLocksOutAfterRepeatedFailures`
  - `recordsNonJvmErrorsAsNonFatalCrashes`
- `ServerTest` (a real CIO server on a random port in 19,000–19,899, with `FakePlatform`):
  - `servesInfoAndDashboardFallback`
  - `rejectsForeignHostHeader`
  - `writesNeedKillcamHeader`
  - `networkLifecycleAndCurl`
  - `mockCrudAndMatching`
  - `flagOverridesPersistAcrossRestart`
  - `storageEndpoints`
  - `mmkvAndRemoteConfig`
  - `saveExportAndCrashRecovery`
  - `liveStreamDeliversEvents`
  - `wifiSharingRequiresPinFromLan`

**Untested:**
- all of the `killcam` Android module;
- the no-op and the sample;
- all of the dashboard;
- these endpoints: `/api/capture`, `/api/data`, `/api/timeline`, `/api/screenshot`, `DELETE /api/sessions/{id}`, `PUT /api/mocks/{id}`, `GET /api/prefs`, `GET /api/db`, `/api/files/roots`, `DELETE /api/files`, `/api/actions*` and `/api/deeplink`;
- the 429 lockout over HTTP;
- pruning.

See T-004.

## Commit timeline

| Commit | Branch | Date (IST) | What |
|---|---|---|---|
| `68325b8` | `main` | 2026-09-24 12:02 | Initial commit (README only) |
| `b474131` | `main` (pushed) | 2026-09-24 15:22 | Killcam v1: every module, the dashboard sources and a stale built bundle, docs, scripts and the Rozenite plugin. 255 files. The dashboard doesn't typecheck (B-001). |
| `44ec8e0` | `main` (pushed) | 2026-09-24 16:54 | The dashboard rebuilt on swagperf's design system, and the product-manager setup (F-001, B-001, B-002) |
| `d2448a5` | `feature/network-fault-injection`, merged into `main` | 2026-09-24 16:08 | Plan: `docs/plans/network-faults.md` (F-002) |
| `1b6d521` | `feature/network-fault-injection`, merged into `main` | 2026-09-24 16:16 | Network conditions, failure injection, endpoint catalogue, repeat and breakpoints: Kotlin, server and tests (F-002) |
| `190c042` | `feature/network-fault-injection`, merged into `main` | 2026-09-24 16:25 | README and API.md for F-002 |
| `ac1b09f` | `feature/network-fault-injection`, merged into `main` | 2026-09-24 17:08 | F-002's dashboard on the design system: the conditions card, failure rules, the Endpoints page, Repeat, the breakpoint bar; `types.ts`, the mock server, a rebuilt bundle |

The branch's first commits (`da88e16`, `10bed46`, `1822bcc`, `ad624f0`, `0a5ea3e`) were replaced when it was rebased onto `44ec8e0` at about 17:00; `da88e16`, a snapshot of the shell, was dropped because `44ec8e0` commits it.
