const BetterGHub_TokenManager = {
  async getToken() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['githubToken', 'tokenType'], (result) => {
        resolve({
          token: result.githubToken || null,
          tokenType: result.tokenType || 'pat'
        });
      });
    });
  },

  async setToken(token, tokenType = 'pat', user = null) {
    return new Promise((resolve) => {
      const data = {
        githubToken: token,
        tokenType: tokenType
      };

      if (user) {
        data.githubUser = user;
      }

      chrome.storage.local.set(data, resolve);
    });
  },

  async removeToken() {
    return new Promise((resolve) => {
      chrome.storage.local.remove(['githubToken', 'githubUser', 'tokenType'], resolve);
    });
  },

  validateTokenFormat(token) {
    if (!token) return false;
    return (token.startsWith('ghp_') || token.startsWith('github_pat_')) && token.length >= 40;
  },

  async testToken(token, tokenType = 'pat') {
    try {
      const authHeader = tokenType === 'oauth' ? `Bearer ${token}` : `token ${token}`;

      const response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': authHeader,
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
  },

  async getRateLimit(token, tokenType = 'pat') {
    try {
      const authHeader = tokenType === 'oauth' ? `Bearer ${token}` : `token ${token}`;

      const response = await fetch('https://api.github.com/rate_limit', {
        headers: {
          'Authorization': authHeader,
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
  },

  notifyTabs(action) {
    chrome.tabs.query({ url: 'https://github.com/*/*' }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { action }).catch(() => {});
      });
    });
  }
};

