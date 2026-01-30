// Better GHub - GitHub OAuth Device Flow
// https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow

import type { GitHubUser } from './types';

// NOTE: Register your OAuth App at https://github.com/settings/developers
const GITHUB_CLIENT_ID: string | null = null;
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  error?: string;
  error_description?: string;
}

interface AccessTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface DeviceInfo {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
}

interface AuthResult {
  accessToken: string;
  tokenType: string;
  scope: string;
  user: GitHubUser | null;
}

interface ProgressInfo {
  status: 'pending' | 'slow_down' | 'error';
  attempt?: number;
  maxAttempts?: number;
  error?: string;
}

interface DeviceCodeInfo {
  status: 'requesting' | 'ready';
  userCode?: string;
  verificationUri?: string;
  expiresIn?: number;
}

interface AuthCallbacks {
  onDeviceCode?: (info: DeviceCodeInfo) => void;
  onProgress?: (info: ProgressInfo) => void;
  onSuccess?: (result: AuthResult) => void;
  onError?: (error: Error) => void;
}

export class GitHubOAuth {
  private deviceCode: string | null = null;
  private userCode: string | null = null;
  private verificationUri: string | null = null;
  private expiresIn = 0;
  private interval = 5000;
  private pollIntervalId: ReturnType<typeof setInterval> | null = null;

  async requestDeviceCode(): Promise<DeviceInfo> {
    if (!GITHUB_CLIENT_ID) {
      throw new Error('OAuth Client ID not configured. Use Personal Access Token instead.');
    }

    const response = await fetch(DEVICE_CODE_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, scope: 'repo read:user' }),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = (await response.json()) as DeviceCodeResponse;
    if (data.error) throw new Error(data.error_description || data.error);

    this.deviceCode = data.device_code;
    this.userCode = data.user_code;
    this.verificationUri = data.verification_uri;
    this.expiresIn = data.expires_in;
    this.interval = (data.interval || 5) * 1000;

    return { userCode: this.userCode, verificationUri: this.verificationUri, expiresIn: this.expiresIn };
  }

  async pollForAccessToken(onProgress?: (info: ProgressInfo) => void): Promise<AuthResult> {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = Math.floor(this.expiresIn / (this.interval / 1000));

      this.pollIntervalId = setInterval(async () => {
        attempts++;

        if (attempts > maxAttempts) {
          this.stopPolling();
          reject(new Error('Authorization timeout'));
          return;
        }

        try {
          const response = await fetch(ACCESS_TOKEN_URL, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({
              client_id: GITHUB_CLIENT_ID,
              device_code: this.deviceCode,
              grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            }),
          });

          const data = (await response.json()) as AccessTokenResponse;

          if (data.error) {
            switch (data.error) {
              case 'authorization_pending':
                onProgress?.({ status: 'pending', attempt: attempts, maxAttempts });
                return;
              case 'slow_down':
                onProgress?.({ status: 'slow_down' });
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

          if (data.access_token) {
            this.stopPolling();
            const userInfo = await this.getUserInfo(data.access_token);
            resolve({
              accessToken: data.access_token,
              tokenType: data.token_type || 'bearer',
              scope: data.scope || '',
              user: userInfo,
            });
          }
        } catch (error) {
          onProgress?.({ status: 'error', error: (error as Error).message });
        }
      }, this.interval);
    });
  }

  async getUserInfo(token: string): Promise<GitHubUser | null> {
    try {
      const response = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
      });
      if (!response.ok) return null;
      return (await response.json()) as GitHubUser;
    } catch {
      return null;
    }
  }

  stopPolling(): void {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
  }

  async authorize(callbacks: AuthCallbacks = {}): Promise<AuthResult> {
    try {
      callbacks.onDeviceCode?.({ status: 'requesting' });
      const deviceInfo = await this.requestDeviceCode();
      callbacks.onDeviceCode?.({ status: 'ready', ...deviceInfo });

      const result = await this.pollForAccessToken(callbacks.onProgress);
      callbacks.onSuccess?.(result);
      return result;
    } catch (error) {
      callbacks.onError?.(error as Error);
      throw error;
    }
  }

  static async validateToken(token: string): Promise<{ valid: boolean; user?: GitHubUser; error?: string }> {
    try {
      const response = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
      });
      if (response.ok) {
        return { valid: true, user: (await response.json()) as GitHubUser };
      }
      return { valid: false };
    } catch (error) {
      return { valid: false, error: (error as Error).message };
    }
  }

  static async revokeToken(): Promise<void> {
    await chrome.storage.local.remove(['githubToken', 'githubUser', 'tokenType']);
  }
}
