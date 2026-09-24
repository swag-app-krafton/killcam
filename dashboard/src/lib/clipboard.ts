import { callNative } from './native';

/**
 * Clipboard write that works everywhere: the native bridge in the Android
 * WebView (it shows its own toast), the async API on secure origins, and
 * execCommand on plain-http origins (Wi-Fi access).
 */
export async function copyText(text: string): Promise<boolean> {
  if (callNative((b) => b.copy(text))) return true;
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
