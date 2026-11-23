// Better GHub - API response cache in chrome.storage.session.
//
// storage.session survives service-worker restarts (the SW is killed after
// ~30s idle) but is wiped when the browser restarts, and content scripts
// cannot read it (default access level is trusted contexts only).

import type { ApiResult } from '../core/messages';
import { hashString, stableStringify } from './request-utils';

const PREFIX = 'bghub:rc:';

interface Entry {
  at: number;
  res: ApiResult<unknown>;
}

/**
 * `tokenId`: the token that produced the response. Tokens of one account see
 * different data (a fine-grained token sees one owner's private repositories),
 * so a response is only served again for the same token.
 */
export function cacheKey(kind: 'graphql' | 'rest', target: string, variables?: unknown, tokenId = ''): string {
  const raw = `${tokenId}\n${kind}\n${target}\n${stableStringify(variables ?? null)}`;
  // Two seeds → ~106 bits; collisions are not a practical concern.
  return PREFIX + hashString(raw, 1) + hashString(raw, 2);
}

export async function cacheGet(key: string, ttlMs: number): Promise<ApiResult<unknown> | null> {
  if (ttlMs <= 0) return null;
  try {
    const items = await chrome.storage.session.get(key);
    const entry = items[key] as Entry | undefined;
    if (!entry || typeof entry.at !== 'number') return null;
    if (Date.now() - entry.at > ttlMs) {
      void chrome.storage.session.remove(key).catch(() => undefined);
      return null;
    }
    return entry.res;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, res: ApiResult<unknown>, ttlMs: number): Promise<void> {
  if (ttlMs <= 0 || !res.ok) return;
  const entry: Entry = { at: Date.now(), res };
  try {
    await chrome.storage.session.set({ [key]: entry });
  } catch {
    // Quota (10 MB) exceeded: drop expired entries, then everything, and retry once.
    await pruneCache(ttlMs);
    try {
      await chrome.storage.session.set({ [key]: entry });
    } catch {
      await clearCache();
    }
  }
}

async function cacheKeys(): Promise<string[]> {
  const all = await chrome.storage.session.get(null);
  return Object.keys(all).filter((k) => k.startsWith(PREFIX));
}

export async function pruneCache(ttlMs: number): Promise<void> {
  try {
    const all = await chrome.storage.session.get(null);
    const now = Date.now();
    const stale = Object.entries(all)
      .filter(([k, v]) => k.startsWith(PREFIX) && now - ((v as Entry | undefined)?.at ?? 0) > ttlMs)
      .map(([k]) => k);
    if (stale.length) await chrome.storage.session.remove(stale);
  } catch {
    /* best effort */
  }
}

export async function clearCache(): Promise<void> {
  try {
    const keys = await cacheKeys();
    if (keys.length) await chrome.storage.session.remove(keys);
  } catch {
    /* best effort */
  }
}
