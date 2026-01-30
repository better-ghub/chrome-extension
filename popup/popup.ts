// Better GHub - Popup Script

import { Octicons, TokenManager } from '../src/utils';
import { GitHubOAuth } from '../src/oauth';
import { Constants } from '../src/constants';
import { initI18n, translatePage, msg } from '../src/i18n';

// OAuth instance
let oauthFlow: GitHubOAuth | null = null;
let countdownInterval: ReturnType<typeof setInterval> | null = null;

// Insert Octicons
function initOcticons(): void {
  const keyIcon = document.querySelector('.flash .icon');
  const gearIcon = document.querySelector('#open-options .footer-icon');
  const heartIcon = document.querySelector('.footer-heart');
  const oauthIcon = document.querySelector('#oauth-login .oauth-icon');
  const oauthProgressIcon = document.querySelector('.oauth-progress-icon');

  if (keyIcon) keyIcon.innerHTML = Octicons.get('key', 16);
  if (gearIcon) gearIcon.innerHTML = Octicons.get('gear', 14);
  if (heartIcon) heartIcon.innerHTML = Octicons.get('heart', 12);
  if (oauthIcon) oauthIcon.innerHTML = Octicons.get('mark-github', 16);
  if (oauthProgressIcon) oauthProgressIcon.innerHTML = Octicons.get('sync', 24);
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
  successDiv.innerHTML = message;
  successDiv.style.display = 'block';
  setTimeout(() => {
    successDiv.style.display = 'none';
  }, 3000);
}

// Display user info
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

    // Get rate limit
    const rateLimit = await TokenManager.getRateLimit(token);
    if (rateLimit) {
      const rateLimitEl = document.getElementById('rate-limit');
      if (rateLimitEl) {
        rateLimitEl.textContent = `${rateLimit.remaining} / ${rateLimit.limit}`;
      }
    }

    // Show logged in state
    const loggedOut = document.getElementById('logged-out');
    const loggedIn = document.getElementById('logged-in');
    if (loggedOut) loggedOut.style.display = 'none';
    if (loggedIn) loggedIn.style.display = 'block';
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

  if (token) {
    loggedIn.style.display = 'block';
    loggedIn.style.opacity = '0';
    await displayUserInfo(token);
  } else {
    loggedOut.style.display = 'block';
    loggedOut.style.opacity = '0';
  }

  await new Promise((resolve) => setTimeout(resolve, 150));
  loadingState.style.opacity = '0';

  setTimeout(() => {
    loadingState.style.display = 'none';
    if (token) {
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
    await TokenManager.setToken(token, 'pat', result.user);
    showSuccess(Octicons.get('check-circle', 14) + ' ' + msg('tokenSaved', 'Token saved!'));
    tokenInput.value = '';
    saveBtn.textContent = msg('saveToken', 'Save Token');
    saveBtn.disabled = false;

    TokenManager.notifyTabs('tokenUpdated');

    setTimeout(() => {
      void checkAuthStatus();
    }, 500);
  } else {
    showError(`❌ ${msg('tokenValidationFailed', 'Token validation failed')}: ${result.error}`);
    saveBtn.textContent = msg('saveToken', 'Save Token');
    saveBtn.disabled = false;
  }
}

// OAuth Login
async function startOAuthLogin(): Promise<void> {
  try {
    const loggedOut = document.getElementById('logged-out');
    const oauthLogin = document.getElementById('oauth-login') as HTMLButtonElement;

    if (loggedOut) loggedOut.style.opacity = '0.5';
    if (oauthLogin) oauthLogin.disabled = true;

    oauthFlow = new GitHubOAuth();

    await oauthFlow.authorize({
      onDeviceCode: (data) => {
        if (data.status === 'ready' && data.userCode && data.verificationUri && data.expiresIn) {
          const oauthProgress = document.getElementById('oauth-progress');
          const userCodeDisplay = document.getElementById('user-code-display');
          const openGithubAuth = document.getElementById('open-github-auth');

          if (oauthProgress) oauthProgress.style.display = 'block';
          if (userCodeDisplay) userCodeDisplay.textContent = data.userCode;

          if (openGithubAuth) {
            openGithubAuth.onclick = () => {
              chrome.tabs.create({ url: data.verificationUri! });
            };
          }

          startCountdownTimer(data.expiresIn);
        }
      },
      onProgress: (progress) => {
        console.log('OAuth progress:', progress);
      },
      onSuccess: async (result) => {
        await TokenManager.setToken(result.accessToken, 'oauth', result.user);
        showSuccess(Octicons.get('check-circle', 14) + ' ' + msg('oauthSuccess', 'Authenticated!'));
        TokenManager.notifyTabs('tokenUpdated');

        setTimeout(() => {
          void checkAuthStatus();
        }, 500);
      },
      onError: (error) => {
        showError(`${msg('oauthFailed', 'OAuth failed')}: ${error.message}`);
        resetOAuthUI();
      },
    });
  } catch (error) {
    console.error('OAuth error:', error);
    showError(msg('oauthError', 'Failed to start OAuth') + ': ' + (error as Error).message);
    resetOAuthUI();
  }
}

// Cancel OAuth
function cancelOAuth(): void {
  if (oauthFlow) {
    oauthFlow.stopPolling();
    oauthFlow = null;
  }
  resetOAuthUI();
}

// Reset OAuth UI
function resetOAuthUI(): void {
  const oauthProgress = document.getElementById('oauth-progress');
  const loggedOut = document.getElementById('logged-out');
  const oauthLogin = document.getElementById('oauth-login') as HTMLButtonElement;

  if (oauthProgress) oauthProgress.style.display = 'none';
  if (loggedOut) loggedOut.style.opacity = '1';
  if (oauthLogin) oauthLogin.disabled = false;

  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

// Countdown timer
function startCountdownTimer(seconds: number): void {
  let remaining = seconds;
  const timerDisplay = document.getElementById('code-timer');

  if (countdownInterval) {
    clearInterval(countdownInterval);
  }

  countdownInterval = setInterval(() => {
    remaining--;

    const minutes = Math.floor(remaining / 60);
    const secs = remaining % 60;
    if (timerDisplay) {
      timerDisplay.textContent = `${minutes}:${secs.toString().padStart(2, '0')}`;
    }

    if (remaining <= 0) {
      if (countdownInterval) clearInterval(countdownInterval);
      cancelOAuth();
      showError(msg('codeExpired', 'Authorization code expired'));
    }
  }, 1000);
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
  // Initialize i18n and translate HTML __MSG_*__ placeholders
  await initI18n();
  translatePage();

  const versionEl = document.getElementById('version');
  if (versionEl) versionEl.textContent = `v${Constants.VERSION}`;

  initOcticons();

  // Token details always open (OAuth not configured)
  const tokenDetails = document.getElementById('token-details') as HTMLDetailsElement;
  if (tokenDetails) {
    tokenDetails.open = true;
  }

  void checkAuthStatus();

  document.getElementById('oauth-login')?.addEventListener('click', () => void startOAuthLogin());
  document.getElementById('cancel-oauth')?.addEventListener('click', cancelOAuth);
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
