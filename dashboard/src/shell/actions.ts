import { api, enc, errorMessage } from '../api/client';
import { liveStore, reloadSessions } from '../api/live';
import type { AppInfo, KillcamStatus, SessionSummary, TimelineEvent } from '../api/types';
import { fmtDateTime, fmtDuration, shortClass } from '../lib/format';
import { appStore } from '../state/app';
import { forgetBundle } from '../state/session';
import { confirmDialog, promptDialog, toast } from '../state/ui';

/** Commands shared by the desktop top bar, the phone's chrome and Sessions. */

export async function toggleCapture(): Promise<void> {
  const status = liveStore.get().status;
  if (!status) return;
  try {
    liveStore.set({ status: await api.post<KillcamStatus>('capture', { paused: !status.capturePaused }) });
    toast(status.capturePaused ? 'Capture resumed' : 'Capture paused: nothing new is recorded');
  } catch (e) {
    toast(`Could not ${status.capturePaused ? 'resume' : 'pause'} capture: ${errorMessage(e)}`, 'error');
  }
}

export async function markMoment(): Promise<void> {
  const label = await promptDialog({
    title: 'Mark this moment',
    message: 'Adds a marker to the live timeline, so the moment is easy to find in Replay.',
    placeholder: 'What happened? For example “Pay button did nothing”',
    confirmLabel: 'Mark',
  });
  if (label == null) return;
  try {
    await api.post<TimelineEvent>('timeline/mark', { label: label.trim() || 'Marked moment' });
    toast('Moment marked', 'ok');
  } catch (e) {
    toast(`Could not mark the moment: ${errorMessage(e)}`, 'error');
  }
}

export async function saveSession(): Promise<void> {
  const label = await promptDialog({
    title: 'Save session',
    message: 'Saves the live session (calls, logs, timeline and screenshots) on the device, so it survives a restart and can be exported.',
    placeholder: 'Label, for example “Pay stuck on the PIN screen”',
    confirmLabel: 'Save',
  });
  if (label == null) return;
  try {
    const s = await api.post<SessionSummary>('sessions', { label: label.trim() });
    await reloadSessions();
    toast(`Saved “${sessionTitle(s)}”`, 'ok');
  } catch (e) {
    toast(`Could not save the session: ${errorMessage(e)}`, 'error');
  }
}

export async function deleteSession(s: SessionSummary): Promise<boolean> {
  const ok = await confirmDialog({
    title: `Delete “${sessionTitle(s)}”?`,
    message: 'Deletes the saved session and its screenshots from the device. This cannot be undone.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return false;
  try {
    await api.del(`sessions/${enc(s.id)}`);
    forgetBundle(s.id);
    if (appStore.get().selected === s.id) appStore.set({ selected: 'live' });
    await reloadSessions();
    toast('Session deleted', 'ok');
    return true;
  } catch (e) {
    toast(`Could not delete the session: ${errorMessage(e)}`, 'error');
    return false;
  }
}

export const exportHref = (key: string) => `api/sessions/${enc(key)}/export`;

/** "Live session", the tester's label, or what ended it. */
export function sessionTitle(s: SessionSummary): string {
  if (s.live) return 'Live session';
  if (s.label) return s.label;
  if (s.crash) return `Crash: ${shortClass(s.crash.exception)}`;
  return `Session of ${fmtDateTime(s.startMs)}`;
}

export function sessionReason(s: SessionSummary): { tone: 'neutral' | 'fail'; word: string } {
  if (s.live) return { tone: 'neutral', word: 'Live' };
  if (s.reason === 'crash') return { tone: 'fail', word: 'Crashed' };
  return { tone: 'neutral', word: 'Saved' };
}

export const sessionDuration = (s: SessionSummary, now = Date.now()) => fmtDuration((s.endMs ?? now) - s.startMs);

/** App, device and runtime details as plain text ("Copy details"). */
export function detailsText(info: AppInfo, status: KillcamStatus | null): string {
  return [
    `${info.appName} ${info.versionName} (${info.versionCode}) ${info.buildType}`,
    info.deviceName,
    `Killcam ${info.killcamVersion} · session ${info.sessionId} · started ${fmtDateTime(info.sessionStartMs, true)}`,
    status ? `Connection: port ${status.port}, Wi-Fi sharing ${status.wifiEnabled ? 'on' : 'off'}${status.wifiUrl ? ` (${status.wifiUrl})` : ''}` : '',
    '',
    ...info.sections.flatMap((s) => [`[${s.title}]`, ...s.items.map((i) => `${i.label}: ${i.value}`), '']),
  ]
    .filter((l, i, a) => l !== '' || a[i - 1] !== '')
    .join('\n');
}
