// Better GHub - Options Page Script

import { Octicons, TokenManager } from '../src/utils';
import { initI18n, translatePage, msg } from '../src/i18n';

// Insert Octicons into placeholders
function initOcticons(): void {
  const authTab = document.querySelector('.tabnav-tab[data-tab="auth"] .tab-icon');
  const settingsTab = document.querySelector('.tabnav-tab[data-tab="settings"] .tab-icon');
  if (authTab) authTab.innerHTML = Octicons.get('key', 16);
  if (settingsTab) settingsTab.innerHTML = Octicons.get('gear', 16);

  const alertIcons = document.querySelectorAll('.flash .alert-icon');
  alertIcons.forEach((icon, index) => {
    icon.innerHTML = index === 0 ? Octicons.get('info', 16) : Octicons.get('check-circle', 16);
  });

  const trashIcon = document.querySelector('#clear-cache-btn .btn-icon');
  if (trashIcon) trashIcon.innerHTML = Octicons.get('trash', 14);

  const noticeIcon = document.querySelector('.notice-icon');
  if (noticeIcon) noticeIcon.innerHTML = Octicons.get('database', 14);

  const cacheDisabledWarningIcon = document.querySelector('#cache-disabled-warning .octicon-inline');
  if (cacheDisabledWarningIcon) cacheDisabledWarningIcon.innerHTML = Octicons.get('alert', 16);

  const cacheRecommendationIcon = document.querySelector('#cache-time-recommendation .octicon-inline');
  if (cacheRecommendationIcon) cacheRecommendationIcon.innerHTML = Octicons.get('info', 16);
}

// Tab switching
function initTabs(): void {
  document.querySelectorAll('.tabnav-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = (btn as HTMLElement).dataset.tab;

      document.querySelectorAll('.tabnav-tab').forEach((b) => {
        b.classList.remove('active');
        b.removeAttribute('aria-current');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-current', 'page');

      document.querySelectorAll('.tab-content').forEach((c) => {
        (c as HTMLElement).style.display = 'none';
      });
      const tabContent = document.getElementById(`tab-${tab}`);
      if (tabContent) tabContent.style.display = 'block';
    });
  });
}

// ============================================================================
// AUTHENTICATION TAB
// ============================================================================

async function displayUserInfo(token: string): Promise<void> {
  const result = await TokenManager.testToken(token);

  if (result.success && result.user) {
    const user = result.user;

    const userName = document.getElementById('user-name');
    const userLogin = document.getElementById('user-login');
    const userAvatar = document.getElementById('user-avatar') as HTMLImageElement;

    if (userName) userName.textContent = user.name || user.login;
    if (userLogin) userLogin.textContent = `@${user.login}`;
    if (userAvatar) userAvatar.src = user.avatar_url;

    const rateLimit = await TokenManager.getRateLimit(token);
    if (rateLimit) {
      const rateLimitEl = document.getElementById('rate-limit');
      if (rateLimitEl) {
        rateLimitEl.textContent = `${rateLimit.remaining} / ${rateLimit.limit}`;
      }
    }

    const loading = document.getElementById('auth-status-loading');
    const loggedOut = document.getElementById('auth-status-logged-out');
    const loggedIn = document.getElementById('auth-status-logged-in');

    if (loading) loading.style.display = 'none';
    if (loggedOut) loggedOut.style.display = 'none';
    if (loggedIn) loggedIn.style.display = 'block';
  }
}

async function checkAuthStatus(): Promise<void> {
  const { token } = await TokenManager.getToken();

  const loading = document.getElementById('auth-status-loading');
  const loggedOut = document.getElementById('auth-status-logged-out');
  const loggedIn = document.getElementById('auth-status-logged-in');

  if (token) {
    await displayUserInfo(token);
  } else {
    if (loading) loading.style.display = 'none';
    if (loggedOut) loggedOut.style.display = 'block';
    if (loggedIn) loggedIn.style.display = 'none';
  }
}

function initAuthListeners(): void {
  // Save token
  document.getElementById('save-token')?.addEventListener('click', async () => {
    const tokenInput = document.getElementById('github-token') as HTMLInputElement;
    const token = tokenInput.value.trim();
    const saveBtn = document.getElementById('save-token') as HTMLButtonElement;

    if (!token) {
      showStatus(msg('pleaseEnterToken', 'Please enter a token'), 'error');
      return;
    }

    if (!TokenManager.validateTokenFormat(token)) {
      showStatus(msg('invalidToken', 'Invalid token format'), 'error');
      return;
    }

    saveBtn.textContent = msg('testing', 'Testing...');
    saveBtn.disabled = true;

    const result = await TokenManager.testToken(token);

    if (result.success && result.user) {
      await TokenManager.setToken(token, 'pat', result.user);
      showStatus(Octicons.get('check-circle', 14) + ' ' + msg('tokenSaved', 'Token saved!'), 'success');
      tokenInput.value = '';
      saveBtn.textContent = msg('saveToken', 'Save Token');
      saveBtn.disabled = false;

      TokenManager.notifyTabs('tokenUpdated');

      setTimeout(() => {
        void checkAuthStatus();
      }, 500);
    } else {
      showStatus(`❌ ${msg('tokenValidationFailed', 'Token validation failed')}: ${result.error}`, 'error');
      saveBtn.textContent = msg('saveToken', 'Save Token');
      saveBtn.disabled = false;
    }
  });

  // Logout
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    if (confirm(msg('confirmLogout', 'Are you sure you want to logout?'))) {
      await TokenManager.removeToken();
      showStatus(msg('loggedOut', 'Logged out successfully'), 'success');
      TokenManager.notifyTabs('tokenRemoved');

      setTimeout(() => {
        void checkAuthStatus();
      }, 500);
    }
  });
}

// ============================================================================
// SETTINGS TAB
// ============================================================================

function loadSettings(): void {
  chrome.storage.local.get(['language', 'cacheEnabled', 'cacheTime', 'batchDelay'], (result) => {
    const langSelect = document.getElementById('setting-language') as HTMLSelectElement;
    if (langSelect) langSelect.value = result.language || 'system';

    const cacheEnabled = result.cacheEnabled !== false;
    const cacheEnabledCheckbox = document.getElementById('setting-cache-enabled') as HTMLInputElement;
    if (cacheEnabledCheckbox) cacheEnabledCheckbox.checked = cacheEnabled;
    updateCacheVisibility(cacheEnabled);

    const cacheTime = result.cacheTime || 300000;
    const cacheTimeInput = document.getElementById('setting-cache-time') as HTMLInputElement;
    if (cacheTimeInput) cacheTimeInput.value = String(cacheTime);
    const formatted = formatCacheTime(cacheTime);
    const cacheTimeValue = document.getElementById('cache-time-value');
    const cacheTimeUnit = document.getElementById('cache-time-unit');
    if (cacheTimeValue) cacheTimeValue.textContent = formatted.value;
    if (cacheTimeUnit) cacheTimeUnit.textContent = formatted.unit;
    updateCacheTimeWarning(cacheTime);

    const batchDelay = result.batchDelay || 500;
    const batchDelayInput = document.getElementById('setting-batch-delay') as HTMLInputElement;
    if (batchDelayInput) batchDelayInput.value = String(batchDelay);
    const batchDelayValue = document.getElementById('batch-delay-value');
    if (batchDelayValue) batchDelayValue.textContent = String(batchDelay);
  });
}

function updateCacheVisibility(enabled: boolean): void {
  const durationSection = document.getElementById('cache-duration-section');
  const disabledWarning = document.getElementById('cache-disabled-warning');

  if (enabled) {
    if (durationSection) durationSection.style.display = 'block';
    if (disabledWarning) disabledWarning.style.display = 'none';
  } else {
    if (durationSection) durationSection.style.display = 'none';
    if (disabledWarning) disabledWarning.style.display = 'block';
  }
}

function updateCacheTimeWarning(ms: number): void {
  const recommendation = document.getElementById('cache-time-recommendation');
  if (recommendation) {
    recommendation.style.display = ms < 300000 ? 'block' : 'none';
  }
}

function initSettingsListeners(): void {
  // Language change
  document.getElementById('setting-language')?.addEventListener('change', (e) => {
    const newLanguage = (e.target as HTMLSelectElement).value;

    chrome.storage.local.set({ language: newLanguage }, () => {
      showStatus(msg('languageSaved', 'Language saved. Reloading...'), 'success');

      TokenManager.notifyTabs('settingsUpdated');

      setTimeout(() => {
        location.reload();
      }, 800);
    });
  });

  // Cache Enabled
  document.getElementById('setting-cache-enabled')?.addEventListener('change', (e) => {
    const enabled = (e.target as HTMLInputElement).checked;
    chrome.storage.local.set({ cacheEnabled: enabled }, () => {
      const statusMsg = enabled ? msg('cacheEnabled', 'Cache enabled') : msg('cacheDisabled', 'Cache disabled');
      showStatus(statusMsg, 'success');
      updateCacheVisibility(enabled);
      TokenManager.notifyTabs('settingsUpdated');
    });
  });

  // Cache Time
  document.getElementById('setting-cache-time')?.addEventListener('input', (e) => {
    const ms = parseInt((e.target as HTMLInputElement).value);
    const formatted = formatCacheTime(ms);
    const cacheTimeValue = document.getElementById('cache-time-value');
    const cacheTimeUnit = document.getElementById('cache-time-unit');
    if (cacheTimeValue) cacheTimeValue.textContent = formatted.value;
    if (cacheTimeUnit) cacheTimeUnit.textContent = formatted.unit;
    updateCacheTimeWarning(ms);
  });

  document.getElementById('setting-cache-time')?.addEventListener('change', (e) => {
    const ms = parseInt((e.target as HTMLInputElement).value);
    chrome.storage.local.set({ cacheTime: ms }, () => {
      const formatted = formatCacheTime(ms);
      const statusMsg = msg('cacheTimeSet', 'Cache duration set').replace('$1', `${formatted.value} ${formatted.unit}`);
      showStatus(statusMsg, 'success');
      TokenManager.notifyTabs('settingsUpdated');
    });
  });

  // Batch Delay
  document.getElementById('setting-batch-delay')?.addEventListener('input', (e) => {
    const value = (e.target as HTMLInputElement).value;
    const batchDelayValue = document.getElementById('batch-delay-value');
    if (batchDelayValue) batchDelayValue.textContent = value;
  });

  document.getElementById('setting-batch-delay')?.addEventListener('change', (e) => {
    const value = parseInt((e.target as HTMLInputElement).value);
    chrome.storage.local.set({ batchDelay: value }, () => {
      const statusMsg = msg('batchDelaySet', 'Batch delay set').replace('$1', String(value));
      showStatus(statusMsg, 'success');
      TokenManager.notifyTabs('settingsUpdated');
    });
  });

  // Clear Cache
  document.getElementById('clear-cache-btn')?.addEventListener('click', () => {
    TokenManager.notifyTabs('clearCache');

    const clearedSpan = document.getElementById('cache-cleared');
    if (clearedSpan) clearedSpan.style.display = 'inline';
    showStatus(msg('cacheCleared', 'Cache cleared!'), 'success');

    setTimeout(() => {
      if (clearedSpan) clearedSpan.style.display = 'none';
    }, 3000);
  });
}

// ============================================================================
// UTILITIES
// ============================================================================

function showStatus(message: string, type: 'success' | 'error' = 'success'): void {
  const statusDiv = document.getElementById('status-message');
  if (!statusDiv) return;

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

function formatCacheTime(ms: number): { value: string; unit: string } {
  if (ms < 1000) {
    return { value: String(ms), unit: 'ms' };
  } else if (ms < 60000) {
    return { value: (ms / 1000).toFixed(1), unit: 's' };
  } else {
    return { value: (ms / 60000).toFixed(1), unit: 'min' };
  }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize i18n and translate HTML __MSG_*__ placeholders
  await initI18n();
  translatePage();

  initOcticons();
  initTabs();
  initAuthListeners();
  initSettingsListeners();

  void checkAuthStatus();
  loadSettings();
});
