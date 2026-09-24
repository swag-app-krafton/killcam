# Backlog

Deferred and in-flight work on Killcam and its integration into apps. Each entry records why the item matters, not just what it is, so it stays actionable once the conversation that produced it is gone.

These are the long write-ups. The live list, with status and priority for every item, is [TRACKER.md](TRACKER.md); each entry here carries its tracker ID. How each feature works today is in [FEATURES.md](FEATURES.md).

---

## The dashboard rebuilt on swagperf's design system

**Tracker:** F-001 (swagperf F-015)
**Status:** in progress. Step 1 is committed on the local branch `feature/network-fault-injection` as `da88e16`, and is also in the `main` working tree. Steps 2 and 3 were being written in the `main` working tree at 16:19 on 2026-09-24.
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

1. Shell: `AppShell`, `Sidebar`, `TopBar`, `PageHeader`, `SessionPicker`, `SessionDetails`, `PinScreen`, `Embed` and `actions.ts`. This is done in `da88e16`.
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

## Network conditions, fault injection, endpoint catalog, repeat and breakpoints

**Tracker:** F-002
**Status:** built on the local branch `feature/network-fault-injection`, in the worktree `~/Documents/killcam-network-faults`. Not merged, not pushed. Commits:
- `1822bcc`, 16:16: Kotlin, server and tests;
- `ad624f0`, 16:24: dashboard, `types.ts`, mock server and a rebuilt bundle;
- `0a5ea3e`, 16:25: README and API.md.
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
- **API-error templates (R4):** dashboard only; not built.
- **Programmatic API (R5):**
  - `Killcam.setNetworkProfile`, `setNetworkConditions`, `clearNetworkConditions`, `failRequests`, `mockResponse`, `removeMock` and `registerEndpoint`;
  - `/api/network-conditions` (GET, PUT, DELETE) and `/api/network-conditions/presets`;
  - `POST /api/mocks/{id}/reset`.
- **Endpoint catalog (R6):**
  - The app's APIs by name. Sources are merged by key, later winning: `killcam-endpoints.json` shipped as a debug asset, `Killcam.registerEndpoint`, and testers' additions.
  - Endpoints: `/api/endpoints` and `/api/endpoints/export`.
  - `scripts/pull-endpoints.sh` writes the catalog back into the app's repository for a PR. The phone never holds GitHub credentials.
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

### What was built on the branch

- **The Kotlin side:** the API, server routes, `killcam-core` tests, and an Android `NetworkFaultsTest` for the OkHttp fault helpers.
- **The dashboard** (`ad624f0`), on the **old** pages, styled through `legacy.css`:
  - **Mocks** gains a network-conditions card (presets, or custom latency, bandwidth, loss and offline). It also gains the new failure kinds, API-error templates, "When" limits (the first N calls, a share of calls, re-arm), a Breakpoint action, and rules that target a catalog endpoint.
  - **A new Endpoints page** (Run group, code `EP`) lists the catalog by group with each endpoint's source, calls and errors. It discovers uncovered paths in traffic, and exports `killcam-endpoints.json`.
  - **Network** warns while conditions are on, and can repeat a call: edited, N times, or all at once.
  - **Breakpoints:** a bar on every page shows the paused calls, with an editor to continue or fail each one.
- **The contract:** `types.ts`, the mock server, a rebuilt bundle (`index-DfzeE_Zz.js`), README sections ("Simulating bad networks", "The endpoint catalog") and API.md, including curl recipes for test automation.

### What is left

- **Merge into `main`.** `main`'s working tree is rebuilding the same pages on the design system (F-001), and the branch changed `MocksPanel.tsx`, `NetworkPanel.tsx`, `NetworkDetail.tsx`, `legacy.css`, `routes.ts` and the bundle. Decide the order: merge the branch first and rebuild its pages as part of F-001, or rebuild first and port the branch's UI onto the new pages. Either way, rebuild the bundle once, after the merge.
- **Interceptor tests against MockWebServer**, if the Android `NetworkFaultsTest` doesn't already cover throttling, drops, repeat and breakpoints end to end. The plan lists them, and `okhttp-mockwebserver` is in the version catalog.
- **A run on a phone** with the sample app, the only app that makes HTTP calls (T-003). Swag Pay needs F-005 first.

### Watch-outs

- **Repeat** sends real requests with the app's own auth and interceptors. On a payment API that means real double-submits. The plan calls this intended (scenario S16).
- **A breakpoint** blocks the app's calling thread for up to 120 s. A call made on the main thread would freeze the app, so the UI should warn about that.
- The branch also carries `da88e16` (F-001, step 1). When merging, reconcile it with the dashboard work in the `main` working tree.
- Measurements taken while conditions are on are meaningless for performance (see F-004).

---

## One tool: Killcam and swagperf combined

**Tracker:** F-003 (owned by swagperf F-016)
**Status:** not started. Waiting on the user's decisions.
**Raised:** 2026-09-24

The full write-up is swagperf's: `~/Documents/perfetto-monitor/docs/BACKLOG.md`, section "One tool: Killcam and swagperf combined". What matters on Killcam's side:

- Killcam becomes a lane beside Perfetto · Android, Instruments · iOS and Flashlight · Android. The user dismissed mixing lanes in one view (swagperf F-008).
- Lanes join by screen name, JS-error fingerprint and app version, **never by timestamp**. Killcam runs in debug builds and performance runs should be release-like, so the two never see the same process.
- Killcam refuses cross-origin writes. A laptop dashboard on swagperf's origin therefore has to reach the phone through swagperf's server, which then needs Killcam-grade protection (swagperf T-001).
- Both tools read Swag Pay's `SwagTrace` markers and `SwagErrors` records, so they need one shared definition and a test.
- Payment bodies and screenshots must never reach swagperf's `history.db` or a model (Q6).
- **What only each tool has:**
  - Only Killcam: network and mocks, logs, replay with screenshots, flags and Remote Config, storage, actions and deep links, bug bundles, the phone workflow, Wi-Fi with a PIN, and Rozenite.
  - Only swagperf: startup, frames, RAM usage, CPU, hangs and budgets.
  - Both touch crashes, JS errors and screens.
- Decisions waiting on the user: Q1, Q2 and Q4–Q7 in [TRACKER.md](TRACKER.md#open-questions-for-the-user).

---

## What Killcam costs the host app

**Tracker:** F-004 (and T-005; relates to swagperf B-009)
**Status:** not started
**Raised:** 2026-09-24

### What

Measure Killcam's overhead in a Swag Pay debug build. Then either stop swagperf from judging such a build as a normal run, or give swagperf a way to pause Killcam while it records.

### Why

Killcam does work inside the app:
- it installs first in `Application.onCreate`, so its startup is on the timeline;
- it takes PixelCopy screenshots on every screen change, around taps, and as a settle frame every 2.5 s;
- it spawns `logcat -d` every second in the foreground, even while paused;
- it JSON-encodes every event even when no dashboard is open (T-005).

swagperf already decided (its F-012) that screenshots skew frames and startup. If a Swag Pay build that carries Killcam is captured by swagperf, its budgets judge Killcam's work as the app's. None of this has been measured.

### Shape of the work

1. Measure, with swagperf itself, the same Swag Pay debug build three ways: without Killcam, with Killcam, and with Killcam paused. Compare startup, frames, CPU and RAM usage.
2. Decide Q3: may swagperf capture debug builds at all?
3. If it may, choose one:
   - swagperf labels Killcam runs as their own kind (it can read the build's dependencies or `/api/info`);
   - Killcam gets a "quiet" switch, over `adb` or `POST /api/capture`, that also stops logcat polling and the settle frames. Today pausing does not stop the logcat process.

### Watch-outs

- Pausing today keeps marks and crashes and spawns logcat anyway (T-005), so "paused" is not "off".
- Network conditions (F-002) left switched on would distort any measurement. A run should record whether they were on.

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
