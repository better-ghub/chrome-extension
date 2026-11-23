// Better GHub - Background service worker (entry).
//
// MV3 rules this file follows:
// - every listener is registered synchronously at top level, so events that
//   wake the worker are delivered;
// - nothing calls the GitHub API at top level: the worker wakes for every
//   message/alarm, and the old code validated the token on each wake.

import { LEGACY_KEYS, SETTINGS_KEYS } from './core/settings';
import { isSettingsArea, migrateSettingsToSync } from './core/settings-storage';
import { ALARM_INBOX, ALARM_VALIDATE, clearLegacyAlarms, syncAlarms } from './background/alarms';
import { validateStoredTokens } from './background/auth-check';
import { ALARM_SNOOZE, onInboxAlarm, onSnoozeAlarm } from './background/inbox';
import { onNotificationClicked } from './background/notify';
import { openOptions } from './background/pages';
import { onMessage } from './background/router';
import { invalidateSettings } from './background/store';
import { migrateTokens } from './background/tokens';

const SETTING_STORAGE_KEYS = new Set(Object.values(SETTINGS_KEYS));

chrome.runtime.onMessage.addListener(onMessage);

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    // Move a token left in chrome.storage.local (readable by content scripts)
    // into the background-only secret store as early as possible.
    await migrateTokens();
    await migrateSettingsToSync(Object.values(SETTINGS_KEYS));
    if (details.reason === 'install') {
      await openOptions('welcome');
    } else if (details.reason === 'update') {
      // shortcutBindings stays: normalizeBindings() migrates it on read.
      await chrome.storage.local.remove(LEGACY_KEYS).catch(() => undefined);
      await clearLegacyAlarms();
    }
    await syncAlarms();
  })();
});

chrome.runtime.onStartup.addListener(() => {
  void migrateTokens()
    .then(() => migrateSettingsToSync(Object.values(SETTINGS_KEYS)))
    .then(syncAlarms);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_INBOX) void onInboxAlarm().catch(() => undefined);
  else if (alarm.name === ALARM_VALIDATE) void validateStoredTokens().catch(() => undefined);
  else if (alarm.name === ALARM_SNOOZE) void onSnoozeAlarm().catch(() => undefined);
});

// Optional chaining: the API is missing when the permission is not granted.
chrome.notifications?.onClicked.addListener((id) => {
  void onNotificationClicked(id).catch(() => undefined);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (!isSettingsArea(area)) return;
  const keys = Object.keys(changes);
  if (keys.some((k) => SETTING_STORAGE_KEYS.has(k))) invalidateSettings();
  if (changes[SETTINGS_KEYS.notificationsEnabled] || changes[SETTINGS_KEYS.notificationInterval] || changes[SETTINGS_KEYS.desktopNotifications]) {
    void syncAlarms(); // also shows/clears the badge
  }
  // The token is not in chrome.storage any more (see secret-store.ts);
  // dropCredentials() clears the badge itself.
});
