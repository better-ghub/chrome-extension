// Better GHub - Background Service Worker

import { Constants } from './constants';

console.log(`Better GHub v${Constants.VERSION}: Background service worker initialized`);

interface MessagesFile {
  [key: string]: {
    message: string;
    description?: string;
  };
}

async function validateStoredToken(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(['githubToken']);
    const token = typeof result.githubToken === 'string' ? result.githubToken : '';

    if (!token) {
      return; // No token to validate
    }

    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      console.warn('Better GHub: Token validation failed, removing token');
      await chrome.storage.local.remove(['githubToken', 'githubUser']);

      // Notify all GitHub tabs
      const tabs = await chrome.tabs.query({ url: 'https://github.com/*/*/pulls*' });
      tabs.forEach((tab) => {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { action: 'tokenInvalid' }).catch(() => {
            // Silently ignore if tab is not ready
          });
        }
      });
    }
  } catch (error) {
    console.error('Better GHub: Error validating token:', error instanceof Error ? error.message : String(error));
  }
}

// Set up periodic token validation
chrome.alarms.create('validateToken', { periodInMinutes: 360 }); // 6 hours

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'validateToken') {
    void validateStoredToken();
  }
});

// Validate on startup
void validateStoredToken();

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener(
  (
    request: { action: string; language?: string },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: { success: boolean; messages?: MessagesFile; error?: string }) => void
  ) => {
    // Handle loading messages files for content scripts
    if (request.action === 'loadMessages') {
      const lang = request.language || 'en';
      const url = chrome.runtime.getURL(`_locales/${lang}/messages.json`);

      fetch(url)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          return response.json() as Promise<MessagesFile>;
        })
        .then((messages) => {
          sendResponse({ success: true, messages: messages });
        })
        .catch((error: Error) => {
          console.error(`Better GHub: Error loading messages for ${lang}`, error instanceof Error ? error.message : String(error));
          sendResponse({ success: false, error: error.message });
        });

      return true; // Keep channel open for async response
    }

    // Manual token validation request
    if (request.action === 'validateToken') {
      validateStoredToken()
        .then(() => {
          sendResponse({ success: true });
        })
        .catch((error: Error) => {
          sendResponse({ success: false, error: error.message });
        });

      return true; // Keep channel open for async response
    }

    return false;
  }
);

// Handle keyboard shortcuts from commands API
chrome.commands.onCommand.addListener((command) => {
  console.log(`Better GHub: Command received from Chrome: ${command}`);
  if (command === 'toggle-all' || command === 'toggle-files') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      console.log(`Better GHub: Active tab:`, tab?.url);
      if (tab?.id && tab.url?.includes('github.com')) {
        console.log(`Better GHub: Sending ${command} to tab ${tab.id}`);
        chrome.tabs.sendMessage(tab.id, { action: command }).catch(() => {
          // Content script not loaded - this happens after extension reload
          // User needs to refresh the page
          console.log('Better GHub: Content script not loaded. Please refresh the GitHub page.');
        });
      }
    });
  }
});

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log(`Better GHub v${Constants.VERSION}: Installed`);
  } else if (details.reason === 'update') {
    console.log(`Better GHub v${Constants.VERSION}: Updated from ${details.previousVersion}`);
  }
});
