// Better GHub - Desktop notifications (chrome.notifications) for inbox events.
// Rules live in notify-model.ts; this file only talks to Chrome.
//
// UI text: the background has no page i18n, so it reads the same
// _locales/<lang>/messages.json the content scripts get ('i18n:load'), with
// inline English fallbacks.

import type { Language } from '../core/settings';
import { markSeen } from './inbox';
import { normalizePrUrl } from './inbox-model';
import {
  actorOf,
  deliverable,
  MAX_SINGLE_NOTIFICATIONS,
  parseNotificationId,
  prNotificationId,
  summaryNotificationId,
  type NotifyEvent,
  type PendingNotification,
} from './notify-model';
import { loadLocale } from './pages';
import { bgSettings } from './store';

type Messages = Record<string, { message: string }> | undefined;

const PULLS_URL = 'https://github.com/pulls';

const TITLES: Record<NotifyEvent, [key: string, fallback: string]> = {
  'review-requested': ['notifyReviewRequestedTitle', 'Review requested · $1'],
  'changes-requested': ['notifyChangesRequestedTitle', 'Changes requested · $1'],
  'checks-failed': ['notifyChecksFailedTitle', 'Checks failed · $1'],
  approved: ['notifyApprovedTitle', 'Approved · $1'],
};

function uiLanguage(language: Language): 'en' | 'pl' {
  if (language === 'en' || language === 'pl') return language;
  try {
    return chrome.i18n.getUILanguage().toLowerCase().startsWith('pl') ? 'pl' : 'en';
  } catch {
    return 'en';
  }
}

const substitute = (message: string, subs: string[]): string => message.replace(/\$(\d)/g, (m, i: string) => subs[Number(i) - 1] ?? m);

function text(messages: Messages, key: string, fallback: string, subs: string[] = []): string {
  return substitute(messages?.[key]?.message || fallback, subs);
}

/** `<base>_<plural category>` (e.g. _few in Polish), then `<base>_other`, then the English fallback. */
function pluralText(messages: Messages, lang: string, base: string, n: number, fallback: { one: string; other: string }): string {
  let category: string = n === 1 ? 'one' : 'other';
  try {
    category = new Intl.PluralRules(lang).select(n);
  } catch {
    /* keep the English rule */
  }
  const raw = messages?.[`${base}_${category}`]?.message || messages?.[`${base}_other`]?.message || (n === 1 ? fallback.one : fallback.other);
  return substitute(raw, [String(n)]);
}

/** Show the events the settings allow right now. Never throws. */
export async function deliverNotifications(events: readonly PendingNotification[], now = new Date()): Promise<void> {
  if (!events.length || typeof chrome.notifications?.create !== 'function') return;
  try {
    const settings = await bgSettings();
    const wanted = deliverable(events, settings, now);
    if (!wanted.length) return;
    const lang = uiLanguage(settings.language);
    const locale = await loadLocale(lang);
    const messages: Messages = locale.ok ? locale.messages : undefined;
    const iconUrl = chrome.runtime.getURL('icons/icon128.png');

    if (wanted.length > MAX_SINGLE_NOTIFICATIONS) {
      await chrome.notifications.create(summaryNotificationId(now.getTime()), {
        type: 'basic',
        iconUrl,
        title: 'Better GHub',
        message: pluralText(messages, lang, 'notifySummary', wanted.length, {
          one: '$1 update in your pull requests',
          other: '$1 updates in your pull requests',
        }),
      });
      return;
    }
    for (const p of wanted) {
      const [key, fallback] = TITLES[p.event];
      const ref = `${p.item.repo}#${p.item.number}`;
      const actor = actorOf(p);
      await chrome.notifications.create(prNotificationId(p.item.url, p.event), {
        type: 'basic',
        iconUrl,
        title: text(messages, key, fallback, [ref]),
        message: p.item.title || ref,
        ...(actor ? { contextMessage: `@${actor}` } : {}),
      });
    }
  } catch {
    /* notifications unavailable (permission missing, OS settings) */
  }
}

/** Focus a github.com tab already showing `matches`, else open `url` in a new tab. */
async function openOrFocus(url: string, matches: (tabUrl: string) => boolean): Promise<void> {
  try {
    // The github.com host permission exposes tab URLs without the "tabs" permission.
    const tabs = await chrome.tabs.query({ url: 'https://github.com/*' });
    const tab = tabs.find((t) => t.id !== undefined && !!t.url && matches(t.url));
    if (tab?.id !== undefined) {
      await chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
      return;
    }
  } catch {
    /* fall through to a new tab */
  }
  await chrome.tabs.create({ url });
}

/** chrome.notifications.onClicked: open/focus the PR (or the PR list), mark it seen, dismiss. */
export async function onNotificationClicked(id: string): Promise<void> {
  const target = parseNotificationId(id);
  if (!target) return;
  await Promise.resolve(chrome.notifications.clear(id)).catch(() => undefined);
  if (target.kind === 'summary') {
    await openOrFocus(PULLS_URL, (u) => /^https:\/\/github\.com\/pulls(?:[/?#]|$)/.test(u));
    return;
  }
  const want = normalizePrUrl(target.url);
  await openOrFocus(target.url, (u) => normalizePrUrl(u) === want);
  await markSeen([target.url]);
}
