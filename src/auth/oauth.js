// Better GHub - GitHub OAuth Device Flow
// https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow

// NOTE: You need to register your own OAuth App on GitHub to get a Client ID
// Instructions: https://github.com/settings/developers -> "New OAuth App"
// For development/personal use, set:
// - Homepage URL: https://github.com/yourusername/BetterGithubPR
// - Authorization callback URL: Not needed for Device Flow, use: http://localhost
// 
// IMPORTANT: Replace this with your own Client ID or remove OAuth feature
const GITHUB_CLIENT_ID = null; // Set your OAuth Client ID here after registering
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const POLL_INTERVAL = 5000; // 5 seconds

class GitHubOAuth {
  constructor() {
    this.deviceCode = null;
    this.userCode = null;
    this.verificationUri = null;
    this.pollInterval = null;
  }

  /**
   * Step 1: Request device and user verification codes
   */
  async requestDeviceCode() {
    if (!GITHUB_CLIENT_ID) {
      throw new Error('OAuth Client ID not configured. Please register an OAuth App on GitHub or use Personal Access Token instead.');
    }
    
    try {
      const response = await fetch(DEVICE_CODE_URL, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          scope: 'repo read:user'
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error_description || data.error);
      }

      this.deviceCode = data.device_code;
      this.userCode = data.user_code;
      this.verificationUri = data.verification_uri;
      this.expiresIn = data.expires_in;
      this.interval = (data.interval || 5) * 1000;

      return {
        userCode: this.userCode,
        verificationUri: this.verificationUri,
        expiresIn: this.expiresIn
      };
    } catch (error) {
      console.error('Failed to request device code:', error);
      throw error;
    }
  }

  /**
   * Step 2: Poll for access token
   */
  async pollForAccessToken(onProgress) {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = Math.floor(this.expiresIn / (this.interval / 1000));

      this.pollInterval = setInterval(async () => {
        attempts++;

        if (attempts > maxAttempts) {
          this.stopPolling();
          reject(new Error('Authorization timeout'));
          return;
        }

        try {
          const response = await fetch(ACCESS_TOKEN_URL, {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              client_id: GITHUB_CLIENT_ID,
              device_code: this.deviceCode,
              grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
            })
          });

          const data = await response.json();

          if (data.error) {
            switch (data.error) {
              case 'authorization_pending':
                // User hasn't completed authorization yet, keep polling
                if (onProgress) {
                  onProgress({
                    status: 'pending',
                    attempt: attempts,
                    maxAttempts
                  });
                }
                return;
              
              case 'slow_down':
                // We're polling too fast, increase interval
                if (onProgress) {
                  onProgress({
                    status: 'slow_down'
                  });
                }
                return;
              
              case 'expired_token':
                this.stopPolling();
                reject(new Error('Device code expired'));
                return;
              
              case 'access_denied':
                this.stopPolling();
                reject(new Error('User denied authorization'));
                return;
              
              default:
                this.stopPolling();
                reject(new Error(data.error_description || data.error));
                return;
            }
          }

          // Success! We got the access token
          if (data.access_token) {
            this.stopPolling();
            
            // Get user info
            const userInfo = await this.getUserInfo(data.access_token);
            
            resolve({
              accessToken: data.access_token,
              tokenType: data.token_type,
              scope: data.scope,
              user: userInfo
            });
          }
        } catch (error) {
          console.error('Polling error:', error);
          // Continue polling on network errors
          if (onProgress) {
            onProgress({
              status: 'error',
              error: error.message
            });
          }
        }
      }, this.interval);
    });
  }

  /**
   * Get user information using access token
   */
  async getUserInfo(token) {
    try {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to get user info: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to get user info:', error);
      return null;
    }
  }

  /**
   * Stop polling
   */
  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Start the complete OAuth flow
   */
  async authorize(callbacks = {}) {
    try {
      // Step 1: Get device code
      if (callbacks.onDeviceCode) {
        callbacks.onDeviceCode({ status: 'requesting' });
      }

      const deviceInfo = await this.requestDeviceCode();
      
      if (callbacks.onDeviceCode) {
        callbacks.onDeviceCode({
          status: 'ready',
          ...deviceInfo
        });
      }

      // Step 2: Poll for access token
      const result = await this.pollForAccessToken(callbacks.onProgress);
      
      if (callbacks.onSuccess) {
        callbacks.onSuccess(result);
      }

      return result;
    } catch (error) {
      if (callbacks.onError) {
        callbacks.onError(error);
      }
      throw error;
    }
  }

  /**
   * Validate existing token
   */
  static async validateToken(token) {
    try {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (response.ok) {
        const user = await response.json();
        return { valid: true, user };
      }
      
      return { valid: false };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  /**
   * Revoke token
   */
  static async revokeToken(token) {
    // Note: GitHub doesn't provide a way to revoke OAuth tokens via API
    // User needs to revoke manually at https://github.com/settings/applications
    // We just remove it from storage
    return chrome.storage.local.remove(['githubToken', 'githubUser', 'tokenType']);
  }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GitHubOAuth;
}

