// Better GHub - Background access to the token, account and settings.

import type { GitHubAccount } from '../core/messages';
import { getSettings, USER_KEY, type Settings } from '../core/settings';
import { usableTokens } from './token-model';
import { listTokens } from './tokens';

let settingsMemo: Promise<Settings> | null = null;

/** Settings, memoized until chrome.storage changes (see invalidateSettings). */
export function bgSettings(): Promise<Settings> {
  settingsMemo ??= getSettings();
  return settingsMemo;
}

export function invalidateSettings(): void {
  settingsMemo = null;
}

// --- auth generation -----------------------------------------------------------
//
// Bumped AFTER every credential change (token added/removed, dropCredentials). Work that
// captured the generation before reading the token (API calls, inbox fetches,
// account checks) skips its writes when the generation moved meanwhile, so a
// response for the old token never lands in the cache, the inbox, USER_KEY or
// the badge after a logout / account switch.

let generation = 0;

export function authGeneration(): number {
  return generation;
}

export function bumpAuthGeneration(): number {
  return ++generation;
}

// --- token ---------------------------------------------------------------------
//
// Several tokens may be stored (see tokens.ts); callers that need "the" token
// get the primary usable one. API requests route per owner instead (api.ts).

/** The primary token GitHub has not rejected, or '' when signed out. */
export async function getToken(): Promise<string> {
  try {
    return usableTokens(await listTokens())[0]?.token ?? '';
  } catch {
    return '';
  }
}

export async function getAccount(): Promise<GitHubAccount | undefined> {
  try {
    const items = await chrome.storage.local.get(USER_KEY);
    // <= 0.3 stored the raw REST user (avatar_url / html_url); accept both shapes.
    const acc = items[USER_KEY] as (Partial<GitHubAccount> & { avatar_url?: unknown; html_url?: unknown }) | undefined;
    if (!acc || typeof acc.login !== 'string') return undefined;
    const str = (...vals: unknown[]): string | undefined => vals.find((v): v is string => typeof v === 'string');
    return {
      login: acc.login,
      name: typeof acc.name === 'string' ? acc.name : null,
      avatarUrl: str(acc.avatarUrl, acc.avatar_url) ?? '',
      htmlUrl: str(acc.htmlUrl, acc.html_url) ?? `https://github.com/${acc.login}`,
    };
  } catch {
    return undefined;
  }
}
