// GitHub REST API Client
// Handles all REST API calls to GitHub

class BetterGHub_GitHubRestAPI {
  constructor(token = null, tokenType = 'pat') {
    this.token = token;
    this.tokenType = tokenType;
    this.baseUrl = 'https://api.github.com';
  }

  setToken(token, tokenType = 'pat') {
    this.token = token;
    this.tokenType = tokenType;
  }

  async call(endpoint) {
    try {
      // Track API call with metrics
      BetterGHub_ApiMetrics.incrementCall('rest', endpoint);

      const headers = {
        'Accept': 'application/vnd.github.v3+json'
      };

      if (this.token) {
        headers['Authorization'] = this.tokenType === 'oauth' ? `Bearer ${this.token}` : `token ${this.token}`;
      }

      console.log(`Better GHub v${BetterGHub_Constants.VERSION}: REST API Call to ${endpoint}`);

      const response = await fetch(`${this.baseUrl}${endpoint}`, { headers });

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`Better GHub v${BetterGHub_Constants.VERSION}: API Error:`, error);
      return null;
    }
  }

  async getPRData(owner, repo, number) {
    const pr = await this.call(`/repos/${owner}/${repo}/pulls/${number}`);
    if (!pr) return null;

    const commits = await this.call(`/repos/${owner}/${repo}/pulls/${number}/commits?per_page=5`);

    return { pr, commits: commits || [] };
  }

  getApiCallCount() {
    return BetterGHub_ApiMetrics.getCount();
  }
}
