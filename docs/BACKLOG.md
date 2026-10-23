# Backlog

Deferred and in-flight work on Killcam and its integration into apps. Each entry records why the item matters, not just what it is, so it stays actionable once the conversation that produced it is gone.

These are the long write-ups. The live list, with status and priority for every item, is [TRACKER.md](TRACKER.md); each entry here carries its tracker ID. How each feature works today is in [FEATURES.md](FEATURES.md).

---

## The dashboard rebuilt on swagperf's design system

**Tracker:** F-001 (swagperf F-015)
**Status:** in progress. The rebuild is committed to `main` as `44ec8e0` (2026-09-24 16:54). `da88e16`, an earlier snapshot of step 1 on the F-002 branch, was dropped when that branch was rebased onto `44ec8e0`.
**Raised:** 2026-09-24

### What

Killcam's dashboard is rebuilt from swagperf's design system and shell conventions, so the two tools look and behave the same. Killcam's API and wire contract (`dashboard/src/api/types.ts`) don't change.

### Why

- At 15:04 on 2026-09-24 the user reported, with a phone screenshot, that "the in-app view is very clumsy and does not display any logs". The screenshot showed two stacked KILLCAM headers under the status bar, with Share cut off.
  - The logs part was a logcat stall on Android 16, since fixed.
  - The native header was removed.
- At 15:07 the user asked: "first we can have the same UI/UX for this tool as well, and then secondly will try to club the two tools" (F-003).

### Decisions already taken

- **Vendor, don't import.**
  - swagperf's `frontend/src/design` is copied exactly into `dashboard/src/design/` by `scripts/sync-design-system.sh`, and recorded in `dashboard/design-system.lock`.
  - Killcam's own components are wrapped in `dashboard/src/kit/`, never edited into `design/`, so "the later merge is a deletion".
  - swagperf's product manager recommended building inside swagperf's `frontend/` instead. That is Q2, still open.
- **Fonts are bundled** (Poppins and Zalando Sans Expanded, OFL, about 140 KB), because the phone may be offline.
- **Navigation** follows swagperf:
  - **Analyse:** Replay, Network, Logs, Crashes.
  - **Run:** Mocks, Flags, Remote Config, Actions.
  - **Data:** Sessions, Storage.
  - Items are numbered. The sidebar collapses to a rail of two-letter codes, and becomes a drawer below 760 px.
- **Session picker:** it works like swagperf's Run picker, with "Follow live".
- **Session box and details:** every page header has a session box, which opens a **Session details** dialog. The dialog replaces the Device page and has "Copy details".
- **Phone layout (`?embed=1`):**
  - One top bar of about 48 dp: live swatch, session, Mark, ⋯ and ✕.
  - Bottom tabs: Logs, Network, Replay, Crashes, More. Logs is the default, and the last tab is remembered.
  - A ⋯ sheet: Pause/Resume, Save session, Share bug bundle, Connect a laptop (the USB command, a Wi-Fi switch, the URL and the PIN in large digits) and Theme.
  - Touch targets are at least 40 px, with no horizontal scroll at 360–430 px.
- **Wording**, following swagperf:
  - British spelling, and no playful copy: no "No crashes. GG.", no upper-case CRASH or FATAL badges, and "Replay the last 15 s" instead of "Watch killcam".
  - Status is never shown by colour alone (✓ ! ✕, ▲ ▼ =).
  - A unit on every number, and "–" or "not measured" instead of a made-up 0.
  - Empty states say why the page is empty and what to do next.
  - Links land on what they name and ring it briefly (`?focus=`).
- **Timeline order:** sorted by `ts`, then `seq`. A screenshot is stamped at capture time, which can be earlier than events recorded while it was being encoded.
- **`setChrome`:** called on load and on every theme change.

### Shape of the work

1. Shell: `AppShell`, `Sidebar`, `TopBar`, `PageHeader`, `SessionPicker`, `SessionDetails`, `PinScreen`, `Embed` and `actions.ts`. This is done in `44ec8e0`.
2. Logs, Network and Replay (the phone frame, player, banded scrubber and event feed).
3. Crashes, Mocks, Flags and Remote Config.
4. Storage, Sessions, Actions and Session details.
5. Check against the real Killcam server (`./gradlew :killcam-core:demo`), then rebuild Swag Pay and install it on the vivo. Then commit the rebuilt bundle (B-002) and the source together, so `main` builds (B-001).

### Checks before it lands

These were found by reading the working tree at 16:12; recheck each one against the final code.

- The sidebar lost the count badges it had at `b474131`: call count, red when there are errors; log lines; crashes; enabled mocks; overridden flags.
- The disconnect banner shows at once. It used to wait 1,200 ms, so a quick reconnect didn't flash it.
- **Sessions:**
  - there is no way to delete a saved session (the old picker had one);
  - picking a session from a Run or Data page doesn't navigate anywhere, so nothing visibly changes;
  - `#/sessions` is a "Coming in the next build" placeholder.
- **Session details:** it doesn't refresh `/api/info` when opened, and it calls `getConnection()` on every render.
- **Legacy layouts (inferred):** `legacy.css` declares `container: main` on the class `.main`, and the new `<main>` uses a module class. Every legacy `@container main` rule therefore stops applying, including the phone layouts of pages that haven't been rebuilt yet.
- **Toasts (inferred):** the toast store removes a toast after 3,800 ms, while `ToastHost` shows errors for 4,800 ms.
- **Hotkeys (inferred):** they are no longer suppressed under the new Dialog and Sheet. `hooks.ts` looks for `.modal-backdrop`, which no longer exists.
- On the phone at 16:07, log rows were cut off after a few characters instead of wrapping to two lines.
- `?focus=` links: `NetworkDetail` links to `mock:<id>`, but the Mocks page renders no `data-hl` target yet.
- Remove `legacy.css` and the duplicated components (T-009). Recheck B-010, B-011, B-014 and T-010 against the new pages.

### Watch-outs

- Another session is doing this work. Don't edit `dashboard/` from a product-manager task; record findings here.
- `npm run build` replaces the whole `killcam-web/` folder (`emptyOutDir: true`). Commit the old bundle's deletion together with the new files.

---

## Network conditions, fault injection, endpoint catalogue, repeat and breakpoints

**Tracker:** F-002
**Status:** ✅ merged into `main` on 2026-09-24 as a fast-forward: `d2448a5` (plan), `1b6d521` (Kotlin, server and tests), `190c042` (README and API.md) and `ac1b09f` (dashboard and bundle). The branch was rebased onto `44ec8e0` first, and its dashboard rebuilt on the design system.
**Raised:** 2026-09-24
**Plan:** `docs/plans/network-faults.md` on that branch (requirements R1–R8, scenarios S1–S20)

### What

- **Network conditions (R1).**
  - Global latency, jitter, download and upload caps, loss, and offline, for every call through `KillcamInterceptor`, mocked or not.
  - Presets: GPRS, 2G (EDGE), Slow 3G, Fast 3G, 4G, Flaky Wi-Fi and Offline, plus Custom.
  - Conditions persist across restarts, and every change is marked on the timeline.
- **More failure types (R2):** `dns_failure`, `connection_refused`, `connect_timeout`, `ssl_handshake`, `network_switch` (the body aborts after `dropAfterBytes`) and `unexpected_eof`. Each is thrown the way Android throws it.
- **Intermittent rules (R3):**
  - `times`: apply to the first N matches only;
  - `probability`: apply to a share of calls;
  - a re-arm action that resets a rule's hits.
- **API-error templates (R4):** in the dashboard only: 500, 503 and 429 with `Retry-After`, 401, an HTML 502, a 504 after 30 s, malformed JSON and an empty 200.
- **Programmatic API (R5):**
  - `Killcam.setNetworkProfile`, `setNetworkConditions`, `clearNetworkConditions`, `failRequests`, `mockResponse`, `removeMock` and `registerEndpoint`;
  - `/api/network-conditions` (GET, PUT, DELETE) and `/api/network-conditions/presets`;
  - `POST /api/mocks/{id}/reset`.
- **Endpoint catalogue (R6):**
  - The app's APIs by name. Sources are merged by key, later winning: `killcam-endpoints.json` shipped as a debug asset, `Killcam.registerEndpoint`, and testers' additions.
  - Endpoints: `/api/endpoints` and `/api/endpoints/export`.
  - `scripts/pull-endpoints.sh` writes the catalogue back into the app's repository for a PR. The phone never holds GitHub credentials.
- **Repeat (R7):**
  - `POST /api/network/{id}/repeat` re-sends a captured call through the app's own OkHttp client, 1 to 50 times, one after another or all at once, as it was or edited.
  - The last 300 calls can be repeated. Saved sessions can't.
- **Breakpoints (R8):**
  - A rule action that pauses matching calls before they are sent, or before the app reads the response. A tester can then edit, continue or fail them.
  - A paused call continues unchanged after 120 s (`BreakpointManager.timeoutMs`).
  - Endpoints: `/api/breakpoints`, `/api/breakpoints/{id}` and `/api/breakpoints/resume-all`.

### Why

Testers need to reproduce the bugs that only happen on bad networks: a payment screen that hangs on 2G, a retry loop that never succeeds, a crash when the connection drops mid-response, or DNS failing after a switch from Wi-Fi to mobile data. Before this, Mocks covered single calls with three failures only.

### Decisions already taken

- The decision logic (`NetworkConditionsEngine.plan()`, `times`, `probability`) lives in pure-JVM `killcam-core`, with an injectable random source and clock, so it is unit-tested without a phone.
- **Order inside the interceptor:**
  1. offline or loss;
  2. latency and jitter;
  3. the mock rule;
  4. the upload and download throttles;
  5. the `network_switch` abort.
- **Scope:** only traffic through `KillcamInterceptor`. WebViews, other HTTP stacks and native sockets are not throttled; that is stated in the docs. Per-host conditions are out of scope, because mock rules with `delay` cover per-URL behaviour.
- **Wire compatibility:** new rule fields have defaults, so an old `mocks.json` still loads.
- **No-op:** every new public call has a no-op, and `check-noop-api.sh` covers the new enums (`KillcamNetworkProfile`, `KillcamFailure`).

### What was built

- **The Kotlin side:** the API, server routes, `killcam-core` tests, and an Android `NetworkFaultsTest` for the OkHttp fault helpers.
- **The dashboard** (`ac1b09f`), on the design system and `kit/`:
  - **Mocks** gains the Network conditions card (presets, or custom latency, jitter, bandwidth, loss and offline), the new failure kinds with what each reproduces, API-error templates, a "When" section (the first N calls, a share of calls, re-arm), a Breakpoint action, and rules that target a catalogue endpoint.
  - **A new Endpoints page** (Run group, code `EP`) lists the catalogue by group with each endpoint's source, calls and errors. It lists uncovered paths seen in traffic, and exports `killcam-endpoints.json`. The in-app window shows compact cards.
  - **Network's call detail** can repeat a call: edited, N times, one after another or all at once.
  - **The shell** warns on every page but Mocks while conditions are on, and lists paused calls in a bar with an editor to continue, edit or fail each one.
- **The contract:** `types.ts`, the mock server, a rebuilt bundle, README sections ("Simulating bad networks", "The endpoint catalogue") and API.md, including curl recipes for test automation.

### What is left

- **Interceptor tests in the repository.** Eighteen tests against MockWebServer (throttling, drops, DNS-once-then-retry, repeat, breakpoints) passed on 2026-09-24, but they compile the interceptor against a stub `Killcam`, because `KillcamInterceptor` reads `Killcam.runtime`, which needs an `Application`. A seam that lets a test supply the runtime would bring them in (T-004).
- **A run on a phone** with the sample app, the only app that makes HTTP calls (T-003). Swag Pay needs F-005 first.

### Watch-outs

- **Repeat** sends real requests with the app's own auth and interceptors. On a payment API that means real double-submits. The plan calls this intended (scenario S16).
- **A breakpoint** blocks the app's calling thread for up to 120 s. A call made on the main thread would freeze the app, so the UI should warn about that.
- Measurements taken while conditions are on are meaningless for performance (see F-004).

---

## One tool: Killcam and swagperf combined

**Tracker:** F-003 (owned by swagperf F-016). Killcam's steps: T-007, F-016, T-014, F-004, F-017, F-018 and T-008.
**Status:** planned. The plan was agreed by Killcam's and swagperf's product managers on 2026-09-24; no step has started. It waits on the user's answers to Q1–Q7 and Q9.
**Raised:** 2026-09-24

The full write-up is swagperf's: `~/Documents/perfetto-monitor/docs/BACKLOG.md`, section "One tool: Killcam and swagperf combined". swagperf's product manager is recording the same plan there, with Killcam's IDs prefixed "Killcam". This entry holds Killcam's side.

### What

- Killcam becomes a lane beside Perfetto · Android, Instruments · iOS and Flashlight · Android (swagperf F-017). The user dismissed mixing lanes in one view (swagperf F-008).
- The lane is Killcam's own dashboard, served by the phone and embedded in swagperf's shell (F-017). swagperf's server forwards nothing.
- Links join the tools by screen name, JS-error identity and app version, **never by timestamp** (F-018, swagperf F-018). Killcam runs only in debug builds, and swagperf judges only release-like runs, so the two never measure the same process.
- **What only each tool has:**
  - Only Killcam: network and mocks, logs, replay with screenshots, flags and Remote Config, storage, actions and deep links, bug bundles, the phone workflow, Wi-Fi with a PIN, and Rozenite.
  - Only swagperf: startup, frames, RAM usage, CPU, hangs and budgets.
  - Both touch crashes, JS errors and screens.

### Decisions already taken

Agreed by both product managers on 2026-09-24. Each is still subject to the user's answer to the question named.

- **Two servers, and nothing forwarded (Q1).** swagperf's Killcam lane is an iframe of `http://127.0.0.1:8090/?embed=swagperf`. Its requests are same-origin, so writes keep `X-Killcam: 1` and Killcam's access rules don't change. swagperf's server only GETs link keys from `/api/sessions`, `/api/crashes` and `/api/info`, when a page is viewed. It keeps only the session id, screen names, JS-error identity and app version, and stores nothing else. It never reads `/api/timeline` or `/api/sessions/{id}`, which hold bodies, logs and tap text (B-003). Forwarding everything, swagperf's first recommendation, was withdrawn: a forwarder is a fully trusted loopback caller (T-001).
- **Debug builds (Q3).** swagperf never judges a debuggable build, or a build whose trace carries Killcam's marker (F-016). Every capture refuses such a build unless the capture opts in. An opted-in run is its own kind, *debug build*, which names Killcam when the marker is there. It follows swagperf's ADR 0002 simulator rules (no budgets, warn at most, no benchmark, skipped by triage) and keeps its own baseline. The kind is read from the recorded build details and the trace, so `reextract` keeps it.
- **Errors join on `error:js:<source>:<Name>` plus the app version**, pinned by T-014. A build that loads its JS from Metro never matches a release source map, so a link says "same error", not "same fingerprint".
- **Payment data stays out of swagperf's `history.db` and away from any model (Q6).** The Copilot gets no Killcam data in v1; later, link keys only.
- **The vendored design system stays (Q2)** until Q7 is answered. T-008 adds a lock check, and `kit/`'s generic parts go upstream.

How the plan keeps Killcam's product decisions (the product-manager skill's "Decisions already taken"):
- **Debug builds only (1)** and **never a performance run (10):** the no-op writes no marker, T-007 takes the bridge out of release builds, and a Killcam build is never judged by swagperf.
- **Nothing leaves the phone by default (2)** and **closed by default (3):** the embed keeps today's path from the phone to the laptop's browser. swagperf stores link keys only, and `frame-ancestors` narrows who can frame the dashboard.
- **One dashboard everywhere (4):** the lane is the same dashboard, shown in a fourth place.
- **One wire contract (5):** the only change is `SessionSummary.screens` (F-018), in `types.ts`, `Models.kt`, API.md and the mock server together.
- **The design system is swagperf's, vendored (7):** kept.

### The plan

⛔ marks a step that lands before `killcam-integration` merges into Swag Pay.

| # | Owner | Killcam | swagperf | What | Depends on |
|---|---|---|---|---|---|
| 1 ⛔ | swagperf | — | B-009 | The debug-build rule above. Refusing needs only the debuggable flag, which swagperf already records; naming Killcam needs step 3. | Q3 |
| 2 ⛔ | Killcam, in `swag-pay-killcam` | T-007 | — | The bridge moves out of release builds | — |
| 3 | Killcam | F-016 | — | Killcam names itself in the trace | — |
| 4 | swag-pay | T-014 | T-005 | One `SwagTrace` and `SwagErrors` definition, one shared fixture | — |
| 5 | Killcam, measured by swagperf | F-004 | — | Killcam's cost, without and with it, as stress tests (`-n 10`) | 1, 3 |
| 6 | swagperf | — | T-001 | Origin and Host checks, copying Killcam's Host allow-list and write header | — |
| 7 | Killcam | F-017 | — | The dashboard, embeddable in swagperf's lane | Q1 |
| 8 | swagperf | — | F-017 | The Killcam lane: the embed, the `perfetto_init` port forward, `doctor` through `/api/status` | 7; swagperf's lane-switch filter bug (its TESTING-PLAN IOS-D7, S-09) |
| 9 | swagperf | — | F-018 | Links by screen name, JS-error identity and app version, from a read-only GET | 4, 6, 8, 10; Killcam T-001's loopback secret, if one is added |
| 10 | Killcam | F-018 | — | Crashes and sessions link out to swagperf; `SessionSummary.screens` | 4, 8 |
| 11 | both | T-008 | F-015 | One design system: a lock check, and generic `kit/` parts upstream (they must meet swagperf T-003) | Q2 |
| 12 | both | F-003 | F-016 | One tool: the umbrella | 1–11, Q5, Q7 |

### Watch-outs

- **Loopback trust (T-001).** swagperf's server reaches `:8090` through `adb forward`, so Killcam trusts it fully. Only swagperf's own code keeps its reads to the three endpoints, until T-001 is decided.
- **Rozenite.** The `frame-ancestors` policy in F-017 must still let the Rozenite panel embed the dashboard (FEATURES section 30).
- **For the developer, not the user:** whether T-007 blocks the `killcam-integration` merge, and whether T-001 adds a loopback secret that step 9 must carry.

### Open questions (the user's call)

Q1, Q2 with Q7, Q3, Q4, Q5, Q6 and Q9 in [TRACKER.md](TRACKER.md#open-questions-for-the-user). Each carries the joint recommendation.

---

## What Killcam costs the host app

**Tracker:** F-004 (and T-005; relates to swagperf B-009; the marker is F-016)
**Status:** planned: step 5 of the joint plan ([one tool](#one-tool-killcam-and-swagperf-combined)). Not started. Needs swagperf B-009 and F-016. Blocked by Q3 and Q9.
**Raised:** 2026-09-24

### What

Measure what Killcam costs inside a Swag Pay debug build, with swagperf, so that developers and testers know what a Killcam build carries. swagperf never judges such a build: the runs are its opted-in *debug build* kind (Q3).

### Why

Killcam does work inside the app:
- it installs first in `Application.onCreate`, so its startup is on the timeline;
- it takes PixelCopy screenshots on every screen change, around taps, and as a settle frame every 2.5 s;
- it spawns `logcat -d` every second in the foreground, even while paused;
- it JSON-encodes every event even when no dashboard is open (T-005).

swagperf already decided (its F-012) that screenshots skew frames and startup. None of this has been measured.

### Decisions already taken

Agreed by both product managers on 2026-09-24:
- **Two states, not three:** the same Swag Pay debug build without Killcam and with Killcam. Pausing isn't "off" (below), so a paused state isn't measured.
- **The runs are swagperf stress tests (`-n 10`),** recorded as the *debug build* kind: no budgets, warn at most, no benchmark, skipped by triage, their own baseline. They never open performance issues.
- **The network conditions in force come from F-016's marker.** Conditions persist across restarts (F-002), so a tester's leftover conditions would otherwise go unseen.
- **No quiet switch.** A Killcam build is never a performance run (the skill's Decision 10), so Killcam needs no mode that makes it measurable. Dropping this item's pause half is Q9.

### What pausing stops, and what it doesn't

From the code at `f342f03`:
- **Stops:** new calls, logs and timeline events are dropped before they are built or encoded (`KillcamStore.kt:145,298,371`). No screenshots are taken (`ScreenCapture.kt:122`).
- **Doesn't stop:** `logcat` is still spawned every 1 s (T-005), and request bodies are still serialised (B-016). The settle timer still wakes the main thread every 2.5 s, then takes nothing (`ScreenCapture.kt:51-57`). Mocks and network conditions still apply (`KillcamInterceptor.kt:65`), and marks and crashes are still kept.

### Shape of the work

1. swagperf B-009 (the opt-in *debug build* kind) and F-016 (the marker) land.
2. Build the same Swag Pay debug build twice, with Killcam and without it.
3. Run swagperf stress tests (`-n 10`) on each and compare startup, frames, CPU and RAM usage. swagperf calls a shift real only when it is statistically significant and larger than the earlier test's spread.
4. Record the result in FEATURES.md (section 1 and the Reference) and here.

### Watch-outs

- A debug build loads its JavaScript from Metro, so its numbers describe Killcam's cost inside a debug build only, never the app's release performance.
- Network conditions (F-002) left switched on would distort any measurement. The marker records them; a run with conditions on should be discarded.

---

## Killcam names itself in the trace

**Tracker:** F-016 (for swagperf B-009 and F-004)
**Status:** planned: step 3 of the joint plan ([one tool](#one-tool-killcam-and-swagperf-combined)). No code.
**Raised:** 2026-09-24

### What

`Killcam` writes one fixed-name marker into the app's trace. It carries Killcam's version, the pause state, the capture switches (`captureScreenshots`, `captureTaps`, `captureLogcat`) and the network conditions, as a preset name or `custom`. It is written at install, on every foreground, and on every change to pause or network conditions.

### Why

swagperf must refuse a Killcam build, or name Killcam in an opted-in *debug build* run (swagperf B-009). Reading it from the trace means:
- the label travels with the trace, as swagperf's ADR 0002 does for the platform;
- `reextract` keeps it;
- nothing depends on the phone's server, which starts after install on its own thread (FEATURES section 1), so `/api/info` isn't there during a cold start.

### Decisions already taken

Agreed by both product managers on 2026-09-24:
- One fixed name. The values are build constants and states from a fixed set, never app data; swagperf reads its rule 13 ("markers carry only fixed names and outcome classes") as allowing this. If a developer reads the rule strictly, the version comes out.
- No public API change and no wire-contract change.

### Shape of the work

- **Install:** `KillcamRuntime.start()` (`killcam/.../internal/KillcamRuntime.kt:67`).
- **Foreground:** `KillcamRuntime.onForeground()` (`:143`).
- **Pause and network conditions** change inside pure-JVM `killcam-core`: `KillcamCore.setPaused` (`KillcamCore.kt:144`, called from `POST /api/capture`, `KillcamServer.kt:192-195`) and `conditions.set` and `clear` (from `KillcamServer.kt:293-296` and `Killcam.setNetwork*`, `Killcam.kt:306-335`). Core can't call `android.os.Trace`, so it gets an internal state-change callback that the runtime registers.
  - Not a `LiveListener`: that would make `hasListeners()` always true, so every event would be encoded (T-005).
  - The same callback can refresh the notification and restart the bubble's pulse, which fixes B-005.
- **The marker** is a zero-length `Trace.beginSection` and `endSection`, which works at minSdk 26.
- **Tests:** a `killcam-core` test that the callback fires on pause and on each conditions change.

### Watch-outs

- Agree the exact marker name and key format with swagperf's extractor before building. Android caps section names in length, so keep the keys short.
- The no-op writes no marker, and `check-noop-api.sh` doesn't cover `killcam-core`, so no no-op change is needed.
- swagperf sees the marker only when its capture records the app's own trace sections, as it already does for `SwagTrace`.

---

## Camera performance: Swag Pay's scanner

**Tracker:** F-019, F-020 and T-015, plus the camera family in T-014. swagperf: B-010, F-019, F-020, F-021, F-022 and T-005.
**Status:** parked (`backlog`) by the user on 2026-09-25, after Q10 and Q11 were answered and before any step started. See [Revisit when](#revisit-when). Drafted by Killcam's and swagperf's product managers on 2026-09-25.
**Raised:** 2026-09-25

swagperf's product manager records swagperf's side in `~/Documents/perfetto-monitor/docs/BACKLOG.md`, section "Camera performance: Swag Pay's scanner", with Killcam's IDs prefixed "Killcam". This entry holds Killcam's side and the joint plan.

### What

On 2026-09-25 the user asked for "camera specific performance monitoring logs" for Swag Pay's QR scanner, in Killcam "and also" in perfetto-monitor (swagperf). The metrics named were the camera's first frame, the time to process each frame, the time to resolve a QR, memory while the camera is open, and memory leaks.

### What the scanner does today

Read from `swag-pay` at `aa5482a` and `swag-pay-killcam` at `15963f5`. The camera files are the same in both, apart from a layout change. Paths are under `apps/mobile/composeApp/src/`.

- **Where:** the Home screen (`commonMain/.../camera/CameraHomeScreen.kt`, the scanner at `:191-350`), traced as `screen:Home#native_view`. React Native has no camera code.
- **Android:** CameraX 1.6.1 `Preview` and `ImageAnalysis` at 1280×720 (`androidMain/.../camera/CameraPlatformSurface.android.kt:204-221`), and ML Kit barcode scanning 17.3.0, the bundled model, for QR only (`:147-151`). The `PreviewView` is in `PERFORMANCE` mode (`:163-166`).
  - The analyser runs on one executor thread (`:146`) with `STRATEGY_KEEP_ONLY_LATEST` (`:219`). It decodes at most one frame every 250 ms and closes the rest unread (`:240-246,337`), and ignores a repeat of the same value for 1,500 ms (`:262,338`). `ImageProxy.close()` is called on every path (`:241-281`).
  - ML Kit's completion listener has no executor, so it runs on the main thread (inferred). A per-frame time taken at the listener therefore includes waiting for the main thread.
  - "First frame" today means the first **analysis** frame, not the first preview frame drawn, and it is never reset (`:236-239`).
- **iOS:** AVFoundation, in Kotlin/Native (`iosMain/.../camera/CameraPlatformSurface.ios.kt`). QR decoding happens inside `AVCaptureMetadataOutput` (`:212-219`), so the app never sees single frames. Per-frame time can't be measured on iOS without a different decoder.
- **After a valid UPI QR:** `QrValidator` checks for `upi://pay?` and a non-empty `pa` (`commonMain/.../camera/CameraModels.kt:46-73`). Home then opens Pay with a hard-coded payee (`AppShell.kt:233`), so the scanned value goes no further. Leaving Home disposes the camera session.
- **Markers:** only `action:qr_validate_<valid_upi|unsupported|invalid>` (`CameraModels.kt:36-42`) and `step:first_usable_camera_frame` (`AppCoordinator.kt:70`). The second fires only on the returning-user path, once per launch. The camera files have no spans, counters or logs.
- **The bridge** forwards instant markers only (`debugtools/KillcamSetup.kt:54-57`). Sync spans, counters and every async end are dropped (`trace/SwagTrace.android.kt:22-28,43,64,73,82`), so no duration reaches Killcam.
- No leak tooling (no LeakCanary), and no `FLAG_SECURE` anywhere in the app.
- **Not Killcam's to log, noted for the user:** the camera and the analyser keep running while the scanner shows as closed. The 10 s "closed" state changes only the look (`CameraHomeScreen.kt:112-116`), and `enabled = true` is hard-coded (`:239`).

### Decisions already taken

Drafted by both product managers on 2026-09-25. The user decided these, on 2026-09-25:
- **Q10, "I agree with your recommendation":** Killcam shows camera timings from debug builds, labelled "Debug build: includes Killcam's own work. Not comparable with swagperf or with a release build.". They have no budgets and no pass or fail, and swagperf never reads them. swagperf's product manager had recommended events only.
- **Q11, "Yes, do it":** LeakCanary goes into Swag Pay's debug build, and its leaks show in Killcam (F-020).
- **"Create a flavor for the release build that remains profilable":** a profileable variant of the release build, for swagperf's heap-dump runs (swagperf F-022). The store release is unchanged.
- **"On home page mount/render, the camera should auto start, and the time to first frame should be captured":** `camera:open` runs from Home's mount to the first frame, on every mount.
- **"When it registers a QR, it should log the metrics":** each `camera:qr_found` logs the metrics so far, in both tools.
- **Parked: "Just keep those as backlog tasks, to be done after we have another app which will be the focus".** F-019 and F-020 are `backlog`, and so is swagperf's side. T-015 stays open, because it is about what Killcam captures today, and so does swagperf's B-010, a false pass in what swagperf reports today.

- **Who owns what.**
  - swagperf owns every camera number that is judged: first frame per open, per-frame decode, QR resolve, RAM usage while the camera is open, the leak trend, the leak proof, and any budget. It reads them only from builds that aren't debuggable and carry no Killcam marker (Q3, swagperf B-009).
  - Killcam owns camera events and their debug-build timings on the session timeline, next to what the tester did, and leaks found in debug builds (F-020).
  - Killcam never shows RAM usage figures for the camera. Its Java and native heap row (FEATURES section 23) includes Killcam's own buffers, up to 24 MiB of bodies ([Memory budgets](FEATURES.md#memory-budgets)), so it is never camera evidence.
- **One marker family, `camera:`**, defined once in `swag-pay` with the shared fixture (T-014, swagperf T-005), and built by Swag Pay (swagperf F-019). Not `step:`, because swagperf reads every `step:` slice as a budgeted startup step. Not `action:`, because swagperf's action table and Killcam's bridge would get one every 250 ms.

  | Marker | Shape | Reaches Killcam |
  |---|---|---|
  | `camera:open` | Async, with a new cookie. From Home's mount (the scanner's first composition, where `session.start()` runs from the `AndroidView` update block) to the first frame, on every mount, and again when CameraX restarts after the app returns from background | Yes: its start and its first frame |
  | `camera:decode` | Async, with its own cookie. One frame's decode; at most one in flight | Never one by one. Only inside the summaries |
  | `camera:qr_found` | Instant, no value | Yes |
  | `camera:open_failed#denied\|unavailable\|closed` | Instant. `closed` means the camera closed before its first frame: the app ends `camera:open` there, so the next open can't pair with it, and both tools read it as "no first frame", never as a duration | Yes |
  | `camera:close#dispose\|background\|permission` | Instant, once per open. Disposing runs `stop()` and `close()`, and `close()` calls `stop()` again (`CameraPlatformSurface.android.kt:131-137,331`), so the app guards it | Yes; it ends the per-open summary |
  | `action:qr_validate_<class>` (exists) | Instant | Yes, as today |

- **The decoded QR is never recorded** in a marker, in Killcam or in swagperf. It is a UPI payload: payee VPA, name and amount. Only the outcome class is kept, which is already the rule (`CameraModels.kt:31-32`).
- **Links join by screen and app version, never by timestamp.** A camera event in Killcam links to swagperf's Camera page as "same screen", as a later extension of F-018 and swagperf F-018. It is not a new item.
- **No camera budgets until there is a 10-session baseline on the vivo.** The numbers are the user's call, in swagperf's questions.

### The plan

| # | Owner | Killcam | swagperf | What | Depends on |
|---|---|---|---|---|---|
| 1 | swagperf | — | B-010 | Stop passing Swag Pay's startup against the 420 ms camera-frame budget with a number that ends before the camera frame (P0 in swagperf) | swagperf's question on where startup ends |
| 2 | swag-pay | T-014 | T-005 | The `camera:` family in the one definition and its fixture | — |
| 3 | swag-pay | — | F-019 | The camera markers, Android first. iOS `camera:open` needs a new signpost family. | 2 |
| 4 | swagperf | — | F-020 | Camera metrics: a Camera page, Compare rows and the CLI | 3, B-009, B-010 |
| 5 | Killcam, in `swag-pay-killcam` | F-019 | — | The bridge forwards camera events, logs a summary on every QR and at close, and Replay shows a marker's properties | 2, 3, T-007 |
| 6 | swagperf | — | F-021 | Camera cycle test: RAM usage over N open and close cycles in one process, and a sustained-scan mode | 4; swagperf's question on what a cycle is |
| 7 | Killcam, in `swag-pay-killcam` | F-020 | — | LeakCanary in the debug build, and its leaks as non-fatal errors in Killcam | — |
| 8 | swagperf | — | F-022 | Heap-dump runs in the profileable release variant, never timed or judged | 6; the variant (Swag Pay), with T-007's stub |
| — | Killcam | T-015 | — | Check whether Home's frames contain the camera preview, then decide what to do | — |

### Killcam's side: shape of the work

**F-019: the bridge and Replay**
- In `KillcamTraceBridge`, after T-007 moves it to `src/debug`: handle the begins and ends on the new camera cookies, and the `camera:` instants.
- For each camera open, keep in memory the start (Home's mount), the first frame, the decode count and the decode durations.
- On every `camera:qr_found`, and once more at `camera:close`, log a summary, both as a timeline marker (Replay) and as an Info line in Logs with tag `camera`:
  - Home mount → first frame;
  - first frame → QR found;
  - QR found → validated (up to `action:qr_validate_<class>`);
  - frames decoded so far;
  - decode p50, p90 and max;
  - the outcome class, or the close reason.

  Every duration is in ms. Each summary carries the debug-build label. An open that closes before its first frame logs "No first frame", never a duration.
- Add a timeline marker when a `camera:decode` arrives after `camera:close`: "Camera still delivering frames after close".
- In the dashboard, show a custom marker's properties on its Replay row, as analytics events already do (`dashboard/src/panels/ReplayPanel.tsx:92-98`), with the unit in each value ("412 ms"). Then rebuild the bundle.
- No public API change, no no-op change and no contract change.

**F-020: leaks**
- Swag Pay adds LeakCanary as a `debugImplementation` dependency.
- Debug code watches the camera session when it closes (`AppWatcher.objectWatcher.expectWeaklyReachable`, from `close()` through a debug hook like the trace bridge).
- A LeakCanary event listener reports each analysed leak with `Killcam.recordError(type = "leak: <leaking class>", message = <signature and retained size>, stackTrace = <the leak trace as class and field names>, fatal = false)`.

**T-015: the preview in frames.** Check it on the vivo first. Then the developer chooses between skipping frames while a camera is open, masking camera surfaces, or documenting it.

### Watch-outs

- **Killcam's timings are never performance numbers** (the skill's Decision 10). Killcam takes a frame every 2,500 ms on a settled screen and polls logcat every 1,000 ms, and ML Kit's listener shares the main thread with Killcam's capture scheduling. Every summary says so, and nothing compares its numbers with swagperf's.
- **The timeline holds 5,000 events** ([Memory budgets](FEATURES.md#memory-budgets)). One event per decode, at one every 250 ms, would push screens and taps out of it. That is why decodes are only summarised.
- **LeakCanary's heap dumps** pause the app while they run, and hold everything in the heap. They stay on the phone; the Files page can download them, behind the PIN over Wi-Fi; they never go into a bug bundle.
- **The profileable release variant** must carry what release carries: `killcam-no-op`, T-007's release stub of the bridge, and no LeakCanary. A product flavour built as release gets `releaseImplementation`. A new build type gets neither `debugImplementation` nor `releaseImplementation`, so it needs its own no-op dependency, or it won't compile.
- **"First frame" means the first frame the analyser receives.** That is what the app can see today (`CameraPlatformSurface.android.kt:236-239`). The first preview frame on screen is a different moment, which CameraX reports through `PreviewView`'s stream state (inferred, not checked). Both tools must use the same one; the definition in T-014 fixes it.
- **Killcam is Android only** (F-014), so Killcam's side is Android only. swagperf's iOS side waits for its physical-iPhone lane.

### Open questions (the user's call)

Q10 and Q11 were answered on 2026-09-25 (above). swagperf's own questions are in swagperf's BACKLOG: where startup ends, the camera budgets, what counts as a cycle, a fixed rig with a test UPI QR, and "not measured" on iOS. Its `profileable` question was answered with the profileable release variant.

### Revisit when

Only the user brings this back. Check these against the evidence:
- **Another app is integrated with Killcam and becomes the focus.** Those are the user's words: "to be done after we have another app which will be the focus". Evidence: a new row in TRACKER's Host apps table besides Swag Pay and the sample, or commits that integrate Killcam into another repository, and the user naming that app as the focus.
- **The user asks for camera monitoring again,** for Swag Pay or for any app.

When it comes back:
- **Decide which app the camera work targets:** Swag Pay's scanner, the new app's, or both.
- **Re-read the scanner code first.** This entry describes it at `swag-pay` `aa5482a` and `swag-pay-killcam` `15963f5`.
- **Check swagperf's side,** which is parked with the same trigger.

---

## Loopback trust and plain-HTTP Wi-Fi

**Tracker:** T-001
**Status:** needs a developer decision
**Raised:** 2026-09-24

### What

Two gaps in "closed by default":

1. **Loopback.** Every loopback caller is trusted with no auth. The design assumed that loopback means `adb forward` or the in-app window. But any other app installed on the test phone can also reach `127.0.0.1:8090`. It can read captured payment traffic and tokens, run SQL, edit prefs, delete files, run actions and change mocks, provided it sends `Host: 127.0.0.1` and `X-Killcam: 1`.
2. **Wi-Fi.** Sharing binds `0.0.0.0` over plain HTTP. The PIN, the session cookie and all captured data cross the Wi-Fi in clear text. Binding every interface also exposes the server on cellular, VPN and hotspot interfaces, though still behind the PIN.

### Why it matters

Killcam holds payment traffic. The README's security model says loopback trust is safe because "USB access already implies device control", and says nothing about other apps or plaintext.

### Options (for the developer)

- **Loopback:** require a per-install secret from loopback callers too.
  - The in-app window gets it through the bridge.
  - `adb` users get it printed by the "Dashboard ready" log line, or put into a cookie by a one-time `adb`-only URL.
  - The Rozenite panel would need the same secret.
- **Wi-Fi:**
  - bind only the Wi-Fi interface's address, not `0.0.0.0`;
  - expire tokens;
  - lock out per client address instead of globally;
  - keep the PIN out of the notification's public view.

  TLS on a phone-local server needs a certificate the laptop trusts, which is heavy. Document the plaintext risk at least.
- Whatever is chosen, update README's "Security model" (T-012).

### Watch-outs

- The in-app window and `adb forward` must keep working with no typing.
- The demo and mock servers would need the same rule, or dashboard checks without a phone stop matching real behaviour.
