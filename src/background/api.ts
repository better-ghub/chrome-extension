// Better GHub - 'api:graphql' / 'api:rest' proxy: token routing + response cache.
//
// Each request goes to the token most likely to see the repository owner's
// data (token-model.candidates). When that token cannot see it (an "access
// failure": 404/403, GraphQL NOT_FOUND/FORBIDDEN) the next candidates are tried
// in order; a token that succeeds after a fallback learns the owner. When no
// token can see it the result carries `needsToken: { owner }`.

import type { ApiResult, BackgroundRequests } from '../core/messages';
import { cacheGet, cacheKey, cacheSet } from './cache';
import { scheduleTokenCheck } from './auth-check';
import { githubGraphQL, githubRequest } from './http';
import { predictResource } from './rate-limit';
import { isMutation, validateRestPath } from './request-utils';
import { authGeneration, bgSettings } from './store';
import { candidates, dataScore, isAccessFailure, normalizeOwner, ownerFromPath, type GraphQLResult } from './token-model';
import { learnOwner, listTokens, updateToken } from './tokens';

type Req<K extends keyof BackgroundRequests> = BackgroundRequests[K]['req'];

// Without a token we never call GitHub: anonymous calls share a 60/hour budget
// per IP and the old code burned it within a couple of page views.
const NO_TOKEN: ApiResult<unknown> = { ok: false, status: 401, error: 'no-token' };

async function ttlMs(): Promise<number> {
  return (await bgSettings()).cacheDuration * 60_000;
}

/** Drop internal fields before a result leaves the background. */
function clean(res: GraphQLResult): ApiResult<unknown> {
  const { errorTypes: _errorTypes, ...rest } = res;
  return rest;
}

interface Route {
  kind: 'graphql' | 'rest';
  owner: string | null;
  cacheable: boolean;
  /** Only the first candidate is tried (mutations must never run twice). */
  noFallback?: boolean;
  key: (tokenId: string) => string;
  call: (token: string) => Promise<GraphQLResult>;
}

async function routed(route: Route): Promise<ApiResult<unknown>> {
  const gen = authGeneration(); // before reading the tokens
  let list = candidates(await listTokens(), route.owner);
  if (!list.length) return NO_TOKEN;
  if (route.noFallback) list = list.slice(0, 1);

  const ttl = await ttlMs();
  if (route.cacheable) {
    for (const t of list) {
      const hit = await cacheGet(route.key(t.id), ttl);
      if (hit) return hit;
    }
  }

  let best: GraphQLResult | null = null;
  let last: GraphQLResult | null = null;
  let accessFailed = false;
  let ssoUrl: string | undefined;
  for (const t of list) {
    const res = await route.call(t.token);
    last = res;
    if (res.status === 401) {
      scheduleTokenCheck(t.id); // confirmed with /user before the token is marked invalid
      continue;
    }
    if (res.ssoUrl) {
      ssoUrl = res.ssoUrl;
      await updateToken(t.id, { problem: 'sso', ssoUrl: res.ssoUrl, ssoOwner: route.owner });
    }
    if (isAccessFailure(res, route.kind, route.owner)) {
      accessFailed = true;
      if (!best || dataScore(res) > dataScore(best)) best = res;
      continue;
    }
    // Success, or a failure another token would not fix (rate limit, 5xx, 422...).
    if (res.ok && gen === authGeneration()) {
      if (accessFailed && route.owner) await learnOwner(t.id, route.owner);
      if (t.problem === 'sso' && t.ssoOwner === route.owner) await updateToken(t.id, { problem: null, ssoUrl: null, ssoOwner: null });
      // Credentials changed while in flight → never cache (another account's data).
      if (route.cacheable) await cacheSet(route.key(t.id), clean(res), ttl);
    }
    return clean(res);
  }

  // Every candidate failed: the most complete access failure, else the last result.
  const out = clean(best ?? (last as GraphQLResult));
  if (accessFailed && route.owner) out.needsToken = { owner: route.owner };
  if (ssoUrl) out.ssoUrl = ssoUrl;
  return out;
}

export async function handleGraphQL(req: Req<'api:graphql'>): Promise<ApiResult<unknown>> {
  if (typeof req.query !== 'string' || !req.query.trim()) return { ok: false, error: 'invalid-query' };
  const query = req.query;
  const variables = req.variables && typeof req.variables === 'object' ? req.variables : undefined;
  const mutation = isMutation(query);
  return routed({
    kind: 'graphql',
    owner: normalizeOwner(req.owner),
    cacheable: !req.noCache && !mutation,
    noFallback: mutation,
    key: (id) => cacheKey('graphql', query, variables, id),
    call: (token) => githubGraphQL(token, query, variables),
  });
}

export async function handleRest(req: Req<'api:rest'>): Promise<ApiResult<unknown>> {
  const path = validateRestPath(req.path);
  if (!path) return { ok: false, error: 'invalid-path' };
  return routed({
    kind: 'rest',
    owner: normalizeOwner(req.owner) ?? ownerFromPath(path),
    cacheable: !req.noCache,
    key: (id) => cacheKey('rest', path, undefined, id),
    call: (token) => githubRequest({ method: 'GET', path, token, resource: predictResource('rest', path) }),
  });
}
