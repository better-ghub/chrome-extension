// Better GHub - Live settings snapshot for content-script features.
// Features read `liveSettings()` synchronously (e.g. in Feature.enabled()).

import { DEFAULT_SETTINGS, getSettings, onSettingsChanged, type Settings } from '../core/settings';

let current: Settings = { ...DEFAULT_SETTINGS };
const listeners = new Set<(s: Settings, changed: (keyof Settings)[]) => void>();

export function liveSettings(): Settings {
  return current;
}

export async function initLiveSettings(): Promise<Settings> {
  current = await getSettings();
  onSettingsChanged((s, changed) => {
    current = s;
    for (const l of listeners) l(s, changed);
  });
  return current;
}

/** Subscribe to settings changes; returns unsubscribe. Tie it to a feature's AbortSignal. */
export function subscribeSettings(cb: (s: Settings, changed: (keyof Settings)[]) => void, signal?: AbortSignal): () => void {
  listeners.add(cb);
  const off = (): void => void listeners.delete(cb);
  signal?.addEventListener('abort', off);
  return off;
}
