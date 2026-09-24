/**
 * The Android in-app window injects `window.KillcamNative` (addJavascriptInterface).
 * Every call is synchronous. Absent in desktop browsers, so always feature-detect.
 */
export interface KillcamNativeBridge {
  close(): void;
  shareBundle(): void;
  /** JSON string of NativeConnection. */
  getConnection(): string;
  /** Async: the server rebinds; a `killcam-native` {type:'connection'} event follows. */
  setWifiSharing(enabled: boolean): void;
  copy(text: string): void;
  /** Paints the status and navigation bar strips (added later; feature-detect). */
  setChrome?(background: string, light: boolean): void;
}

export interface NativeConnection {
  port: number;
  usbCommand: string;
  wifiEnabled: boolean;
  wifiUrl: string | null;
  pin: string | null;
}

declare global {
  interface Window {
    KillcamNative?: KillcamNativeBridge;
  }
}

export function nativeBridge(): KillcamNativeBridge | null {
  try {
    const b = window.KillcamNative;
    return b && typeof b.close === 'function' ? b : null;
  } catch {
    return null;
  }
}

export function hasNative(): boolean {
  return nativeBridge() != null;
}

export function nativeConnection(): NativeConnection | null {
  const b = nativeBridge();
  if (!b) return null;
  try {
    const c = JSON.parse(b.getConnection()) as Partial<NativeConnection>;
    return {
      port: Number(c.port) || 0,
      usbCommand: String(c.usbCommand ?? ''),
      wifiEnabled: !!c.wifiEnabled,
      wifiUrl: c.wifiUrl ?? null,
      pin: c.pin ?? null,
    };
  } catch {
    return null;
  }
}

/** Subscribe to `killcam-native` CustomEvents of one type. */
export function onNativeEvent(type: string, fn: () => void): () => void {
  const handler = (e: Event) => {
    const d = (e as CustomEvent<{ type?: string }>).detail;
    if (d?.type === type) fn();
  };
  window.addEventListener('killcam-native', handler);
  return () => window.removeEventListener('killcam-native', handler);
}

/** Call a bridge method, swallowing bridge exceptions (a dead Activity throws). */
export function callNative(fn: (b: KillcamNativeBridge) => void): boolean {
  const b = nativeBridge();
  if (!b) return false;
  try {
    fn(b);
    return true;
  } catch {
    return false;
  }
}
