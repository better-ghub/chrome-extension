let BetterGHub_processor = null;

async function BetterGHub_processAllPRs() {
  console.log(`Better GHub v${BetterGHub_Constants.VERSION}: Looking for PR rows...`);

  const prRows = BetterGHub_DOMHelpers.findPRRows();

  if (prRows.length === 0) {
    console.log(`Better GHub v${BetterGHub_Constants.VERSION}: No PR rows found`);
    return;
  }

  console.log(`Better GHub v${BetterGHub_Constants.VERSION}: Found ${prRows.length} PR rows - processing in parallel`);

  const promises = prRows.map(row => BetterGHub_processor.processPRRow(row));
  await Promise.all(promises);

  console.log(`Better GHub v${BetterGHub_Constants.VERSION}: All PRs processed`);
}

async function BetterGHub_loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['cacheTime', 'batchDelay'], (result) => {
      const cacheTime = result.cacheTime || 300000;
      const batchDelay = result.batchDelay || 500;

      BetterGHub_Constants.CACHE_DURATION = cacheTime;
      BetterGHub_Constants.BATCH_DELAY = batchDelay;

      resolve();
    });
  });
}

let BetterGHub_currentURL = window.location.href;
let BetterGHub_mutationObserver = null;
let BetterGHub_initialized = false;

function BetterGHub_cleanup() {
  if (BetterGHub_mutationObserver) {
    BetterGHub_mutationObserver.disconnect();
    BetterGHub_mutationObserver = null;
  }
}

async function BetterGHub_init() {
  if (!BetterGHub_DOMHelpers.isPRListPage()) {
    return;
  }

  console.log(`Better GHub v${BetterGHub_Constants.VERSION}: Initializing...`);

  try {
    if (!BetterGHub_initialized) {
      await BetterGHub_i18n.init();
    }

    await BetterGHub_loadSettings();

    const tokenData = await BetterGHub_TokenManager.getToken();
    if (!tokenData.token) {
      console.log('Better GHub: No GitHub token. Configure in extension popup.');
    }

    if (!BetterGHub_processor) {
      BetterGHub_processor = new BetterGHub_PRProcessor(tokenData.token, tokenData.tokenType);
    } else {
      BetterGHub_processor.setToken(tokenData.token, tokenData.tokenType);
    }

    BetterGHub_VersionBadge.showVersionBadge();

    BetterGHub_processAllPRs();

    BetterGHub_initialized = true;
  } catch (error) {
    console.error('Better GHub: Initialization failed', error);
  }

  if (!BetterGHub_mutationObserver) {
    BetterGHub_mutationObserver = new MutationObserver((mutations) => {
      let shouldProcess = false;

      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.classList?.contains('js-issue-row') ||
                  node.id?.startsWith('issue_') ||
                  node.querySelector?.('.js-issue-row')) {
                shouldProcess = true;
                break;
              }
            }
          }
        }
      }

      if (shouldProcess) {
        setTimeout(BetterGHub_processAllPRs, 100);
      }
    });

    const container = document.querySelector('[data-hpc] .js-navigation-container, [role="main"]');
    if (container) {
      BetterGHub_mutationObserver.observe(container, {
        childList: true,
        subtree: true
      });
    }
  }
}

function BetterGHub_handleNavigation() {
  const newURL = window.location.href;
  if (newURL !== BetterGHub_currentURL) {
    console.log(`Better GHub: Navigation detected from ${BetterGHub_currentURL} to ${newURL}`);
    BetterGHub_currentURL = newURL;

    setTimeout(() => {
      BetterGHub_init();
    }, 100);
  }
}

const BetterGHub_MessageHandlers = {
  tokenUpdated: async () => {
    console.log(`Better GHub v${BetterGHub_Constants.VERSION}: Token updated, reloading...`);
    const tokenData = await BetterGHub_TokenManager.getToken();
    BetterGHub_processor.setToken(tokenData.token, tokenData.tokenType);
    BetterGHub_processor.clearCache();

    document.querySelectorAll(`[${BetterGHub_Constants.PROCESSED_ATTR}]`).forEach(el => {
      el.removeAttribute(BetterGHub_Constants.PROCESSED_ATTR);
    });
    BetterGHub_processAllPRs();
  },

  tokenRemoved: () => {
    console.log(`Better GHub v${BetterGHub_Constants.VERSION}: Token removed`);
    BetterGHub_processor.setToken(null, 'pat');
    BetterGHub_processor.clearCache();
    document.querySelectorAll('.better-ghub-activity').forEach(el => el.remove());
  },

  tokenInvalid: () => {
    console.log(`Better GHub v${BetterGHub_Constants.VERSION}: Token invalid`);
    BetterGHub_processor.setToken(null, 'pat');
    BetterGHub_processor.clearCache();
    document.querySelectorAll('.better-ghub-activity').forEach(el => el.remove());
  },

  clearCache: () => {
    console.log(`Better GHub v${BetterGHub_Constants.VERSION}: Clearing cache...`);
    BetterGHub_processor.clearCache();

    document.querySelectorAll(`[${BetterGHub_Constants.PROCESSED_ATTR}]`).forEach(el => {
      el.removeAttribute(BetterGHub_Constants.PROCESSED_ATTR);
    });
    BetterGHub_processAllPRs();
  },

  settingsUpdated: async (request) => {
    console.log(`Better GHub v${BetterGHub_Constants.VERSION}: Settings updated`);

    if (request.languageChanged) {
      await BetterGHub_i18n.init();
    }

    if (request.cacheTime !== undefined) {
      BetterGHub_Constants.CACHE_DURATION = request.cacheTime;
    }
    if (request.batchDelay !== undefined) {
      BetterGHub_Constants.BATCH_DELAY = request.batchDelay;
    }

    BetterGHub_processor.clearCache();
    document.querySelectorAll(`[${BetterGHub_Constants.PROCESSED_ATTR}]`).forEach(el => {
      el.removeAttribute(BetterGHub_Constants.PROCESSED_ATTR);
    });
    BetterGHub_processAllPRs();
  }
};

chrome.runtime.onMessage.addListener((request, _sender, _sendResponse) => {
  const handler = BetterGHub_MessageHandlers[request.action];
  if (handler) {
    Promise.resolve(handler(request)).catch(error => {
      console.error(`Better GHub: Error handling ${request.action}:`, error);
    });
  }
});

const BetterGHub_setupNavigationWatcher = () => {
  const githubEvents = ['turbo:load', 'turbo:render', 'turbo:frame-load', 'pjax:end'];
  githubEvents.forEach(event => {
    document.addEventListener(event, BetterGHub_handleNavigation);
  });

  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function(...args) {
    originalPushState.apply(this, args);
    BetterGHub_handleNavigation();
  };

  history.replaceState = function(...args) {
    originalReplaceState.apply(this, args);
    BetterGHub_handleNavigation();
  };

  window.addEventListener('popstate', BetterGHub_handleNavigation);
};

BetterGHub_setupNavigationWatcher();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', BetterGHub_init);
} else {
  BetterGHub_init();
}

