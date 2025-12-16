// Internationalization Helper for Popup/Options
// Simple version that loads messages based on user preference

async function BetterGHub_loadLanguage() {
  // Get language preference from storage
  const result = await new Promise(resolve => {
    chrome.storage.local.get(['language'], resolve);
  });

  let lang = result.language || 'system';

  if (lang === 'system') {
    // Use Chrome's default
    lang = chrome.i18n.getUILanguage().split('-')[0]; // en-US -> en
  }

  // Load messages for selected language
  try {
    const url = chrome.runtime.getURL(`_locales/${lang}/messages.json`);
    const response = await fetch(url);
    const messages = await response.json();

    // Translate all elements with data-i18n attribute
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (messages[key]) {
        if (el.tagName === 'INPUT' && el.placeholder !== undefined) {
          el.placeholder = messages[key].message;
        } else if (el.tagName === 'OPTION') {
          // Skip translating option values - they have hardcoded multilingual text
          return;
        } else {
          el.textContent = messages[key].message;
        }
      }
    });

    console.log(`Better GHub: UI language set to ${lang}`);
  } catch (error) {
    console.warn(`Failed to load UI messages for ${lang}:`, error);
  }
}

// Auto-run on DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', BetterGHub_loadLanguage);
} else {
  BetterGHub_loadLanguage();
}

