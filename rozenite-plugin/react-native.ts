/**
 * App-side entry. Killcam talks to the device over HTTP (through
 * `adb forward`), not over the React Native bridge, so the app needs no code
 * for the panel to work; this hook exists so the plugin can be enabled
 * explicitly alongside other Rozenite plugins and stays a no-op in production.
 */
export function useKillcamDevTools(): null {
  return null;
}
