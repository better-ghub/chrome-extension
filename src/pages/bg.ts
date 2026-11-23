// Better GHub - Background requests for the extension pages.
//
// Thin layer over sendToBackground() that adds a timeout (a stuck worker must
// never leave a spinner forever) and defensive normalisation of responses, so
// the UI only ever renders well-formed data.

import {
  sendToBackground,
  type AuthStatus,
  type BackgroundRequests,
  type BackgroundRequestType,
  type ChecksState,
  type GitHubAccount,
  type Inbox,
  type InboxItem,
  type RateLimitSnapshot,
  type ReviewDecision,
  type TokenKind,
  type TokenSummary,
} from '../core/messages';
import { ERROR_TIMEOUT, ERROR_UNAVAILABLE } from './token';

export const TIMEOUT = {
  /** Cached reads (auth status, settings-like calls). */
  quick: 10_000,
  /** Token validation hits GitHub. */
  setToken: 25_000,
  /** A forced inbox refresh may fan out into several API calls. */
  inbox: 30_000,
} as const;

type Res<K extends BackgroundRequestType> = BackgroundRequests[K]['res'];

/**
 * sendToBackground with a timeout. Resolves to `fallback` when the worker is
 * unavailable and to `onTimeout` (default: `fallback`) when it doesn't answer
 * within `ms`. Never throws.
 */
export function request<K extends BackgroundRequestType>(
  type: K,
  payload: BackgroundRequests[K]['req'],
  fallback: Res<K>,
  ms: number = TIMEOUT.quick,
  onTimeout: Res<K> = fallback
): Promise<Res<K>> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(onTimeout);
    }, ms);
    sendToBackground(type, payload, fallback).then(
      (res) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(res);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

// ------------------------------------------------------------------ fallbacks

export const AUTH_UNAVAILABLE: AuthStatus = Object.freeze({ authenticated: false, error: ERROR_UNAVAILABLE });
export const AUTH_TIMEOUT: AuthStatus = Object.freeze({ authenticated: false, error: ERROR_TIMEOUT });

export function inboxFallback(error: string): Inbox {
  return { items: [], unseenCount: 0, fetchedAt: 0, error };
}

// -------------------------------------------------------------- normalisers

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function str(v: unknown, def = ''): string {
  return typeof v === 'string' ? v : def;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function isHttpsUrl(v: unknown, host?: string): v is string {
  if (typeof v !== 'string') return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && (!host || u.hostname === host);
  } catch {
    return false;
  }
}

const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const PR_PATH_RE = /^\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)\/?$/;

/** Canonical https://github.com/o/r/pull/N for a PR URL, or null for anything else. */
export function canonicalPrUrl(v: unknown): { url: string; owner: string; name: string; number: number } | null {
  if (!isHttpsUrl(v, 'github.com')) return null;
  const m = PR_PATH_RE.exec(new URL(v).pathname);
  if (!m) return null;
  return { url: `https://github.com/${m[1]}/${m[2]}/pull/${m[3]}`, owner: m[1], name: m[2], number: Number(m[3]) };
}

function normalizeAccount(raw: unknown): GitHubAccount | undefined {
  if (!isObject(raw)) return undefined;
  const login = str(raw.login);
  if (!LOGIN_RE.test(login)) return undefined;
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : null;
  return {
    login,
    name,
    avatarUrl: isHttpsUrl(raw.avatarUrl) ? raw.avatarUrl : '',
    htmlUrl: isHttpsUrl(raw.htmlUrl, 'github.com') ? raw.htmlUrl : `https://github.com/${login}`,
  };
}

function normalizeRateLimit(raw: unknown): RateLimitSnapshot | undefined {
  if (!isObject(raw)) return undefined;
  return { remaining: num(raw.remaining), limit: num(raw.limit), reset: num(raw.reset) };
}

const TOKEN_KINDS: readonly TokenKind[] = ['fine-grained', 'classic', 'unknown'];

/** One stored token's public summary, or null when unusable (no id). */
export function normalizeTokenSummary(raw: unknown): TokenSummary | null {
  if (!isObject(raw)) return null;
  const id = str(raw.id).trim();
  if (!id) return null;
  const kind = TOKEN_KINDS.includes(raw.kind as TokenKind) ? (raw.kind as TokenKind) : 'unknown';
  let owners: string[] | null;
  if (raw.owners === null || (raw.owners === undefined && kind === 'classic')) {
    owners = null;
  } else {
    owners = [];
    for (const o of Array.isArray(raw.owners) ? raw.owners : []) {
      if (typeof o === 'string' && LOGIN_RE.test(o) && !owners.includes(o)) owners.push(o);
    }
  }
  // The hint may arrive as "a1b2" or "…a1b2": keep only the characters.
  const hint = str(raw.hint).replace(/^(?:…|\.{1,3})/, '');
  const problem = raw.problem === 'invalid' || raw.problem === 'sso' ? raw.problem : null;
  return {
    id,
    kind,
    hint: /^[A-Za-z0-9_]{1,8}$/.test(hint) ? hint : '',
    owners,
    publicOnly: raw.publicOnly === true,
    addedAt: isoOrNull(raw.addedAt) ?? '',
    expiresAt: isoOrNull(raw.expiresAt),
    problem,
    ssoUrl: isHttpsUrl(raw.ssoUrl, 'github.com') ? raw.ssoUrl : null,
  };
}

export function normalizeAuthStatus(raw: unknown): AuthStatus {
  if (!isObject(raw)) return { ...AUTH_UNAVAILABLE };
  const account = normalizeAccount(raw.account);
  const authenticated = raw.authenticated === true && !!account;
  const kind = raw.tokenKind;
  const out: AuthStatus = { authenticated };
  if (account) out.account = account;
  if (kind === 'fine-grained' || kind === 'classic' || kind === 'unknown') out.tokenKind = kind;
  if (Array.isArray(raw.tokens)) {
    const tokens: TokenSummary[] = [];
    for (const entry of raw.tokens) {
      const token = normalizeTokenSummary(entry);
      if (token && !tokens.some((x) => x.id === token.id)) tokens.push(token);
    }
    out.tokens = tokens;
  }
  const rl = normalizeRateLimit(raw.rateLimit);
  if (rl) out.rateLimit = rl;
  if (typeof raw.error === 'string' && raw.error) out.error = raw.error;
  else if (raw.authenticated === true && !account) out.error = 'Invalid account data';
  return out;
}

const CHECKS: readonly ChecksState[] = ['SUCCESS', 'FAILURE', 'PENDING', 'ERROR', 'EXPECTED'];
const DECISIONS: readonly ReviewDecision[] = ['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED'];
const REASONS: readonly InboxItem['reasons'][number][] = ['authored', 'review-requested', 'assigned'];

function isoOrNull(v: unknown): string | null {
  return typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null;
}

/** One inbox item, or null when it can't be rendered/opened safely. */
export function normalizeInboxItem(raw: unknown): InboxItem | null {
  if (!isObject(raw)) return null;
  const pr = canonicalPrUrl(raw.url);
  if (!pr) return null;
  const { url, owner, name } = pr;
  const number = num(raw.number) ?? pr.number;
  const reasons = Array.isArray(raw.reasons) ? REASONS.filter((r) => (raw.reasons as unknown[]).includes(r)) : [];
  const activity = isObject(raw.lastActivity) ? raw.lastActivity : null;
  const activityAt = activity ? isoOrNull(activity.at) : null;
  const kind = activity?.kind;
  return {
    url,
    repo: str(raw.repo) || `${owner}/${name}`,
    number,
    title: str(raw.title).trim() || `#${number}`,
    author: str(raw.author),
    authorAvatarUrl: isHttpsUrl(raw.authorAvatarUrl) ? raw.authorAvatarUrl : null,
    isDraft: raw.isDraft === true,
    updatedAt: isoOrNull(raw.updatedAt) ?? new Date(0).toISOString(),
    reasons: reasons.length ? reasons : ['authored'],
    reviewDecision: DECISIONS.includes(raw.reviewDecision as ReviewDecision) ? (raw.reviewDecision as ReviewDecision) : null,
    checks: CHECKS.includes(raw.checks as ChecksState) ? (raw.checks as ChecksState) : null,
    unresolvedThreads: Math.max(0, num(raw.unresolvedThreads) ?? 0),
    additions: Math.max(0, num(raw.additions) ?? 0),
    deletions: Math.max(0, num(raw.deletions) ?? 0),
    hasConflicts: raw.hasConflicts === true,
    reviewRequestedAt: isoOrNull(raw.reviewRequestedAt),
    lastActivity:
      activity && activityAt && (kind === 'commit' || kind === 'comment' || kind === 'review')
        ? { kind, actor: str(activity.actor), at: activityAt }
        : null,
    unseen: raw.unseen === true,
    ready: raw.ready === true,
    stale: raw.stale === true,
    snoozedUntil: isoOrNull(raw.snoozedUntil),
    pinned: raw.pinned === true,
  };
}

export function normalizeInbox(raw: unknown): Inbox {
  if (!isObject(raw)) return inboxFallback(ERROR_UNAVAILABLE);
  const seen = new Set<string>();
  const items: InboxItem[] = [];
  for (const entry of Array.isArray(raw.items) ? raw.items : []) {
    const item = normalizeInboxItem(entry);
    if (!item || seen.has(item.url)) continue;
    seen.add(item.url);
    items.push(item);
  }
  const out: Inbox = {
    items,
    unseenCount: num(raw.unseenCount) ?? items.filter((i) => i.unseen).length,
    fetchedAt: num(raw.fetchedAt) ?? 0,
  };
  if (raw.needsAuth === true) out.needsAuth = true;
  if (typeof raw.error === 'string' && raw.error) out.error = raw.error;
  return out;
}
