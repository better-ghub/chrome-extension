// Better GHub - Messaging contract between extension contexts.
//
// Content scripts, popup and options talk to the background service worker
// ONLY through these typed messages. The background owns the GitHub token and
// injects it into API calls itself; no other context ever sends it.

export interface RateLimitSnapshot {
  remaining: number | null;
  limit: number | null;
  /** Epoch seconds. */
  reset: number | null;
}

export interface GitHubAccount {
  login: string;
  name: string | null;
  avatarUrl: string;
  htmlUrl: string;
}

export type TokenKind = 'fine-grained' | 'classic' | 'unknown';

/**
 * Public description of one stored token — never the secret itself.
 *
 * Why several tokens: a fine-grained token can read the PRIVATE repositories of
 * exactly one owner (the user or one organization), plus every public
 * repository. People who work across organizations add one fine-grained token
 * per organization; the background picks the right one per repository.
 */
export interface TokenSummary {
  /** Stable random id. */
  id: string;
  kind: TokenKind;
  /** Last 4 characters, to tell tokens apart ("…a1b2"). */
  hint: string;
  /**
   * Lower-cased owners whose private repositories this token can read
   * (discovered when added + learned while browsing). `null` = classic/OAuth
   * token: every owner the account can access.
   */
  owners: string[] | null;
  /** Fine-grained token that currently sees no private repositories (public-only, or pending org approval). */
  publicOnly: boolean;
  /** ISO timestamp. */
  addedAt: string;
  /** ISO expiry when GitHub reports one (GitHub-Authentication-Token-Expiration header), else null. */
  expiresAt: string | null;
  /** 'invalid' = GitHub rejects it (revoked/expired); 'sso' = classic token needs SAML SSO authorization. */
  problem: 'invalid' | 'sso' | null;
  /** Authorization URL from the X-GitHub-SSO header when problem === 'sso'. */
  ssoUrl?: string | null;
}

export interface AuthStatus {
  authenticated: boolean;
  account?: GitHubAccount;
  /** Kind of the first (primary) token. Kept for older callers; prefer `tokens`. */
  tokenKind?: TokenKind;
  /** All stored tokens (same GitHub account), primary first. */
  tokens?: TokenSummary[];
  rateLimit?: RateLimitSnapshot;
  /**
   * Reason code when a request failed: 'invalid' (GitHub rejected the token),
   * 'format' (not a GitHub token), 'network' (GitHub unreachable/5xx — the
   * token may be fine), 'rate-limited', 'forbidden', 'duplicate' (this token is
   * already stored), 'different-account' (the token belongs to another GitHub
   * user than the tokens already stored), 'unknown'.
   */
  error?: string;
}

export type ChecksState = 'SUCCESS' | 'FAILURE' | 'PENDING' | 'ERROR' | 'EXPECTED' | null;
export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;

export interface InboxItem {
  /** https://github.com/owner/repo/pull/123 — stable identity. */
  url: string;
  repo: string; // "owner/name"
  number: number;
  title: string;
  author: string;
  authorAvatarUrl: string | null;
  isDraft: boolean;
  /** ISO timestamp. */
  updatedAt: string;
  /** Why it is in the inbox. A PR can be both. */
  reasons: ('authored' | 'review-requested' | 'assigned' | 'rereview')[];
  reviewDecision: ReviewDecision;
  checks: ChecksState;
  unresolvedThreads: number;
  additions: number;
  deletions: number;
  hasConflicts: boolean;
  /** When the user's review was requested (ISO), for review-requested items. */
  reviewRequestedAt?: string | null;
  /** Comments in the viewer's unsubmitted (pending) review of this PR; 0 = none. */
  pendingReviewComments?: number;
  /** 'rereview' items: committedDate (ISO) of the last commit, newer than the viewer's last review. */
  rereviewCommitAt?: string | null;
  /** Most recent activity by someone other than the viewer. */
  lastActivity?: { kind: 'commit' | 'comment' | 'review'; actor: string; at: string } | null;
  /** Updated since the user last looked at it (drives the badge). */
  unseen: boolean;
  /** Approved, checks green, no conflicts/unresolved threads, not a draft (src/core/readiness.ts). */
  ready?: boolean;
  /** No activity for settings.staleDays days. */
  stale?: boolean;
  /** ISO time until which the user snoozed it; hidden from the inbox and badge until then. */
  snoozedUntil?: string | null;
  /** Pinned to the top of the inbox by the user. */
  pinned?: boolean;
}

export interface Inbox {
  items: InboxItem[];
  unseenCount: number;
  /** Epoch ms of the last successful refresh (0 = never). */
  fetchedAt: number;
  needsAuth?: boolean;
  /**
   * Set when the last refresh failed ('rate-limited' | 'network' | 'invalid' |
   * 'error'); `items` then still hold the last good data.
   */
  error?: string;
}

export interface ApiResult<T> {
  ok: boolean;
  status?: number;
  data?: T;
  error?: string;
  /** true when GitHub rate limited the call (403/429 with exhausted budget). */
  rateLimited?: boolean;
  rateLimit?: RateLimitSnapshot;
  /**
   * Set when no stored token can read private data of this owner (every
   * candidate token was tried). UIs offer "Add a token for <owner>".
   */
  needsToken?: { owner: string };
  /** SAML SSO authorization URL when GitHub asked for it (classic tokens). */
  ssoUrl?: string;
}

/** Requests handled by the background worker, with their response types. */
export interface BackgroundRequests {
  /**
   * POST https://api.github.com/graphql. GraphQL `errors` come back in `error`
   * (ok: false) together with any partial `data`. Successful queries are cached
   * for settings.cacheDuration minutes unless `noCache` (mutations never are).
   */
  'api:graphql': {
    req: {
      query: string;
      variables?: Record<string, unknown>;
      noCache?: boolean;
      /** Repository owner the query is about — routes it to the token that covers that owner. */
      owner?: string;
    };
    res: ApiResult<unknown>;
  };
  /**
   * GET only; `path` must start with '/' and is resolved against
   * https://api.github.com. Cached like 'api:graphql'. The owner for token
   * routing is taken from `/repos/:owner/...` paths, or from `owner`.
   */
  'api:rest': { req: { path: string; noCache?: boolean; owner?: string }; res: ApiResult<unknown> };
  'i18n:load': { req: { language: string }; res: { ok: boolean; messages?: Record<string, { message: string }> } };
  'auth:status': { req: { refresh?: boolean }; res: AuthStatus };
  /**
   * Validates the token against GitHub and ADDS it to the stored tokens (the
   * first one connects the account). Rejects tokens of a different GitHub user
   * ('different-account') and tokens already stored ('duplicate'). Broadcasts
   * 'auth:changed'. Extension pages only.
   */
  'auth:setToken': { req: { token: string }; res: AuthStatus };
  /** Removes one stored token; removing the last one signs out. Extension pages only. */
  'auth:removeToken': { req: { id: string }; res: AuthStatus };
  /** Removes every token (sign out). Extension pages only. */
  'auth:logout': { req: Record<string, never>; res: { ok: boolean } };
  'inbox:get': { req: { force?: boolean }; res: Inbox };
  /** Marks the given PR urls (or all when omitted) as seen and updates the badge. */
  'inbox:markSeen': { req: { urls?: string[] }; res: { ok: boolean; unseenCount: number } };
  /**
   * Snooze a PR until `until` (ISO) — it leaves the inbox lists and the badge
   * until then, and comes back unseen if there was new activity. `until: null`
   * un-snoozes. Returns the fresh inbox.
   */
  'inbox:snooze': { req: { url: string; until: string | null }; res: Inbox };
  /** Pin / unpin a PR at the top of the inbox. Returns the fresh inbox. */
  'inbox:pin': { req: { url: string; pinned: boolean }; res: Inbox };
  'cache:clear': { req: Record<string, never>; res: { ok: boolean } };
  /**
   * Content scripts cannot open extension pages themselves. `section` becomes
   * the URL hash, e.g. 'shortcuts', 'account', or 'add-token/<owner>' (opens
   * Account with the "add a token for <owner>" form expanded and prefilled).
   */
  'ui:openOptions': { req: { section?: string }; res: { ok: boolean } };
}

export type BackgroundRequestType = keyof BackgroundRequests;

export type BackgroundMessage = {
  [K in BackgroundRequestType]: { type: K } & BackgroundRequests[K]['req'];
}[BackgroundRequestType];

/** Messages the background broadcasts to github.com tabs. */
export type TabBroadcast = { type: 'auth:changed'; authenticated: boolean } | { type: 'cache:cleared' };

/** True when the extension was reloaded/updated and this content script is orphaned. */
export function isContextInvalidated(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /Extension context invalidated|Receiving end does not exist|message port closed/i.test(msg);
}

export function extensionAlive(): boolean {
  try {
    return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

/**
 * Send a typed request to the background. Never throws: on a dead extension
 * context (after an extension reload) or any messaging error it resolves to
 * `fallback`.
 */
export async function sendToBackground<K extends BackgroundRequestType>(
  type: K,
  payload: BackgroundRequests[K]['req'],
  fallback: BackgroundRequests[K]['res']
): Promise<BackgroundRequests[K]['res']> {
  if (!extensionAlive()) return fallback;
  try {
    const res = (await chrome.runtime.sendMessage({ type, ...payload })) as BackgroundRequests[K]['res'] | undefined;
    return res ?? fallback;
  } catch (error) {
    if (!isContextInvalidated(error)) {
      console.warn(`Better GHub: background request "${type}" failed:`, error instanceof Error ? error.message : error);
    }
    return fallback;
  }
}
