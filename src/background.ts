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
    const result = await chrome.storage.local.get(['githubToken', 'tokenType']);

    if (!result.githubToken) {
      return; // No token to validate
    }

    // Check if token is still valid
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `${result.tokenType === 'oauth' ? 'Bearer' : 'token'} ${result.githubToken}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      // Token is invalid, remove it
      console.warn('Better GHub: Token validation failed, removing token');
      await chrome.storage.local.remove(['githubToken', 'githubUser', 'tokenType']);

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
    console.error('Better GHub: Error validating token:', error);
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
          console.error(`Better GHub: Error loading messages for ${lang}`, error);
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

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log(`Better GHub v${Constants.VERSION}: Installed`);
  } else if (details.reason === 'update') {
    console.log(`Better GHub v${Constants.VERSION}: Updated from ${details.previousVersion}`);
  }
});
