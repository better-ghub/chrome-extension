// API Module - GitHub REST & GraphQL

// Client & utilities
export { setToken, getToken, restCall, graphqlCall, getApiCallCount } from './client';
export { apiMetrics } from './metrics';

// REST requests
export { getCurrentUser } from './get-current-user';
export { getPRData } from './get-pr-data';
export { searchIssues } from './search-issues';
export type { SearchIssuesResponse } from './search-issues';

// GraphQL requests
export { getUnresolvedThreads, getUnresolvedThreadsBatch } from './get-unresolved-threads';

// =============================================================================
// Class-based API (backward compatibility)
// =============================================================================

import type { GitHubPRData, GitHubUser, UnresolvedThreadsResult, PRBatchItem } from '../types';
import * as client from './client';
import * as prData from './get-pr-data';
import * as user from './get-current-user';
import * as search from './search-issues';
import * as threads from './get-unresolved-threads';

export class GitHubRestAPI {
  constructor(token: string | null = null) {
    client.setToken(token);
  }

  setToken(token: string | null): void {
    client.setToken(token);
  }

  async getPRData(owner: string, repo: string, number: number): Promise<GitHubPRData | null> {
    return prData.getPRData(owner, repo, number);
  }

  async getCurrentUser(): Promise<GitHubUser | null> {
    return user.getCurrentUser();
  }

  async searchIssues(query: string, perPage = 10): Promise<search.SearchIssuesResponse> {
    return search.searchIssues(query, perPage);
  }

  getApiCallCount(): number {
    return client.getApiCallCount();
  }
}

export class GitHubGraphQLAPI {
  constructor(token: string | null = null) {
    client.setToken(token);
  }

  setToken(token: string | null): void {
    client.setToken(token);
  }

  async getUnresolvedThreads(owner: string, repo: string, number: number): Promise<UnresolvedThreadsResult> {
    return threads.getUnresolvedThreads(owner, repo, number);
  }

  async getUnresolvedThreadsBatch(prList: PRBatchItem[]): Promise<Record<string, UnresolvedThreadsResult>> {
    return threads.getUnresolvedThreadsBatch(prList);
  }
}
