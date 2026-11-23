// Better GHub - 'auth:*' requests.
//
// Several tokens can be stored for ONE GitHub account (one fine-grained token
// per organization, see token-model.ts). AuthStatus.error codes: 'invalid'
// (GitHub rejected the token, 401), 'format' (not a GitHub token), 'network'
// (GitHub unreachable or 5xx — the token may be fine), 'rate-limited',
// 'forbidden' (request not allowed from this context), 'duplicate',
// 'different-account', 'unknown'. Failed add/remove requests return the
// CURRENT status plus `error` (so `authenticated` may still be true).

import type { ApiResult, AuthStatus } from '../core/messages';
import { USER_KEY } from '../core/settings';
import { discoverOwners, dropCredentials, fetchAccount, sameLogin, validateStoredTokens } from './auth-check';
import { broadcast } from './broadcast';
import { clearCache } from './cache';
import { rateLimitSnapshot, recordRateLimit, resetRateLimits } from './http';
import { clearInbox, refreshInbox } from './inbox';
import { isTokenFormatValid } from './request-utils';
import { bumpAuthGeneration, getAccount } from './store';
import { initialMeta, toSummary, usableTokens } from './token-model';
import { addToken, listTokens, removeToken } from './tokens';
import { syncAlarms } from './alarms';

function failureCode(res: ApiResult<unknown>): string {
  if (res.rateLimited) return 'rate-limited';
  if (res.status === 401) return 'invalid';
  if (!res.status || res.status >= 500) return 'network';
  return 'unknown';
}

/** Status from stored state only (no network). */
async function currentStatus(): Promise<AuthStatus> {
  const tokens = await listTokens();
  if (!tokens.length) return { authenticated: false };
  const account = await getAccount();
  return {
    authenticated: !!account && usableTokens(tokens).length > 0,
    ...(account ? { account } : {}),
    tokenKind: tokens[0].kind,
    tokens: tokens.map(toSummary),
    rateLimit: rateLimitSnapshot('core'),
  };
}

// Adds and removals are serialized: two concurrent first adds must not
// connect two different accounts.
let authQueue: Promise<unknown> = Promise.resolve();
function withAuthLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = authQueue.then(fn, fn);
  authQueue = run.catch(() => undefined);
  return run;
}

export async function authStatus(refresh = false): Promise<AuthStatus> {
  const tokens = await listTokens();
  if (!usableTokens(tokens).length) return currentStatus();
  // Validate on request, without a known account, or while a migrated token
  // still waits for owner discovery (one-time).
  if (refresh || !(await getAccount()) || tokens.some((t) => t.pending)) {
    const primary = await validateStoredTokens();
    const status = await currentStatus();
    if (!status.authenticated && status.tokens?.length && primary && !primary.account) {
      return { ...status, error: failureCode(primary.res) };
    }
    return status;
  }
  return currentStatus();
}

/** 'auth:setToken': validate a token and ADD it to the stored ones. */
export function setToken(raw: unknown): Promise<AuthStatus> {
  return withAuthLock(async () => {
    const token = typeof raw === 'string' ? raw.trim() : '';
    if (!isTokenFormatValid(token)) return { ...(await currentStatus()), error: 'format' };
    const existing = await listTokens();
    if (existing.some((t) => t.token === token)) return { ...(await currentStatus()), error: 'duplicate' };

    // Candidate validation: a rate-limit block on the stored token's budget
    // must not stop the user from entering a new token.
    const { res, account, expiresAt } = await fetchAccount(token, true);
    if (!account) return { ...(await currentStatus()), error: failureCode(res) };
    const previous = await getAccount();
    const first = existing.length === 0;
    if (!first && previous && !sameLogin(previous.login, account.login)) {
      return { ...(await currentStatus()), error: 'different-account' };
    }

    const meta = { ...initialMeta(token, new Date().toISOString()), expiresAt };
    if (meta.kind === 'fine-grained') {
      const found = await discoverOwners(token, true);
      if (found) Object.assign(meta, found);
      else meta.pending = true; // discover at the next validation
    }
    if (!(await addToken(token, meta))) return { ...(await currentStatus()), error: 'duplicate' };
    // After the token is stored: in-flight work started before skips its
    // writes, and the running inbox refresh is restarted to include it.
    bumpAuthGeneration();
    await resetRateLimits();
    recordRateLimit('core', res.rateLimit);
    if (first) {
      if (previous && !sameLogin(previous.login, account.login)) await clearInbox(); // another user's inbox
      await clearCache(); // never serve another account's cached responses
    }
    await chrome.storage.local.set({ [USER_KEY]: account });
    await broadcast({ type: 'auth:changed', authenticated: true });
    void syncAlarms();
    void refreshInbox(true).catch(() => undefined);
    return currentStatus();
  });
}

/** 'auth:removeToken': remove one token; removing the last usable one signs out. */
export function removeStoredToken(id: unknown): Promise<AuthStatus> {
  return withAuthLock(async () => {
    if (typeof id !== 'string' || !(await removeToken(id))) return { ...(await currentStatus()), error: 'unknown' };
    if (!usableTokens(await listTokens()).length) {
      await dropCredentials();
      return currentStatus();
    }
    bumpAuthGeneration();
    await broadcast({ type: 'auth:changed', authenticated: true });
    // The inbox may hold PRs only the removed token could see.
    void refreshInbox(true).catch(() => undefined);
    return currentStatus();
  });
}

export async function logout(): Promise<{ ok: boolean }> {
  await dropCredentials();
  return { ok: true };
}
