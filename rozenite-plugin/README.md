# Killcam for Rozenite

Adds a **Killcam** panel to React Native DevTools through
[Rozenite](https://www.rozenite.dev/), next to Rozenite's own panels.

Rozenite panels see the JavaScript runtime. Killcam sees the native process: Compose
screens, OkHttp traffic, logcat, crashes and replay, SharedPreferences, SQLite, native
MMKV and Firebase Remote Config. This panel embeds the Killcam dashboard the debug build
already serves, so a React Native developer gets both views in one DevTools window.

| Use | For |
|---|---|
| `@rozenite/storage-plugin` | react-native-mmkv, AsyncStorage, SecureStore (JS side) |
| `@rozenite/network-activity-plugin` | JS `fetch`/XHR |
| **this plugin** | everything native, plus the Killcam replay |

## Install

```bash
npm install --save-dev @rozenite/metro @swag/rozenite-killcam-plugin
# until published: "@swag/rozenite-killcam-plugin": "file:../path/to/killcam/rozenite-plugin"
```

```js
// metro.config.js
const {withRozenite} = require('@rozenite/metro');
module.exports = withRozenite(mergeConfig(getDefaultConfig(__dirname), config), {
  enabled: process.env.WITH_ROZENITE === 'true',
});
```

```bash
WITH_ROZENITE=true npm start     # Metro logs: [Rozenite] Loaded … @swag/rozenite-killcam-plugin
adb forward tcp:8090 tcp:8090    # the panel reaches Killcam on the device through this
```

Then open React Native DevTools (`j` in Metro) and pick **Killcam**. The panel waits for the
port and connects on its own. It shows setup steps until the app is up, and the port is
editable if Killcam moved to 8091+ because another app holds 8090.

No app-side code is needed: the panel talks to Killcam over HTTP, not the RN bridge.

## Develop

```bash
npm install
npm run build        # dist/ is what Metro serves; rebuild after changes
npm run dev          # Rozenite's panel dev host on :8888
```
