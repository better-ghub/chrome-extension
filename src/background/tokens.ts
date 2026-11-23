// Better GHub - Stored tokens (several per GitHub account).
//
// Secrets: [{id, token}] as JSON in the background-only secret store
// (IndexedDB, see secret-store.ts), primary first. Non-secret metadata
// (kind, hint, owners, problem, expiry...) lives in chrome.storage.local under
// TOKEN_META_KEY so it survives without touching the secret store.
//
// The background is the only writer; the list is kept in memory and every
// mutation runs through one promise queue.

import { TOKEN_KEY } from '../core/settings';
import { deleteSecret, getSecret, setSecret } from './secret-store';
import { initialMeta, metaOf, normalizeMeta, type StoredToken, type TokenMeta } from './token-model';

const SECRET_KEY = 'githubTokens';
export const TOKEN_META_KEY = 'tokenMeta';

let memo: Promise<StoredToken[]> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

export function newTokenId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join('');
}

function parseSecrets(raw: string | undefined): { id: string; token: string }[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list.filter(
      (e): e is { id: string; token: string } => !!e && typeof e.id === 'string' && typeof e.token === 'string' && !!e.token
    );
  } catch {
    return [];
  }
}

async function persist(list: StoredToken[], secrets: boolean): Promise<void> {
  if (secrets) {
    if (list.length) await setSecret(SECRET_KEY, JSON.stringify(list.map(({ id, token }) => ({ id, token }))));
    else await deleteSecret(SECRET_KEY);
  }
  if (list.length) await chrome.storage.local.set({ [TOKEN_META_KEY]: Object.fromEntries(list.map((t) => [t.id, metaOf(t)])) });
  else await chrome.storage.local.remove(TOKEN_META_KEY);
  memo = Promise.resolve(list);
}

/**
 * Read the stored list, migrating older layouts once:
 * - <= 0.3 / early 0.4: the token in chrome.storage.local (readable by content scripts);
 * - single-token builds: one secret under TOKEN_KEY.
 * Either becomes tokens[0] with `pending` owner discovery (run at the next validation).
 */
async function load(): Promise<StoredToken[]> {
  const items = await chrome.storage.local.get([TOKEN_KEY, TOKEN_META_KEY]);
  const metaMap = (items[TOKEN_META_KEY] ?? {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  let list: StoredToken[] = parseSecrets(await getSecret(SECRET_KEY)).map((e) => ({ ...normalizeMeta(metaMap[e.id], e.token, now), ...e }));

  const single = await getSecret(TOKEN_KEY);
  const local = items[TOKEN_KEY];
  const legacy = [single, local].find((v): v is string => typeof v === 'string' && !!v);
  if (legacy && !list.length) {
    list = [{ ...initialMeta(legacy, now), pending: true, id: newTokenId(), token: legacy }];
    await persist(list, true);
  }
  // Only after the list is safely stored: drop the old copies.
  if (single !== undefined) await deleteSecret(TOKEN_KEY);
  if (TOKEN_KEY in items) await chrome.storage.local.remove(TOKEN_KEY);
  return list;
}

/** All stored tokens, primary first. Treat the result as read-only. */
export function listTokens(): Promise<StoredToken[]> {
  if (!memo) {
    const p = load();
    memo = p;
    p.catch(() => {
      if (memo === p) memo = null; // retry on the next read
    });
  }
  return memo;
}

/** Load (and migrate) early, e.g. on install/startup. Never rejects. */
export async function migrateTokens(): Promise<void> {
  await listTokens().catch(() => undefined);
}

/** Append a token; null when the exact token is already stored. */
export function addToken(token: string, meta: TokenMeta): Promise<StoredToken | null> {
  return withLock(async () => {
    const list = await listTokens();
    if (list.some((t) => t.token === token)) return null;
    const entry: StoredToken = { ...meta, id: newTokenId(), token };
    await persist([...list, entry], true);
    return entry;
  });
}

/** Remove one token; false when the id is unknown. */
export function removeToken(id: string): Promise<boolean> {
  return withLock(async () => {
    const list = await listTokens();
    if (!list.some((t) => t.id === id)) return false;
    await persist(
      list.filter((t) => t.id !== id),
      true
    );
    return true;
  });
}

export function clearTokens(): Promise<void> {
  return withLock(async () => {
    await listTokens().catch(() => []);
    await persist([], true);
    // Never leave a legacy copy behind (a failed migration would resurrect it).
    await deleteSecret(TOKEN_KEY).catch(() => undefined);
    await chrome.storage.local.remove(TOKEN_KEY).catch(() => undefined);
  });
}

/**
 * Update one token's metadata. `patch` may be a function of the current entry
 * (evaluated inside the lock, so concurrent updates compose); returning null
 * leaves the entry unchanged. No-op for unknown ids (removed meanwhile).
 */
export function updateToken(id: string, patch: Partial<TokenMeta> | ((t: StoredToken) => Partial<TokenMeta> | null)): Promise<void> {
  return withLock(async () => {
    const list = await listTokens();
    const current = list.find((t) => t.id === id);
    if (!current) return;
    const p = typeof patch === 'function' ? patch(current) : patch;
    if (!p) return;
    await persist(
      list.map((t) => (t.id === id ? { ...t, ...p, id: t.id, token: t.token } : t)),
      false
    );
  });
}

/** A fallback showed that token `id` reads `owner`'s data: remember it. */
export function learnOwner(id: string, owner: string): Promise<void> {
  return updateToken(id, (t) => (t.owners === null || t.owners.includes(owner) ? null : { owners: [...t.owners, owner], publicOnly: false }));
}
