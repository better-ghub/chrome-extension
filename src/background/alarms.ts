// Better GHub - Alarms.
//
// chrome.alarms.create() with an existing name REPLACES the alarm and restarts
// its countdown. The old code called it on every service-worker wake (every
// few minutes), so periodic alarms never actually fired. We only (re)create an
// alarm when it is missing or its period changed.

import { bgSettings } from './store';
import { updateBadge } from './inbox';

export const ALARM_INBOX = 'inbox:refresh';
export const ALARM_VALIDATE = 'auth:validate';
const VALIDATE_PERIOD_MIN = 6 * 60;
const LEGACY_ALARMS = ['validateToken', 'checkPRChanges'];

async function ensureAlarm(name: string, periodInMinutes: number): Promise<void> {
  const existing = await chrome.alarms.get(name);
  if (existing && existing.periodInMinutes === periodInMinutes) return;
  await chrome.alarms.create(name, { periodInMinutes, delayInMinutes: periodInMinutes });
}

/**
 * Bring alarms + badge in line with the current settings. Idempotent. The
 * periodic inbox refresh runs while either the badge or desktop
 * notifications are on (both need fresh data).
 */
export async function syncAlarms(): Promise<void> {
  try {
    const settings = await bgSettings();
    await ensureAlarm(ALARM_VALIDATE, VALIDATE_PERIOD_MIN);
    if (settings.notificationsEnabled || settings.desktopNotifications) {
      await ensureAlarm(ALARM_INBOX, settings.notificationInterval);
    } else {
      await chrome.alarms.clear(ALARM_INBOX);
    }
    await updateBadge();
  } catch (error) {
    console.warn('Better GHub: alarm setup failed', error instanceof Error ? error.message : error);
  }
}

export async function clearLegacyAlarms(): Promise<void> {
  await Promise.all(LEGACY_ALARMS.map((name) => chrome.alarms.clear(name).catch(() => false)));
}
