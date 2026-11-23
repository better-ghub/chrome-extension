// Better GHub - Token validation against GET /user, owner discovery, sign-out.
// A token is marked invalid ONLY on a real 401 from /user; 403s, rate limits,
// 5xx and network errors keep it (they say nothing about the credential).
// Everything is dropped only when the LAST usable token turns out invalid.

import type { ApiResult, GitHubAccount } from '../core/messages';
import { USER_KEY } from '../core/settings';
import { broadcast } from './broadcast';
import { clearCache } from './cache';
import { githubRequest, resetRateLimits } from './http';
import { clearInbox } from './inbox';
import { authGeneration, bumpAuthGeneration, getAccount } from './store';
import { ownersFromRepos, parseTokenExpiration, usableTokens, type StoredToken } from './token-model';
import { clearTokens, listTokens, updateToken } from './tokens';

interface RestUser {
  login?: string;
  name?: string | null;
  avatar_url?: string;
  html_url?: string;
}

export interface AccountCheck {
  res: ApiResult<unknown>;
  account?: GitHubAccount;
  /** From the GitHub-Authentication-Token-Expiration header; null = none reported. */
  expiresAt: string | null;
}

export const sameLogin = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** GET /user. `candidate`: the token is not stored yet (see GitHubRequest.candidate). */
export async function fetchAccount(token: string, candidate = false): Promise<AccountCheck> {
  const seen = { expiresAt: null as string | null };
  const res = await githubRequest<RestUser>({
    method: 'GET',
    path: '/user',
    token,
    resource: 'core',
    candidate,
    onHeaders: (h) => {
      seen.expiresAt = parseTokenExpiration(h.get('github-authentication-token-expiration'));
    },
  });
  const u = res.data;
  if (!res.ok || !u || typeof u.login !== 'string') return { res, expiresAt: seen.expiresAt };
  return {
    res,
    expiresAt: seen.expiresAt,
    account: {
      login: u.login,
      name: u.name ?? null,
      avatarUrl: u.avatar_url ?? '',
      htmlUrl: u.html_url ?? `https://github.com/${u.login}`,
    },
  };
}

/**
 * Owners whose PRIVATE repositories a fine-grained token reads (usually
 * exactly one); none → public-only (or the org has not approved it yet).
 * Null when GitHub could not be asked.
 */
export async function discoverOwners(token: string, candidate = false): Promise<{ owners: string[]; publicOnly: boolean } | null> {
  const res = await githubRequest({
    method: 'GET',
    path: '/user/repos?visibility=private&per_page=100&sort=pushed',
    token,
    resource: 'core',
    candidate,
  });
  if (!res.ok) return null;
  const owners = ownersFromRepos(res.data);
  return { owners, publicOnly: owners.length === 0 };
}

/** Forget every token and everything derived from them, then tell every context. */
export async function dropCredentials(): Promise<void> {
  await clearTokens();
  // After the tokens are gone: in-flight work for them now skips its writes.
  bumpAuthGeneration();
  await chrome.storage.local.remove(USER_KEY);
  await clearInbox(); // serialized with inbox writes; clears the badge
  await clearCache();
  await resetRateLimits();
  await broadcast({ type: 'auth:changed', authenticated: false });
}

/** Sign out when tokens are stored but GitHub rejects every one of them. */
async function dropIfNoneUsable(): Promise<void> {
  const tokens = await listTokens();
  if (tokens.length && !usableTokens(tokens).length) await dropCredentials();
}

/**
 * Check one stored token: refresh expiry, set/clear 'invalid', and run owner
 * discovery for tokens migrated from the single-token version. A token that
 * now answers for another login than the account's is unusable ('invalid').
 */
async function checkToken(t: StoredToken, login: string | undefined): Promise<AccountCheck> {
  const check = await fetchAccount(t.token);
  const { res, account, expiresAt } = check;
  if (account) {
    if (login && !sameLogin(account.login, login)) {
      await updateToken(t.id, { problem: 'invalid' });
      return { res, expiresAt };
    }
    await updateToken(t.id, (cur) => ({ expiresAt, problem: cur.problem === 'invalid' ? null : cur.problem }));
    if (t.pending) {
      const found = t.kind === 'fine-grained' ? await discoverOwners(t.token) : null;
      if (found || t.kind !== 'fine-grained') {
        await updateToken(t.id, (cur) => {
          if (!found || cur.owners === null) return { pending: undefined };
          const owners = [...new Set([...cur.owners, ...found.owners])];
          return { owners, publicOnly: owners.length === 0, pending: undefined };
        });
      }
    }
  } else if (res.status === 401) {
    await updateToken(t.id, { problem: 'invalid' });
  }
  return check;
}

/**
 * Validate every stored token ('auth:validate' alarm, 'auth:status' refresh).
 * Refreshes the account from the primary token. Returns the primary token's
 * check (for error reporting), undefined without tokens.
 */
export async function validateStoredTokens(): Promise<AccountCheck | undefined> {
  const gen = authGeneration();
  const tokens = await listTokens();
  if (!tokens.length) return undefined;
  let stored = await getAccount();
  let primary: AccountCheck | undefined;
  for (const t of tokens) {
    const check = await checkToken(t, stored?.login);
    primary ??= check;
    // Logged out / tokens changed meanwhile: never write the old account back.
    if (gen !== authGeneration()) return primary;
    if (check.account && (!stored || (t === tokens[0] && sameLogin(stored.login, check.account.login)))) {
      stored = check.account;
      await chrome.storage.local.set({ [USER_KEY]: check.account });
    }
  }
  await dropIfNoneUsable();
  return primary;
}

/** Validate one token (after a 401 from the API). */
export async function validateToken(id: string): Promise<void> {
  const gen = authGeneration();
  const t = (await listTokens()).find((x) => x.id === id);
  if (!t) return;
  await checkToken(t, (await getAccount())?.login);
  if (gen === authGeneration()) await dropIfNoneUsable();
}

const lastCheck = new Map<string, number>();

/** An API call with token `id` got a 401: confirm with /user (at most once a minute per token). */
export function scheduleTokenCheck(id: string): void {
  const now = Date.now();
  if (now - (lastCheck.get(id) ?? 0) < 60_000) return;
  lastCheck.set(id, now);
  void validateToken(id).catch(() => undefined);
}
