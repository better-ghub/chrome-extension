// Better GHub - Locale files for content scripts + opening the options page.

const LANGUAGES = ['en', 'pl'];
const localeCache = new Map<string, Record<string, { message: string }>>();

/** Content scripts cannot fetch chrome-extension:// URLs, so they ask us. */
export async function loadLocale(language: unknown): Promise<{ ok: boolean; messages?: Record<string, { message: string }> }> {
  const lang = typeof language === 'string' && LANGUAGES.includes(language) ? language : 'en';
  const cached = localeCache.get(lang);
  if (cached) return { ok: true, messages: cached };
  try {
    const res = await fetch(chrome.runtime.getURL(`_locales/${lang}/messages.json`));
    if (!res.ok) return { ok: false };
    const messages = (await res.json()) as Record<string, { message: string }>;
    localeCache.set(lang, messages);
    return { ok: true, messages };
  } catch {
    return { ok: false };
  }
}

/** Allowed hashes: "account", "shortcuts", ..., or "add-token/<owner>" (a GitHub login). */
export function sectionHash(section: unknown): string {
  return typeof section === 'string' && /^[a-z0-9-]{1,40}(\/[a-z0-9][a-z0-9._-]{0,99})?$/i.test(section) ? `#${section}` : '';
}

/** Open the options page at `section` (URL hash), focusing an existing tab. */
export async function openOptions(section?: unknown): Promise<{ ok: boolean }> {
  const base = chrome.runtime.getURL('options/options.html');
  const hash = sectionHash(section);
  const url = base + hash;
  try {
    // getContexts (Chrome 116+) sees our own pages without the "tabs" permission.
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB' as chrome.runtime.ContextType] });
    const existing = contexts.find((c) => c.tabId >= 0 && c.documentUrl?.startsWith(base));
    if (existing) {
      await chrome.tabs.update(existing.tabId, { active: true, ...(hash ? { url } : {}) });
      if (existing.windowId >= 0) await chrome.windows.update(existing.windowId, { focused: true });
      return { ok: true };
    }
  } catch {
    /* fall through to a new tab */
  }
  try {
    await chrome.tabs.create({ url });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
