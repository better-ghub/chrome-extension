// Internationalization Helper
// Wrapper for Chrome i18n API with custom language override

const BetterGHub_i18n = {
  currentLanguage: null,
  messages: {},
  
  // Initialize i18n system
  async init() {
    try {
      // Get language preference from storage
      const result = await new Promise(resolve => {
        chrome.storage.local.get(['language'], resolve);
      });
      
      let lang = result.language || 'system';
      
      if (lang === 'system') {
        // Use Chrome's default
        lang = chrome.i18n.getUILanguage().split('-')[0]; // en-US -> en
      }
      
      this.currentLanguage = lang;
      
      // Load messages for selected language
      await this.loadMessages(lang);
      
      console.log(`Better GHub: i18n loaded (${lang}) with ${Object.keys(this.messages).length} messages`);
    } catch (error) {
      console.error('Better GHub: Failed to initialize i18n', error);
      this.currentLanguage = 'en';
      this.messages = {};
    }
  },
  
  // Load messages.json for specific language via background script
  async loadMessages(lang) {
    try {
      // Ask background script to load the messages file with timeout
      const response = await Promise.race([
        chrome.runtime.sendMessage({
          action: 'loadMessages',
          language: lang
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Background script timeout')), 3000)
        )
      ]);
      
      if (response && response.success) {
        this.messages = response.messages;
        console.log(`Better GHub: Loaded ${Object.keys(response.messages).length} messages (${lang})`);
      } else {
        throw new Error(response?.error || 'Failed to load messages');
      }
    } catch (error) {
      console.warn(`Better GHub: Failed to load messages (${error.message}), using Chrome i18n fallback`);
      
      // Fallback: use Chrome's built-in i18n (works but can't switch language dynamically)
      // This will use the browser's default language
      this.messages = {};
      this.currentLanguage = chrome.i18n.getUILanguage().split('-')[0];
    }
  },
  
  // Get translated message
  getMessage: function(key, substitutions) {
    // If messages are loaded, use custom system
    if (this.messages && this.messages[key]) {
      let message = this.messages[key].message;
      
      // Handle substitutions
      if (substitutions) {
        if (Array.isArray(substitutions)) {
          substitutions.forEach((sub, index) => {
            message = message.replace(`$${index + 1}`, sub);
          });
        } else {
          message = message.replace('$1', substitutions);
        }
      }
      
      return message;
    }
    
    // Fallback to Chrome i18n
    const fallback = chrome.i18n.getMessage(key, substitutions);
    if (!fallback) {
      console.warn(`Better GHub i18n: Key "${key}" not found`);
    }
    return fallback || key;
  },
  
  getCurrentLocale: function() {
    return this.currentLanguage || chrome.i18n.getUILanguage();
  }
};
