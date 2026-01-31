// Internationalization for Better GHub
// Unified i18n system for content scripts, popup, and options

interface MessagesFile {
  [key: string]: { message: string };
}

// =============================================================================
// Shared State
// =============================================================================

let messages: MessagesFile | null = null;
let currentLocale = 'en';
let initialized = false;

// =============================================================================
// Core i18n Functions
// =============================================================================

/**
 * Initialize i18n by loading the appropriate language
 * Works in both content scripts and popup/options pages
 */
export async function initI18n(): Promise<void> {
  if (initialized) return;

  try {
    const result = await chrome.storage.local.get(['language']);
    let lang = result.language || 'system';

    if (lang === 'system') {
      lang = chrome.i18n.getUILanguage().split('-')[0]; // en-US -> en
    }

    currentLocale = lang;

    // Try loading directly first (works in popup/options)
    const url = chrome.runtime.getURL(`_locales/${lang}/messages.json`);
    const response = await fetch(url);

    if (response.ok) {
      messages = await response.json();
    } else {
      // Fall back to English
      try {
        const enUrl = chrome.runtime.getURL('_locales/en/messages.json');
        const enResponse = await fetch(enUrl);
        if (!enResponse.ok) {
          throw new Error(`Failed to load English fallback: ${enResponse.status}`);
        }
        messages = await enResponse.json();
      } catch (fallbackError) {
        console.error('Better GHub: Failed to load English fallback:', fallbackError);
        throw fallbackError;
      }
    }

    console.log(`Better GHub: i18n loaded (${lang})`);
    initialized = true;
  } catch (error) {
    // For content scripts, try via background script
    try {
      const result = await chrome.storage.local.get(['language']);
      let lang = result.language || chrome.i18n.getUILanguage().split('-')[0];
      if (lang === 'system') lang = chrome.i18n.getUILanguage().split('-')[0];

      currentLocale = lang;

      const response = (await Promise.race([
        chrome.runtime.sendMessage({ action: 'loadMessages', language: lang }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ])) as { success: boolean; messages?: MessagesFile };

      if (response?.success && response.messages) {
        messages = response.messages;
        initialized = true;
      } else {
        // Background response failed - fallback to Chrome native
        console.warn('Better GHub: i18n background response failed, using Chrome native');
        messages = null;
        initialized = true;
      }
    } catch {
      console.warn('Better GHub: i18n fallback to Chrome native');
      messages = null;
      initialized = true;
    }
  }
}

/**
 * Get a translated message by key
 */
export function getMessage(key: string, substitutions?: string | string[]): string {
  // Try loaded messages first
  if (messages?.[key]) {
    let message = messages[key].message;

    if (substitutions) {
      if (Array.isArray(substitutions)) {
        substitutions.forEach((sub, i) => {
          message = message.replace(`$${i + 1}`, sub);
        });
      } else {
        message = message.replace('$1', substitutions);
      }
    }

    return message;
  }

  // Fall back to Chrome's native i18n
  const fallback = chrome.i18n.getMessage(key, substitutions);
  return fallback || key;
}

/**
 * Shorthand for getMessage
 */
export function msg(key: string, fallback?: string): string {
  const result = getMessage(key);
  return result === key && fallback ? fallback : result;
}

/**
 * Get current locale
 */
export function getLocale(): string {
  return currentLocale;
}

// =============================================================================
// HTML Translation (for popup/options)
// =============================================================================

/**
 * Translate all __MSG_*__ placeholders in the document
 * Call this after initI18n()
 */
export function translatePage(): void {
  // Walk through all text nodes
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);

  const nodesToUpdate: { node: Text; newText: string }[] = [];

  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const text = node.textContent;
    if (text?.includes('__MSG_')) {
      const translated = text.replace(/__MSG_([a-zA-Z0-9_]+)__/g, (_, key) => getMessage(key));
      if (translated !== text) {
        nodesToUpdate.push({ node, newText: translated });
      }
    }
  }

  nodesToUpdate.forEach(({ node, newText }) => {
    node.textContent = newText;
  });

  // Translate title
  if (document.title.includes('__MSG_')) {
    document.title = document.title.replace(/__MSG_([a-zA-Z0-9_]+)__/g, (_, key) => getMessage(key));
  }

  // Translate input placeholders
  document.querySelectorAll('input[placeholder]').forEach((input) => {
    const el = input as HTMLInputElement;
    if (el.placeholder.includes('__MSG_')) {
      el.placeholder = el.placeholder.replace(/__MSG_([a-zA-Z0-9_]+)__/g, (_, key) => getMessage(key));
    }
  });
}

// =============================================================================
// Class-based API (for backward compatibility with content scripts)
// =============================================================================

class I18nManager {
  async init(): Promise<void> {
    await initI18n();
  }

  getMessage(key: string, substitutions?: string | string[]): string {
    return getMessage(key, substitutions);
  }

  getCurrentLocale(): string {
    return getLocale();
  }
}

export const i18n = new I18nManager();
