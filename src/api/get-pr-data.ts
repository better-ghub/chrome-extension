// GET /repos/:owner/:repo/pulls/:number - Get PR data with commits

import { restCall } from './client';
import type { GitHubPullRequest, GitHubCommit, GitHubPRData } from '../types';

export async function getPRData(owner: string, repo: string, number: number): Promise<GitHubPRData | null> {
  const pr = await restCall<GitHubPullRequest>(`/repos/${owner}/${repo}/pulls/${number}`);
  if (!pr) return null;

  const commits = await restCall<GitHubCommit[]>(`/repos/${owner}/${repo}/pulls/${number}/commits?per_page=5`);
  return { pr, commits: commits || [] };
}
