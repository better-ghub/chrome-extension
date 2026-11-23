// Better GHub - Options: "Send a test notification".
//
// Calls chrome.notifications directly from the page (no background round
// trip). Every failure mode resolves to a result code; nothing throws.

import { t } from '../src/i18n';

export type TestNotificationResult = 'sent' | 'unavailable' | 'blocked' | 'error';

export interface NotificationsApi {
  create(id: string, options: chrome.notifications.NotificationOptions<true>, callback?: (id: string) => void): void;
  getPermissionLevel?(callback: (level: string) => void): void;
}

function defaultApi(): NotificationsApi | undefined {
  try {
    return typeof chrome !== 'undefined' ? (chrome.notifications as NotificationsApi | undefined) : undefined;
  } catch {
    return undefined;
  }
}

function lastError(): boolean {
  try {
    return !!chrome.runtime?.lastError;
  } catch {
    return false;
  }
}

export function sendTestNotification(api: NotificationsApi | undefined = defaultApi()): Promise<TestNotificationResult> {
  if (!api || typeof api.create !== 'function') return Promise.resolve('unavailable');
  return new Promise<TestNotificationResult>((resolve) => {
    const create = (): void => {
      try {
        api.create(
          `bghub-test-${Date.now()}`,
          {
            type: 'basic',
            iconUrl: '../icons/icon128.png',
            title: t('optTestNotificationTitle', 'Better GHub'),
            message: t('optTestNotificationBody', 'Notifications work. You’ll see one when a pull request needs you.'),
            priority: 0,
          },
          () => resolve(lastError() ? 'error' : 'sent')
        );
      } catch {
        resolve('error');
      }
    };
    if (typeof api.getPermissionLevel !== 'function') {
      create();
      return;
    }
    try {
      api.getPermissionLevel((level) => (level === 'denied' ? resolve('blocked') : create()));
    } catch {
      create();
    }
  });
}

export function testNotificationMessage(result: TestNotificationResult): string {
  switch (result) {
    case 'sent':
      return t('optTestSent', 'Test notification sent');
    case 'blocked':
      return t('optTestBlocked', 'Notifications are turned off for Better GHub in Chrome');
    case 'unavailable':
      return t('optTestUnavailable', 'Notifications aren’t available in this browser');
    case 'error':
      return t('optTestFailed', 'Couldn’t show a notification');
  }
}
