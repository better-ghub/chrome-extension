// Better GHub - Background message router.

import type { BackgroundMessage, BackgroundRequests, BackgroundRequestType } from '../core/messages';
import { redactSecrets } from '../redact';
import { handleGraphQL, handleRest } from './api';
import { authStatus, logout, removeStoredToken, setToken } from './auth';
import { broadcast } from './broadcast';
import { clearCache } from './cache';
import { expireInbox, getInbox, markSeen, pin, snooze } from './inbox';
import { loadLocale, openOptions } from './pages';
import { isReadOnlyQuery } from './request-utils';

type Res<K extends BackgroundRequestType> = BackgroundRequests[K]['res'];

/** Only extension pages (popup/options) may change credentials — never content scripts. */
const PRIVILEGED = new Set<BackgroundRequestType>(['auth:setToken', 'auth:removeToken', 'auth:logout']);

const KNOWN = new Set<string>([
  'api:graphql', 'api:rest', 'i18n:load', 'auth:status', 'auth:setToken', 'auth:removeToken', 'auth:logout',
  'inbox:get', 'inbox:markSeen', 'inbox:snooze', 'inbox:pin', 'cache:clear', 'ui:openOptions',
]);

/** Shape-correct failure response for each request type. */
function failure(type: BackgroundRequestType, error: string): Res<BackgroundRequestType> {
  switch (type) {
    case 'api:graphql':
    case 'api:rest':
      return { ok: false, error };
    case 'auth:status':
    case 'auth:setToken':
    case 'auth:removeToken':
      return { authenticated: false, error };
    case 'inbox:get':
    case 'inbox:snooze':
    case 'inbox:pin':
      return { items: [], unseenCount: 0, fetchedAt: 0, error };
    case 'inbox:markSeen':
      return { ok: false, unseenCount: 0 };
    default:
      return { ok: false };
  }
}

async function clearAll(): Promise<{ ok: boolean }> {
  await clearCache();
  await expireInbox();
  await broadcast({ type: 'cache:cleared' });
  return { ok: true };
}

function dispatch(msg: BackgroundMessage): Promise<Res<BackgroundRequestType>> {
  switch (msg.type) {
    case 'api:graphql':
      return handleGraphQL(msg);
    case 'api:rest':
      return handleRest(msg);
    case 'i18n:load':
      return loadLocale(msg.language);
    case 'auth:status':
      return authStatus(msg.refresh === true);
    case 'auth:setToken':
      return setToken(msg.token);
    case 'auth:removeToken':
      return removeStoredToken(msg.id);
    case 'auth:logout':
      return logout();
    case 'inbox:get':
      return getInbox(msg.force === true);
    case 'inbox:markSeen':
      return markSeen(msg.urls);
    case 'inbox:snooze':
      return snooze(msg.url, msg.until);
    case 'inbox:pin':
      return pin(msg.url, msg.pinned);
    case 'cache:clear':
      return clearAll();
    case 'ui:openOptions':
      return openOptions(msg.section);
  }
}

function isExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return !!sender.url && sender.url.startsWith(`chrome-extension://${chrome.runtime.id}/`);
}

export function onMessage(msg: unknown, sender: chrome.runtime.MessageSender, sendResponse: (res: unknown) => void): boolean {
  const type = (msg as { type?: unknown } | null)?.type;
  if (sender.id !== chrome.runtime.id || typeof type !== 'string' || !KNOWN.has(type)) {
    // Tab broadcasts echoed back, foreign senders, typos: answer, never hang.
    sendResponse({ ok: false, error: sender.id !== chrome.runtime.id ? 'forbidden' : 'unknown-request' });
    return false;
  }
  const t = type as BackgroundRequestType;
  const privileged = isExtensionPage(sender);
  if (PRIVILEGED.has(t) && !privileged) {
    sendResponse(failure(t, 'forbidden'));
    return false;
  }
  // Content scripts run inside github.com pages: the proxy only ever runs read
  // queries for them, never mutations/subscriptions with the user's token.
  if (t === 'api:graphql' && !privileged && !isReadOnlyQuery((msg as { query?: unknown }).query)) {
    sendResponse(failure(t, 'forbidden'));
    return false;
  }
  dispatch(msg as BackgroundMessage)
    .then(sendResponse)
    .catch((error: unknown) => {
      const text = redactSecrets(error instanceof Error ? error.message : String(error));
      console.warn(`Better GHub: "${t}" failed:`, text);
      sendResponse(failure(t, 'internal'));
    });
  return true;
}
