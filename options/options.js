const VERSION = '0.1.0';

// Insert Octicons into placeholders
function initOcticons() {
  // Tab icons
  const authTab = document.querySelector('.tabnav-tab[data-tab="auth"] .tab-icon');
  const settingsTab = document.querySelector('.tabnav-tab[data-tab="settings"] .tab-icon');
  if (authTab) authTab.innerHTML = Octicons.get('key', 16);
  if (settingsTab) settingsTab.innerHTML = Octicons.get('gear', 16);
  
  // Alert icons
  const alertIcons = document.querySelectorAll('.flash .alert-icon');
  alertIcons.forEach((icon, index) => {
    // First one is info (logged-out), second is success (logged-in)
    icon.innerHTML = index === 0 ? Octicons.get('info', 16) : Octicons.get('check-circle', 16);
  });
  
  // Button icon
  const trashIcon = document.querySelector('#clear-cache-btn .btn-icon');
  if (trashIcon) trashIcon.innerHTML = Octicons.get('trash', 14);
  
  // Notice icon
  const noticeIcon = document.querySelector('.notice-icon');
  if (noticeIcon) noticeIcon.innerHTML = Octicons.get('database', 14);
  
  // Cache warning icons
  const cacheDisabledWarningIcon = document.querySelector('#cache-disabled-warning .octicon-inline');
  if (cacheDisabledWarningIcon) cacheDisabledWarningIcon.innerHTML = Octicons.get('alert', 16);
  
  const cacheRecommendationIcon = document.querySelector('#cache-time-recommendation .octicon-inline');
  if (cacheRecommendationIcon) cacheRecommendationIcon.innerHTML = Octicons.get('info', 16);
}

// Get translated message
async function getMessage(key, fallback) {
    const result = await new Promise(resolve => {
        chrome.storage.local.get(['language'], resolve);
    });
    
    let lang = result.language || 'system';
    if (lang === 'system') {
        lang = chrome.i18n.getUILanguage().split('-')[0];
    }
    
    try {
        const url = chrome.runtime.getURL(`_locales/${lang}/messages.json`);
        const response = await fetch(url);
        const messages = await response.json();
        return messages[key]?.message || fallback || key;
    } catch (error) {
        return chrome.i18n.getMessage(key) || fallback || key;
    }
}

// Tab switching
document.querySelectorAll('.tabnav-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    
    // Update buttons
    document.querySelectorAll('.tabnav-tab').forEach(b => {
      b.classList.remove('active');
      b.removeAttribute('aria-current');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-current', 'page');
    
    // Update content
    document.querySelectorAll('.tab-content').forEach(c => {
      c.style.display = 'none';
    });
    document.getElementById(`tab-${tab}`).style.display = 'block';
  });
});

// ============================================================================
// AUTHENTICATION TAB
// ============================================================================

async function testGitHubToken(token) {
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (response.ok) {
      const userData = await response.json();
      return { success: true, user: userData };
    } else {
      return { success: false, error: `HTTP ${response.status}` };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function getRateLimit(token) {
  try {
    const response = await fetch('https://api.github.com/rate_limit', {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      return data.rate;
    }
  } catch (error) {
    console.error('Failed to get rate limit:', error);
  }
  return null;
}

async function displayUserInfo(token) {
  const result = await testGitHubToken(token);
  
  if (result.success && result.user) {
    const user = result.user;
    
    document.getElementById('user-name').textContent = user.name || user.login;
    document.getElementById('user-login').textContent = `@${user.login}`;
    document.getElementById('user-avatar').src = user.avatar_url;
    
    // Get rate limit
    const rateLimit = await getRateLimit(token);
    if (rateLimit) {
      document.getElementById('rate-limit').textContent = 
        `${rateLimit.remaining} / ${rateLimit.limit}`;
    }
    
    // Show logged in state
    document.getElementById('auth-status-loading').style.display = 'none';
    document.getElementById('auth-status-logged-out').style.display = 'none';
    document.getElementById('auth-status-logged-in').style.display = 'block';
  }
}

async function checkAuthStatus() {
  chrome.storage.local.get(['githubToken'], async (result) => {
    if (result.githubToken) {
      await displayUserInfo(result.githubToken);
    } else {
      document.getElementById('auth-status-loading').style.display = 'none';
      document.getElementById('auth-status-logged-out').style.display = 'block';
      document.getElementById('auth-status-logged-in').style.display = 'none';
    }
  });
}

// Save token
document.getElementById('save-token').addEventListener('click', async () => {
  const tokenInput = document.getElementById('github-token');
  const token = tokenInput.value.trim();
  const saveBtn = document.getElementById('save-token');
  
  if (!token) {
    showStatus(await getMessage('pleaseEnterToken', 'Please enter a token'), 'error');
    return;
  }
  
  saveBtn.textContent = await getMessage('testing', 'Testing...');
  saveBtn.disabled = true;
  
  const result = await testGitHubToken(token);
  
  if (result.success) {
    chrome.storage.local.set({ 
      githubToken: token,
      githubUser: result.user 
    }, async () => {
      showStatus(Octicons.get('check-circle', 14) + ' ' + await getMessage('tokenSaved', 'Token saved successfully!'), 'success');
      tokenInput.value = '';
      saveBtn.textContent = await getMessage('saveToken', 'Save Token');
      saveBtn.disabled = false;
      
      // Notify content scripts
      chrome.tabs.query({url: 'https://github.com/*/*/pulls*'}, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { action: 'tokenUpdated' });
        });
      });
      
      setTimeout(() => {
        checkAuthStatus();
      }, 500);
    });
  } else {
    showStatus(`❌ ${await getMessage('tokenValidationFailed', 'Token validation failed')}: ${result.error}`, 'error');
    saveBtn.textContent = await getMessage('saveToken', 'Save Token');
    saveBtn.disabled = false;
  }
});

// Logout
document.getElementById('logout-btn').addEventListener('click', async () => {
  if (confirm(await getMessage('confirmLogout', 'Are you sure you want to logout?'))) {
    chrome.storage.local.remove(['githubToken', 'githubUser'], async () => {
      showStatus(await getMessage('loggedOut', 'Logged out successfully'), 'success');
      
      // Notify content scripts
      chrome.tabs.query({url: 'https://github.com/*/*/pulls*'}, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { action: 'tokenRemoved' });
        });
      });
      
      setTimeout(() => {
        checkAuthStatus();
      }, 500);
    });
  }
});

// ============================================================================
// SETTINGS TAB
// ============================================================================

// Load settings
function loadSettings() {
  chrome.storage.local.get([
    'language',
    'cacheEnabled',
    'cacheTime',
    'batchDelay'
  ], (result) => {
    // Language
    document.getElementById('setting-language').value = result.language || 'system';
    
    // Cache Enabled (default to true)
    const cacheEnabled = result.cacheEnabled !== false;
    document.getElementById('setting-cache-enabled').checked = cacheEnabled;
    updateCacheVisibility(cacheEnabled);
    
    // Cache Time
    const cacheTime = result.cacheTime || 300000; // 5 minutes default
    document.getElementById('setting-cache-time').value = cacheTime;
    const formatted = formatCacheTime(cacheTime);
    document.getElementById('cache-time-value').textContent = formatted.value;
    document.getElementById('cache-time-unit').textContent = formatted.unit;
    updateCacheTimeWarning(cacheTime);
    
    // Batch Delay
    const batchDelay = result.batchDelay || 500;
    document.getElementById('setting-batch-delay').value = batchDelay;
    document.getElementById('batch-delay-value').textContent = batchDelay;
  });
}

// Update cache-related UI visibility
function updateCacheVisibility(enabled) {
  const durationSection = document.getElementById('cache-duration-section');
  const disabledWarning = document.getElementById('cache-disabled-warning');
  
  if (enabled) {
    durationSection.style.display = 'block';
    disabledWarning.style.display = 'none';
  } else {
    durationSection.style.display = 'none';
    disabledWarning.style.display = 'block';
  }
}

// Update cache time recommendation warning
function updateCacheTimeWarning(ms) {
  const recommendation = document.getElementById('cache-time-recommendation');
  
  if (ms < 300000) { // Less than 5 minutes
    recommendation.style.display = 'block';
  } else {
    recommendation.style.display = 'none';
  }
}

// Language change
document.getElementById('setting-language').addEventListener('change', async (e) => {
  const newLanguage = e.target.value;
  
  chrome.storage.local.set({ language: newLanguage }, async () => {
    showStatus(await getMessage('languageSaved', 'Language saved. Reloading...'), 'success');
    
    // Notify that language changed
    chrome.tabs.query({url: 'https://github.com/*/*/pulls*'}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { 
          action: 'settingsUpdated',
          languageChanged: true 
        }).catch(() => {
          // Ignore errors for inactive tabs
        });
      });
    });
    
    // Reload options page to show new language
    setTimeout(() => {
      location.reload();
    }, 800);
  });
});

// Cache Enabled
document.getElementById('setting-cache-enabled').addEventListener('change', async (e) => {
  const enabled = e.target.checked;
  chrome.storage.local.set({ cacheEnabled: enabled }, async () => {
    const msg = enabled 
      ? await getMessage('cacheEnabled', 'Cache enabled')
      : await getMessage('cacheDisabled', 'Cache disabled');
    showStatus(msg, 'success');
    
    updateCacheVisibility(enabled);
    
    // Notify content scripts
    chrome.tabs.query({url: 'https://github.com/*/*/pulls*'}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { 
          action: 'settingsUpdated',
          cacheEnabled: enabled 
        });
      });
    });
  });
});

// Cache Time
document.getElementById('setting-cache-time').addEventListener('input', (e) => {
  const ms = parseInt(e.target.value);
  const formatted = formatCacheTime(ms);
  document.getElementById('cache-time-value').textContent = formatted.value;
  document.getElementById('cache-time-unit').textContent = formatted.unit;
  updateCacheTimeWarning(ms);
});

document.getElementById('setting-cache-time').addEventListener('change', async (e) => {
  const ms = parseInt(e.target.value);
  chrome.storage.local.set({ cacheTime: ms }, async () => {
    const formatted = formatCacheTime(ms);
    const msg = await getMessage('cacheTimeSet', 'Cache duration set to $1');
    showStatus(msg.replace('$1', `${formatted.value} ${formatted.unit}`), 'success');
    
    // Update constants
    chrome.tabs.query({url: 'https://github.com/*/*/pulls*'}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { 
          action: 'settingsUpdated',
          cacheTime: ms 
        });
      });
    });
  });
});

// Batch Delay
document.getElementById('setting-batch-delay').addEventListener('input', (e) => {
  const value = e.target.value;
  document.getElementById('batch-delay-value').textContent = value;
});

document.getElementById('setting-batch-delay').addEventListener('change', async (e) => {
  const value = parseInt(e.target.value);
  chrome.storage.local.set({ batchDelay: value }, async () => {
    const msg = await getMessage('batchDelaySet', 'Batch delay set to $1ms');
    showStatus(msg.replace('$1', value), 'success');
    
    // Update constants
    chrome.tabs.query({url: 'https://github.com/*/*/pulls*'}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { 
          action: 'settingsUpdated',
          batchDelay: value 
        });
      });
    });
  });
});

// Clear Cache
document.getElementById('clear-cache-btn').addEventListener('click', async () => {
  // Send message to content scripts to clear their caches
  chrome.tabs.query({url: 'https://github.com/*/*/pulls*'}, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { action: 'clearCache' });
    });
  });
  
  // Show success message
  const clearedSpan = document.getElementById('cache-cleared');
  clearedSpan.style.display = 'inline';
  showStatus(await getMessage('cacheCleared', 'Cache cleared successfully!'), 'success');
  
  setTimeout(() => {
    clearedSpan.style.display = 'none';
  }, 3000);
});

// ============================================================================
// UTILITIES
// ============================================================================

function showStatus(message, type = 'success') {
  const statusDiv = document.getElementById('status-message');
  statusDiv.innerHTML = message;
  statusDiv.style.display = 'block';
  statusDiv.className = 'flash mt-3';
  
  if (type === 'error') {
    statusDiv.classList.add('flash-error');
  } else {
    statusDiv.classList.add('flash-success');
  }
  
  setTimeout(() => {
    statusDiv.style.display = 'none';
  }, 3000);
}

function formatCacheTime(ms) {
  if (ms < 1000) {
    return { value: ms, unit: 'ms' };
  } else if (ms < 60000) {
    return { value: (ms / 1000).toFixed(1), unit: 's' };
  } else {
    return { value: (ms / 60000).toFixed(1), unit: 'min' };
  }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  initOcticons();
  checkAuthStatus();
  loadSettings();
});

