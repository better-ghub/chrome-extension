// Better GHub - Popup Script

import { Octicons, TokenManager } from '../src/utils';
import { Constants } from '../src/constants';
import { initI18n, translatePage, msg } from '../src/i18n';

// Insert Octicons
function initOcticons(): void {
  const keyIcon = document.querySelector('.flash .icon');
  const gearIcon = document.querySelector('#open-options .footer-icon');
  const heartIcon = document.querySelector('.footer-heart');

  if (keyIcon) keyIcon.innerHTML = Octicons.get('key', 16);
  if (gearIcon) gearIcon.innerHTML = Octicons.get('gear', 14);
  if (heartIcon) heartIcon.innerHTML = Octicons.get('heart', 12);
}

// Show error message
function showError(message: string): void {
  const errorDiv = document.getElementById('error-message');
  if (!errorDiv) return;
  errorDiv.textContent = message;
  errorDiv.style.display = 'block';
  setTimeout(() => {
    errorDiv.style.display = 'none';
  }, 5000);
}

// Show success message
function showSuccess(message: string): void {
  const successDiv = document.getElementById('success-message');
  if (!successDiv) return;
  successDiv.textContent = message;
  successDiv.style.display = 'block';
  setTimeout(() => {
    successDiv.style.display = 'none';
  }, 3000);
}

// Display user info - returns true if successful
async function displayUserInfo(token: string): Promise<boolean> {
  const result = await TokenManager.testToken(token);

  const loggedOut = document.getElementById('logged-out');
  const loggedIn = document.getElementById('logged-in');

  if (result.success && result.user) {
    const user = result.user;

    const userName = document.getElementById('user-name');
    const userLogin = document.getElementById('user-login');
    const userAvatar = document.getElementById('user-avatar') as HTMLImageElement;

    if (userName) userName.textContent = user.name || user.login;
    if (userLogin) userLogin.textContent = `@${user.login}`;
    if (userAvatar) userAvatar.src = user.avatar_url;

    // Get rate limit
    const rateLimit = await TokenManager.getRateLimit(token);
    if (rateLimit) {
      const rateLimitEl = document.getElementById('rate-limit');
      if (rateLimitEl) {
        rateLimitEl.textContent = `${rateLimit.remaining} / ${rateLimit.limit}`;
      }
    }

    // Show logged in state
    if (loggedOut) loggedOut.style.display = 'none';
    if (loggedIn) loggedIn.style.display = 'block';
    return true;
  } else {
    // Token validation failed - show logged out state
    if (loggedOut) loggedOut.style.display = 'block';
    if (loggedIn) loggedIn.style.display = 'none';
    return false;
  }
}

// Check authentication status
async function checkAuthStatus(): Promise<void> {
  const loadingState = document.getElementById('loading-state');
  const loggedOut = document.getElementById('logged-out');
  const loggedIn = document.getElementById('logged-in');

  if (!loadingState || !loggedOut || !loggedIn) return;

  loadingState.style.display = 'flex';
  loadingState.style.opacity = '1';
  loggedOut.style.display = 'none';
  loggedIn.style.display = 'none';

  const { token } = await TokenManager.getToken();
  let isLoggedIn = false;

  if (token) {
    isLoggedIn = await displayUserInfo(token);
  }

  // Prepare the appropriate panel for display
  if (isLoggedIn) {
    loggedIn.style.opacity = '0';
  } else {
    loggedOut.style.display = 'block';
    loggedOut.style.opacity = '0';
  }

  await new Promise((resolve) => setTimeout(resolve, 150));
  loadingState.style.opacity = '0';

  setTimeout(() => {
    loadingState.style.display = 'none';
    if (isLoggedIn) {
      loggedIn.style.opacity = '1';
    } else {
      loggedOut.style.opacity = '1';
    }
  }, 200);
}

// Save token
async function saveToken(): Promise<void> {
  const tokenInput = document.getElementById('github-token') as HTMLInputElement;
  const token = tokenInput.value.trim();

  if (!token) {
    showError(msg('pleaseEnterToken', 'Please enter a token'));
    return;
  }

  if (!TokenManager.validateTokenFormat(token)) {
    showError(msg('invalidToken', 'Invalid token format'));
    return;
  }

  const saveBtn = document.getElementById('save-token') as HTMLButtonElement;
  saveBtn.textContent = msg('testing', 'Testing token...');
  saveBtn.disabled = true;

  const result = await TokenManager.testToken(token);

  if (result.success && result.user) {
    await TokenManager.setToken(token, result.user);
    showSuccess(msg('tokenSaved', 'Token saved!'));
    tokenInput.value = '';
    saveBtn.textContent = msg('saveToken', 'Save Token');
    saveBtn.disabled = false;

    TokenManager.notifyTabs('tokenUpdated');

    setTimeout(() => {
      void checkAuthStatus();
    }, 500);
  } else {
    showError(`${msg('tokenValidationFailed', 'Token validation failed')}: ${result.error}`);
    saveBtn.textContent = msg('saveToken', 'Save Token');
    saveBtn.disabled = false;
  }
}

// Logout
async function logout(): Promise<void> {
  if (confirm(msg('confirmLogout', 'Are you sure you want to logout?'))) {
    await TokenManager.removeToken();
    showSuccess(msg('loggedOut', 'Logged out successfully'));
    TokenManager.notifyTabs('tokenRemoved');

    setTimeout(() => {
      void checkAuthStatus();
    }, 500);
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await initI18n();
  translatePage();

  const versionEl = document.getElementById('version');
  if (versionEl) versionEl.textContent = `v${Constants.VERSION}`;

  initOcticons();
  void checkAuthStatus();

  document.getElementById('save-token')?.addEventListener('click', () => void saveToken());
  document.getElementById('logout-btn')?.addEventListener('click', () => void logout());

  document.getElementById('github-token')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      void saveToken();
    }
  });

  document.getElementById('open-options')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
});
