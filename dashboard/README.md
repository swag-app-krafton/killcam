# Killcam dashboard

The web UI the on-device server hosts (and the in-app window shows). Built on
swagperf's design system, so the two tools read as one product.

**`src/design/` is vendored from swagperf** (`perfetto-monitor/frontend/src/design`)
and must not be edited. Wrap or extend it in `src/kit/`, and refresh it with
`../scripts/sync-design-system.sh [path/to/perfetto-monitor]`, which records the
source commit in `design-system.lock`. Merging the two dashboards later is then a
deletion. `src/fonts/` holds self-hosted copies of swagperf's Google Fonts
(`--fonts` refreshes them); the dashboard makes no external requests.

| Command | What it does |
|---|---|
| `npm run mock` | Mock device on :8090 (`PORT=`), serving the built dashboard. `MOCK_REQUIRE_PIN=1` asks for PIN 123456; `MOCK_NO_STORAGE=1` answers 501 for storage and Remote Config. |
| `npm run dev` | Vite on :5173, proxying `/api` to `KILLCAM_URL` (default the mock). |
| `npm run build` | Type-checks, then writes `../killcam-core/src/main/resources/killcam-web/`. |

Layouts: desktop; `?embed=1` for the phone's in-app window (compact bar, bottom
tabs, sheets; uses `window.KillcamNative` when present); `?embed=devtools` for
React Native DevTools. In dev and the mock, `?fakeNative=1` injects a stub bridge
(`dev/fake-native.js`) that records calls in `window.__killcamNativeCalls`.
