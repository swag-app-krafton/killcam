import { createStore } from './store';

// ----------------------------------------------------------------- toasts --

export type ToastKind = 'info' | 'ok' | 'error';
export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}
export const toastStore = createStore<{ toasts: Toast[] }>({ toasts: [] });
let toastId = 0;

export function toast(message: string, kind: ToastKind = 'info', ms = 3800): void {
  const id = ++toastId;
  toastStore.set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, message }] }));
  setTimeout(() => dismissToast(id), ms);
}
export function dismissToast(id: number): void {
  toastStore.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

// ---------------------------------------------------------------- dialogs --
// Own confirm/prompt: window.confirm/prompt are no-ops in an Android WebView without a WebChromeClient.

export interface DialogSpec {
  kind: 'confirm' | 'prompt';
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  placeholder?: string;
  initial?: string;
  resolve: (v: string | null) => void;
}
export const dialogStore = createStore<{ dialog: DialogSpec | null }>({ dialog: null });

export function confirmDialog(opts: Omit<DialogSpec, 'kind' | 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    dialogStore.get().dialog?.resolve(null);
    dialogStore.set({ dialog: { ...opts, kind: 'confirm', resolve: (v) => resolve(v != null) } });
  });
}

export function promptDialog(opts: Omit<DialogSpec, 'kind' | 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => {
    dialogStore.get().dialog?.resolve(null);
    dialogStore.set({ dialog: { ...opts, kind: 'prompt', resolve } });
  });
}
