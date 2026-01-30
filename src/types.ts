// All TypeScript types for Better GHub

// =============================================================================
// GitHub API Types
// =============================================================================

export interface GitHubUser {
  login: string;
  id: number;
  name?: string;
  avatar_url: string;
  html_url: string;
}

export interface GitHubCommitAuthor {
  name: string;
  email: string;
  date: string;
}

export interface GitHubCommitData {
  message: string;
  committer: GitHubCommitAuthor;
  author: GitHubCommitAuthor;
}

export interface GitHubCommit {
  sha: string;
  commit: GitHubCommitData;
  author: GitHubUser | null;
  committer: GitHubUser | null;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  state: 'open' | 'closed';
  user: GitHubUser;
  html_url: string;
  updated_at: string;
  created_at: string;
  merged_at: string | null;
  draft: boolean;
  additions: number;
  deletions: number;
  changed_files: number;
}

export interface GitHubPRData {
  pr: GitHubPullRequest;
  commits: GitHubCommit[];
}

// =============================================================================
// GraphQL Types
// =============================================================================

export interface GraphQLThreadComment {
  author: { login: string } | null;
}

export interface GraphQLReviewThread {
  isResolved: boolean;
  isOutdated: boolean;
  comments: { nodes: GraphQLThreadComment[] };
}

export interface GraphQLPullRequest {
  reviewThreads: { nodes: GraphQLReviewThread[] };
}

export interface GraphQLRepository {
  pullRequest: GraphQLPullRequest | null;
}

export interface GraphQLResponse {
  repository?: GraphQLRepository;
  [key: string]: GraphQLRepository | undefined;
}

export interface UnresolvedThreadsResult {
  count: number;
  byAuthor: Record<string, number>;
}

// =============================================================================
// Token Types
// =============================================================================

export interface TokenInfo {
  token: string;
}

// =============================================================================
// PR Analysis Types
// =============================================================================

export type ActivityType = 'commit' | 'comment';

export interface PRInfo {
  owner: string;
  repo: string;
  number: number;
}

export interface PRActivityData {
  hasActivity: boolean;
  lastActivityType: ActivityType | null;
  lastActivityAuthor: string | null;
  lastActivityTitle: string | null;
  lastActivityTime: Date | null;
  unresolvedCount: number;
  unresolvedByAuthor: Record<string, number>;
}

export interface PRDisplayData {
  icon: string;
  text: string;
  isRecent: boolean;
  hasUnresolved: boolean;
  unresolvedCount: number;
  unresolvedByAuthor: Record<string, number>;
}

export interface PRFullData {
  pr: GitHubPullRequest;
  commits: GitHubCommit[];
  unresolvedCount: number;
  unresolvedByAuthor: Record<string, number>;
}

export interface CachedData<T> {
  data: T;
  timestamp: number;
}

export interface PRBatchItem {
  owner: string;
  repo: string;
  number: number;
}
