// Better GHub - Internationalization
//
// Chrome's native chrome.i18n always follows the browser UI language, but users
// can pick a language in Options. So we load _locales/<lang>/messages.json
// ourselves: extension pages fetch it directly; content scripts (which cannot
// fetch chrome-extension:// URLs) ask the background worker for it.

import { sendToBackground } from './core/messages';
import { readSettingItems } from './core/settings-storage';

interface MessagesFile {
  [key: string]: { message: string };
}

export const SUPPORTED_LANGUAGES = ['en', 'pl'] as const;

let messages: MessagesFile | null = null;
let currentLocale = 'en';
let loading: Promise<void> | null = null;

function resolveLanguage(stored: unknown): string {
  let lang = typeof stored === 'string' ? stored : 'system';
  if (lang === 'system') {
    try {
      lang = chrome.i18n.getUILanguage().split('-')[0];
    } catch {
      lang = 'en';
    }
  }
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(lang) ? lang : 'en';
}

async function fetchMessages(lang: string): Promise<MessagesFile | null> {
  const isExtensionPage = typeof location !== 'undefined' && location.protocol === 'chrome-extension:';
  if (isExtensionPage || typeof document === 'undefined') {
    try {
      const res = await fetch(chrome.runtime.getURL(`_locales/${lang}/messages.json`));
      if (res.ok) return (await res.json()) as MessagesFile;
    } catch {
      /* fall through */
    }
    return null;
  }
  const res = await sendToBackground('i18n:load', { language: lang }, { ok: false });
  return res.ok && res.messages ? (res.messages as MessagesFile) : null;
}

async function load(): Promise<void> {
  try {
    const { language } = await readSettingItems(['language']);
    const lang = resolveLanguage(language);
    currentLocale = lang;
    messages = (await fetchMessages(lang)) ?? (lang !== 'en' ? await fetchMessages('en') : null);
  } catch {
    messages = null; // fall back to chrome.i18n / inline fallbacks
  }
}

/** Load the user's language. Idempotent; concurrent callers share one load. */
export function initI18n(): Promise<void> {
  if (!loading) loading = load();
  return loading;
}

/** Force a reload (after the language setting changes). */
export function reloadI18n(): Promise<void> {
  loading = load();
  return loading;
}

function substitute(message: string, substitutions?: string | string[]): string {
  if (substitutions === undefined) return message;
  const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
  return message.replace(/\$(\d)/g, (m, i: string) => subs[Number(i) - 1] ?? m);
}

/** Translated message for `key`, or `key` itself when unknown. */
export function getMessage(key: string, substitutions?: string | string[]): string {
  const entry = messages?.[key];
  if (entry) return substitute(entry.message, substitutions);
  try {
    const native = chrome.i18n.getMessage(key, substitutions);
    if (native) return native;
  } catch {
    /* chrome.i18n unavailable (tests / invalidated context) */
  }
  return key;
}

/**
 * Preferred API: translated message with an English fallback used when the key
 * is missing from the locale files. `$1`, `$2`… are replaced by `subs`.
 */
export function t(key: string, fallback: string, subs?: string | string[]): string {
  const out = getMessage(key, subs);
  return out === key ? substitute(fallback, subs) : out;
}

/** Shorthand kept for older call sites. */
export function msg(key: string, fallback?: string): string {
  return fallback === undefined ? getMessage(key) : t(key, fallback);
}

export function getLocale(): string {
  return currentLocale;
}

const MSG_RE = /__MSG_([a-zA-Z0-9_]+)__/g;

/**
 * Translate `__MSG_key__` placeholders in an extension page: text nodes, plus
 * the title/placeholder/aria-label/title attributes. Also honours
 * `data-i18n="key"` (textContent) and `data-i18n-attr="attr:key,attr2:key2"`.
 */
export function translatePage(root: ParentNode = document): void {
  const replace = (s: string): string => s.replace(MSG_RE, (_, key: string) => getMessage(key));

  const walker = document.createTreeWalker(root instanceof Document ? root.body : (root as Node), NodeFilter.SHOW_TEXT);
  const updates: [Text, string][] = [];
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const text = node.textContent;
    if (text?.includes('__MSG_')) updates.push([node, replace(text)]);
  }
  for (const [n, text] of updates) n.textContent = text;

  for (const attr of ['placeholder', 'aria-label', 'title', 'alt']) {
    root.querySelectorAll<HTMLElement>(`[${attr}*="__MSG_"]`).forEach((el) => {
      el.setAttribute(attr, replace(el.getAttribute(attr) || ''));
    });
  }
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    if (key) el.textContent = getMessage(key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-attr]').forEach((el) => {
    for (const pair of (el.dataset.i18nAttr || '').split(',')) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, getMessage(key));
    }
  });

  if (typeof document !== 'undefined' && document.title.includes('__MSG_')) {
    document.title = replace(document.title);
  }
  if (typeof document !== 'undefined') document.documentElement.lang = currentLocale;
}

/** Back-compat object API used by older content-script code. */
export const i18n = {
  init: initI18n,
  getMessage,
  getCurrentLocale: getLocale,
};
