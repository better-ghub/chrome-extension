// Better GHub - Content Script for PR List Pages

import { Constants } from './constants';
import { DOMHelpers, TokenManager } from './utils';
import { i18n } from './i18n';
import { PRProcessor } from './pr-service';
import { VersionBadge } from './ui';

let processor: PRProcessor | null = null;

async function processAllPRs(): Promise<void> {
  if (!processor) return;

  console.log(`Better GHub v${Constants.VERSION}: Looking for PR rows...`);

  const prRows = DOMHelpers.findPRRows();

  if (prRows.length === 0) {
    console.log(`Better GHub v${Constants.VERSION}: No PR rows found`);
    return;
  }

  console.log(`Better GHub v${Constants.VERSION}: Found ${prRows.length} PR rows`);

  const promises = prRows.map((row) => processor!.processPRRow(row));
  await Promise.all(promises);

  console.log(`Better GHub v${Constants.VERSION}: All PRs processed`);
}

let currentURL = window.location.href;
let mutationObserver: MutationObserver | null = null;
let initialized = false;

function cleanup(): void {
  if (mutationObserver) {
    mutationObserver.disconnect();
    mutationObserver = null;
  }
}

async function init(): Promise<void> {
  if (!DOMHelpers.isPRListPage()) return;

  console.log(`Better GHub v${Constants.VERSION}: Initializing...`);

  try {
    if (!initialized) {
      await i18n.init();
    }

    const tokenData = await TokenManager.getToken();
    if (!tokenData.token) {
      console.log('Better GHub: No GitHub token. Configure in extension popup.');
    }

    if (!processor) {
      processor = new PRProcessor(tokenData.token || null);
    } else {
      processor.setToken(tokenData.token || null);
    }

    VersionBadge.showVersionBadge();
    void processAllPRs();
    initialized = true;
    
    // Setup observer after successful initialization
    if (!mutationObserver) {
      mutationObserver = new MutationObserver((mutations) => {
        // Guard: only process if initialized and processor exists
        if (!initialized || !processor) return;
        
        let shouldProcess = false;

        for (const mutation of mutations) {
          if (mutation.addedNodes.length > 0) {
            for (const node of mutation.addedNodes) {
              if (node.nodeType === Node.ELEMENT_NODE) {
                const element = node as Element;
                if (
                  element.classList?.contains('js-issue-row') ||
                  element.id?.startsWith('issue_') ||
                  element.querySelector?.('.js-issue-row')
                ) {
                  shouldProcess = true;
                  break;
                }
              }
            }
          }
        }

        if (shouldProcess) {
          setTimeout(() => void processAllPRs(), 100);
        }
      });

      const container = document.querySelector('[data-hpc] .js-navigation-container, [role="main"]');
      if (container) {
        mutationObserver.observe(container, { childList: true, subtree: true });
      }
    }
  } catch (error) {
    console.error('Better GHub: Initialization failed', error);
  }
}

function handleNavigation(): void {
  const newURL = window.location.href;
  if (newURL !== currentURL) {
    console.log(`Better GHub: Navigation detected`);
    currentURL = newURL;
    setTimeout(() => void init(), 100);
  }
}

interface MessageRequest {
  action: string;
  languageChanged?: boolean;
}

const messageHandlers: Record<string, (request: MessageRequest) => Promise<void> | void> = {
  tokenUpdated: async () => {
    console.log(`Better GHub: Token updated, reloading...`);
    const tokenData = await TokenManager.getToken();
    processor?.setToken(tokenData.token || null);
    processor?.clearCache();
    document.querySelectorAll(`[${Constants.PROCESSED_ATTR}]`).forEach((el) => el.removeAttribute(Constants.PROCESSED_ATTR));
    void processAllPRs();
  },

  tokenRemoved: () => {
    processor?.setToken(null);
    processor?.clearCache();
    document.querySelectorAll('.better-ghub-activity').forEach((el) => el.remove());
  },

  tokenInvalid: () => {
    processor?.setToken(null);
    processor?.clearCache();
    document.querySelectorAll('.better-ghub-activity').forEach((el) => el.remove());
  },

  clearCache: () => {
    processor?.clearCache();
    document.querySelectorAll(`[${Constants.PROCESSED_ATTR}]`).forEach((el) => el.removeAttribute(Constants.PROCESSED_ATTR));
    void processAllPRs();
  },

  settingsUpdated: async (request: MessageRequest) => {
    if (request.languageChanged) await i18n.init();
    processor?.clearCache();
    document.querySelectorAll(`[${Constants.PROCESSED_ATTR}]`).forEach((el) => el.removeAttribute(Constants.PROCESSED_ATTR));
    void processAllPRs();
  },
};

chrome.runtime.onMessage.addListener((request: MessageRequest) => {
  const handler = messageHandlers[request.action];
  if (handler) Promise.resolve(handler(request)).catch(console.error);
});

const setupNavigationWatcher = (): void => {
  ['turbo:load', 'turbo:render', 'turbo:frame-load', 'pjax:end'].forEach((event) => {
    document.addEventListener(event, handleNavigation);
  });

  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function (...args: Parameters<typeof history.pushState>) {
    originalPushState.apply(this, args);
    handleNavigation();
  };

  history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
    originalReplaceState.apply(this, args);
    handleNavigation();
  };

  window.addEventListener('popstate', handleNavigation);
};

setupNavigationWatcher();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void init());
} else {
  void init();
}

export { cleanup };
