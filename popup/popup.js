const VERSION = '0.1.0';

// OAuth instance
let oauthFlow = null;

// Insert Octicons
function initOcticons() {
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
function showError(message) {
    const errorDiv = document.getElementById('error-message');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    setTimeout(() => {
        errorDiv.style.display = 'none';
    }, 5000);
}

// Show success message
function showSuccess(message) {
    const successDiv = document.getElementById('success-message');
    successDiv.innerHTML = message;
    successDiv.style.display = 'block';
    setTimeout(() => {
        successDiv.style.display = 'none';
    }, 3000);
}

// Validate GitHub token format
function validateToken(token) {
  // GitHub tokens start with ghp_ for personal access tokens (classic)
  // or start with github_pat_ for fine-grained tokens
  // Classic tokens are at least 40 characters
  return token && (token.startsWith('ghp_') || token.startsWith('github_pat_')) && token.length >= 40;
}

// Test GitHub token
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
        } else if (response.status === 401) {
            return { success: false, error: 'Invalid token' };
        } else {
            return { success: false, error: `HTTP ${response.status}` };
        }
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Get rate limit info
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

// Display user info
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
        document.getElementById('logged-out').style.display = 'none';
        document.getElementById('logged-in').style.display = 'block';
    }
}

// Check authentication status
async function checkAuthStatus() {
    // Show loading initially
    const loadingState = document.getElementById('loading-state');
    const loggedOut = document.getElementById('logged-out');
    const loggedIn = document.getElementById('logged-in');
    
    loadingState.style.display = 'flex';
    loadingState.style.opacity = '1';
    loggedOut.style.display = 'none';
    loggedIn.style.display = 'none';
    
    chrome.storage.local.get(['githubToken'], async (result) => {
        // First, prepare the content (but keep it hidden under loader)
        if (result.githubToken) {
            // Pre-render logged-in state
            loggedIn.style.display = 'block';
            loggedIn.style.opacity = '0';
            await displayUserInfo(result.githubToken);
        } else {
            // Pre-render logged-out state
            loggedOut.style.display = 'block';
            loggedOut.style.opacity = '0';
        }
        
        // Wait a bit to show the loader
        await new Promise(resolve => setTimeout(resolve, 150));
        
        // Fade out loading state
        loadingState.style.opacity = '0';
        
        // After fade out, remove loader and show content
        setTimeout(() => {
            loadingState.style.display = 'none';
            
            if (result.githubToken) {
                loggedIn.style.opacity = '1';
            } else {
                loggedOut.style.opacity = '1';
            }
        }, 200);
    });
}

// Save token
async function saveToken() {
    const tokenInput = document.getElementById('github-token');
    const token = tokenInput.value.trim();
    
    if (!token) {
        showError(await getMessage('pleaseEnterToken', 'Please enter a token'));
        return;
    }
    
    if (!validateToken(token)) {
        showError(await getMessage('invalidToken', 'Invalid token format. Token should start with ghp_ or github_pat_'));
        return;
    }
    
    // Test token
    const saveBtn = document.getElementById('save-token');
    saveBtn.textContent = await getMessage('testing', 'Testing token...');
    saveBtn.disabled = true;
    
    const result = await testGitHubToken(token);
    
    if (result.success) {
        // Save to storage
        chrome.storage.local.set({ 
            githubToken: token,
            githubUser: result.user 
        }, async () => {
            showSuccess(Octicons.get('check-circle', 14) + ' ' + await getMessage('tokenSaved', 'Token saved successfully!'));
            tokenInput.value = '';
            saveBtn.textContent = await getMessage('saveToken', 'Save Token');
            saveBtn.disabled = false;
            
            // Notify content scripts to refresh
            chrome.tabs.query({url: 'https://github.com/*/*/pulls*'}, (tabs) => {
                tabs.forEach(tab => {
                    chrome.tabs.sendMessage(tab.id, { action: 'tokenUpdated' });
                });
            });
            
            // Update display
            setTimeout(() => {
                checkAuthStatus();
            }, 500);
        });
    } else {
        showError(`❌ ${await getMessage('tokenValidationFailed', 'Token validation failed')}: ${result.error}`);
        saveBtn.textContent = await getMessage('saveToken', 'Save Token');
        saveBtn.disabled = false;
    }
}

// OAuth Login
async function startOAuthLogin() {
    try {
        // Hide login form, show progress
        document.getElementById('logged-out').style.opacity = '0.5';
        document.getElementById('oauth-login').disabled = true;
        
        // Load OAuth script
        if (typeof GitHubOAuth === 'undefined') {
            await loadScript('../src/auth/oauth.js');
        }
        
        oauthFlow = new GitHubOAuth();
        
        await oauthFlow.authorize({
            onDeviceCode: (data) => {
                if (data.status === 'ready') {
                    // Show OAuth progress UI
                    document.getElementById('oauth-progress').style.display = 'block';
                    document.getElementById('user-code-display').textContent = data.userCode;
                    
                    // Store verification URI for button
                    document.getElementById('open-github-auth').onclick = () => {
                        chrome.tabs.create({ url: data.verificationUri });
                    };
                    
                    // Start countdown timer
                    startCountdownTimer(data.expiresIn);
                }
            },
            onProgress: (progress) => {
                // You can update UI here if needed
                console.log('OAuth progress:', progress);
            },
            onSuccess: async (result) => {
                // Save token to storage
                await chrome.storage.local.set({
                    githubToken: result.accessToken,
                    githubUser: result.user,
                    tokenType: 'oauth'
                });
                
                showSuccess(Octicons.get('check-circle', 14) + ' ' + await getMessage('oauthSuccess', 'Successfully authenticated with GitHub!'));
                
                // Notify content scripts
                chrome.tabs.query({url: 'https://github.com/*/*/pulls*'}, (tabs) => {
                    tabs.forEach(tab => {
                        chrome.tabs.sendMessage(tab.id, { action: 'tokenUpdated' });
                    });
                });
                
                // Update display
                setTimeout(() => {
                    checkAuthStatus();
                }, 500);
            },
            onError: async (error) => {
                showError(`${await getMessage('oauthFailed', 'OAuth failed')}: ${error.message}`);
                resetOAuthUI();
            }
        });
        
    } catch (error) {
        console.error('OAuth error:', error);
        showError(await getMessage('oauthError', 'Failed to start OAuth') + ': ' + error.message);
        resetOAuthUI();
    }
}

// Cancel OAuth
function cancelOAuth() {
    if (oauthFlow) {
        oauthFlow.stopPolling();
        oauthFlow = null;
    }
    resetOAuthUI();
}

// Reset OAuth UI
function resetOAuthUI() {
    document.getElementById('oauth-progress').style.display = 'none';
    document.getElementById('logged-out').style.opacity = '1';
    document.getElementById('oauth-login').disabled = false;
    
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
}

// Countdown timer
let countdownInterval = null;

function startCountdownTimer(seconds) {
    let remaining = seconds;
    const timerDisplay = document.getElementById('code-timer');
    
    if (countdownInterval) {
        clearInterval(countdownInterval);
    }
    
    countdownInterval = setInterval(async () => {
        remaining--;
        
        const minutes = Math.floor(remaining / 60);
        const secs = remaining % 60;
        timerDisplay.textContent = `${minutes}:${secs.toString().padStart(2, '0')}`;
        
        if (remaining <= 0) {
            clearInterval(countdownInterval);
            cancelOAuth();
            showError(await getMessage('codeExpired', 'Authorization code expired'));
        }
    }, 1000);
}

// Helper to load script dynamically
function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

// Logout
async function logout() {
    if (confirm(await getMessage('confirmLogout', 'Are you sure you want to logout?'))) {
        chrome.storage.local.remove(['githubToken', 'githubUser', 'apiCalls', 'tokenType'], async () => {
            showSuccess(await getMessage('loggedOut', 'Logged out successfully'));
            
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
}

// Check if OAuth is configured
function isOAuthConfigured() {
    // For now, OAuth is disabled by default
    // To enable: Register OAuth App on GitHub and set GITHUB_CLIENT_ID in src/auth/oauth.js
    return false;
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    // Set version
    document.getElementById('version').textContent = `v${VERSION}`;
    
    // Insert Octicons
    initOcticons();
    
    // Wait a bit for i18n to load
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Check if OAuth is configured
    if (isOAuthConfigured()) {
        document.getElementById('oauth-section').style.display = 'block';
        document.getElementById('oauth-divider').style.display = 'flex';
    } else {
        // OAuth not configured, show token section expanded by default
        const tokenDetails = document.getElementById('token-details');
        if (tokenDetails) {
            tokenDetails.open = true;
        }
    }
    
    // Check auth status
    checkAuthStatus();
    
    // Event listeners
    document.getElementById('oauth-login').addEventListener('click', startOAuthLogin);
    document.getElementById('cancel-oauth').addEventListener('click', cancelOAuth);
    document.getElementById('save-token').addEventListener('click', saveToken);
    document.getElementById('logout-btn').addEventListener('click', logout);
    
    // Allow Enter key to save token
    document.getElementById('github-token').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            saveToken();
        }
    });
    
    // Open options page
    document.getElementById('open-options').addEventListener('click', (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
    });
});

