# Killcam

**X-ray vision into a running debug build.** Killcam runs inside your Android app's
debug build and shows what the app is doing, live, in a browser dashboard and in an
in-app window: network traffic, logs, crashes, feature flags, storage, and a replay of
the moments before something broke.

In games, the killcam replays the seconds before you died. This one does the same
for the app: when it crashes, or a tester marks a bug, you get the screens, taps,
requests and logs that led up to it, packaged as one shareable bundle.

Inspired by PhonePe's [Lens](https://tech.phonepe.com/lens-give-your-entire-team-x-ray-vision-into-your-android-app/).
Built first for **Swag Pay**.

| Panel | What you get |
|---|---|
| **Network** | Every OkHttp/Ktor call: headers, bodies (JSON tree, images), timing, cURL, HAR export, "Mock this" |
| **Mocks** | Rules that return canned responses, add delay or simulate timeouts / no network; they persist across restarts |
| **Logs** | `Killcam.log`, analytics events and the app's own logcat (including React Native `console.log`) |
| **Crashes** | Fatal and non-fatal, with app frames highlighted and a "Watch killcam" link into the replay |
| **Replay** | Screenshots, taps, screen changes, network and logs on one timeline, plus a player |
| **Flags** | Declared flags with default / remote / override values; flip them live |
| **Remote Config** | Firebase Remote Config values, sources and fetch status; every key is overridable through Flags |
| **Storage** | SharedPreferences, SQLite (browse and query), MMKV and the app's files |
| **Device** | App, device, runtime and app-provided info |
| **Actions** | App-defined buttons ("Reset onboarding") plus a deep-link launcher |

Android only for now. The dashboard and its [HTTP API](docs/API.md) don't depend on the
platform, so an iOS agent could serve the same UI later.

---

## Add it to an app

**1. Depend on it: the real thing in debug, an empty shell in release.**

```kotlin
// settings.gradle.kts: until Killcam is published, include a checkout
includeBuild("../killcam")

// app/build.gradle.kts
dependencies {
    debugImplementation("com.krafton.killcam:killcam:0.1.0")
    releaseImplementation("com.krafton.killcam:killcam-no-op:0.1.0")
}
```

`killcam-no-op` has the identical public API with no behaviour, no server and no Ktor,
so release builds compile unchanged and R8 strips the calls
(`scripts/check-noop-api.sh` keeps the two in sync).

**2. Install it first thing in `Application.onCreate`.**

```kotlin
Killcam.install(this)   // returns false and does nothing in non-debuggable builds
```

**3. Add the interceptor to your HTTP client.**

```kotlin
OkHttpClient.Builder().addInterceptor(KillcamInterceptor())            // OkHttp
HttpClient(OkHttp) { engine { addInterceptor(KillcamInterceptor()) } } // Ktor
```

Add it as an application interceptor (`addInterceptor`), so mocks short-circuit before
any I/O and bodies arrive decompressed.

**4. (Debug) allow the in-app window to reach the local server.** If your debug network
security config blocks cleartext, permit `127.0.0.1` (the sample app has a debug-only
config under `sample/src/debug/res/xml`).

That's enough for network, logs, crashes, replay, prefs, databases, files and device info.
Screens, flags, MMKV instances, Remote Config and actions are opt-in, as described next.

## Open the dashboard

| From | How |
|---|---|
| **Laptop over USB** | `adb forward tcp:8090 tcp:8090`, then open <http://localhost:8090> |
| **The phone itself** | Tap the floating red bubble, shake the device, or tap the notification |
| **Laptop over Wi-Fi** | In the in-app window, turn on *Share over Wi-Fi*; open the URL shown and enter the 6-digit PIN |
| **React Native DevTools** | Add the [Rozenite plugin](rozenite-plugin/README.md); Killcam appears as a panel next to Rozenite's own |

Long-press the bubble to **mark the moment** a bug happened. It's bookmarked on the
timeline with a screenshot. **Share bug bundle** zips the session (`session.json`,
`network.har`, screenshots) and opens the Android share sheet, ready for Slack or JIRA.

## Instrumenting the app

```kotlin
// Screens: essential for Compose/React Native apps, where activity names say little.
Killcam.screen("PayFlow.EnterAmount", mapOf("payee" to "merchant"))

// Logs, analytics events, caught exceptions
Killcam.i("PayFlow", "PSP selected: yesbank")
Killcam.event("payment_initiated", mapOf("amount_paise" to 24_900))
Killcam.recordException(e, "UPI intent failed")

// Custom replay markers
Killcam.timeline("Biometric prompt shown")

// Feature flags: effective value = Killcam override ?: remote ?: default
val newPinPad = Killcam.booleanFlag("pay.new_pin_pad", default = false, description = "Redesigned PIN pad", group = "Payments")
Killcam.setRemoteFlag("pay.new_pin_pad", valueFromYourBackend)

// Buttons in the Actions panel (run on the main thread)
Killcam.registerAction("Expire session", group = "Session") { sessionStore.expire(); "Session expired" }

// Extra rows in the Device panel
Killcam.setInfo("Environment", BuildConfig.ENV)
```

**Firebase Remote Config** needs no code. If the app has firebase-config and a default
FirebaseApp, the Remote Config panel shows every key with its source (remote, default,
static) and can fetch and activate. Every key is also mirrored into Flags, where testers can
override it. An override only reaches code that reads the key through Killcam, so route
reads like this:

```kotlin
val limit = Killcam.intFlag("upi_lite_limit_paise", default = remoteConfig.getLong("upi_lite_limit_paise").toInt())
```

**MMKV** (Tencent `com.tencent:mmkv`). The default instance appears automatically once
`MMKV.initialize()` has run. Register any other instance, including encrypted ones:

```kotlin
Killcam.registerMmkv("secure", cryptKey = key)
```

Killcam never opens an instance it wasn't told about. Opening an encrypted MMKV store
without its key fails the CRC check, and MMKV's default recovery is to **discard the file**.
Use Rozenite's `@rozenite/storage-plugin` for **react-native-mmkv** stores, which live in
the JS runtime.

**React Native.** `console.log` already arrives through logcat. To capture RN `fetch`
traffic, add the interceptor to RN's client factory:
`OkHttpClientProvider.setOkHttpClientFactory { OkHttpClientProvider.createClientBuilder(ctx).addInterceptor(KillcamInterceptor("react-native")).build() }`.

## What it captures, and what it doesn't

- **Screenshots** use PixelCopy of the activity window, downscaled to 540 px JPEG. They are
  taken on screen changes, around taps and when the screen settles, and duplicate frames
  are dropped. **Windows with `FLAG_SECURE` (PIN entry) are never captured.** The bubble
  is its own window, so it never appears in frames.
- **Taps** are recorded for every UI toolkit. The tapped element is named for View-based UIs;
  Compose and React Native draw inside one host view, so only the position is recorded.
- **Bodies** are captured as the app reads them, up to 128 KB each (`maxBodyBytes`), with a
  24 MB total budget. A body the app never reads is not captured, and streaming responses
  behave exactly as without Killcam.
- **Crashes** save the whole session to disk as the process dies. On the next launch it's
  under the session picker as a crash session, ready to replay.
- **Logcat** is read by polling this process's own log every second (five in the background).
  Android 16 lets an app dump its own log but not tail it. Framework and OEM chatter is
  dropped by tag (`KillcamConfig.ignoredLogTags`; a vivo compositor alone logs every frame),
  and any tag over 40 lines per 5 s is rate-limited with a "suppressed" summary line.
  Errors are never rate-limited.
- Header values can be masked at capture time: `KillcamConfig(redactHeaders = setOf("Authorization"))`.

## Security model

Killcam holds payment traffic, so it defaults to closed:

- It refuses to start in non-debuggable builds (and release builds ship the no-op anyway).
- The server binds to **loopback only**. Nothing on the network can connect until a
  tester turns on Wi-Fi sharing, which rebinds to the LAN on the same port and requires a
  fresh 6-digit PIN. Five wrong PINs lock the server for a minute. Turning sharing off
  closes the LAN socket.
- `Host` must be localhost or an IP (blocks DNS rebinding). Writes require an
  `X-Killcam: 1` header (blocks cross-site requests from other tabs).
- Files, prefs and database names from the dashboard are sandboxed to the app's own
  directories; SQL identifiers are validated against the schema.

## Repository

```
killcam-core/     Pure JVM: store, mocks, flags, sessions, HTTP server (Ktor CIO), API
killcam/          Android library: collectors, interceptor, bubble, in-app window
killcam-no-op/    Release stand-in with the same public API
dashboard/        React + Vite web dashboard, built into killcam-core's resources
rozenite-plugin/  React Native DevTools panel that embeds the dashboard
sample/           Demo app exercising every panel
docs/API.md       HTTP API; dashboard/src/api/types.ts is the wire contract
```

```bash
./gradlew :killcam-core:test          # server, security, sessions, mocks, flags
./gradlew :killcam-core:demo          # real server + simulated Swag Pay session on :8090
./scripts/check-noop-api.sh           # killcam and killcam-no-op expose the same API
./gradlew :sample:installDebug        # demo app on a device

cd dashboard && npm run mock          # dashboard against a Node mock of the API
cd dashboard && npm run build         # rebuilds killcam-core/src/main/resources/killcam-web
cd rozenite-plugin && npm run build   # Rozenite panel (needed before an app can load it)
```

The built dashboard is committed into `killcam-core`'s resources so Android builds need
no Node toolchain. Rebuild it after changing `dashboard/`.

## Known gaps (v1)

- Android only. Jetpack DataStore files show up in Files but have no dedicated editor yet.
- Compose tap targets are positions, not element names.
- The in-app window is the dashboard in a WebView (with a small native bridge, see
  docs/API.md), so the phone and the laptop always show the same thing. It needs cleartext
  to `127.0.0.1` in the debug network config.
- The Rozenite panel embeds the dashboard in an iframe through `adb forward`. It is
  verified against Metro's plugin route, but not yet inside a live React Native
  DevTools session.
