// Better GHub - Several tokens for one GitHub account: pure model (unit-tested).
//
// A fine-grained token reads the PRIVATE repositories of exactly one owner
// (the user or one organization) plus every public repository; classic/OAuth
// tokens cover every owner the account can access. Requests are routed to the
// token most likely to see the owner's data and fall back to the others.

import type { ApiResult, TokenKind, TokenSummary } from '../core/messages';
import type { HeaderSource } from './rate-limit';

export interface TokenMeta {
  kind: TokenKind;
  hint: string;
  /** Lower-cased owners with private access; null = classic/OAuth (every owner). */
  owners: string[] | null;
  publicOnly: boolean;
  addedAt: string;
  expiresAt: string | null;
  problem: 'invalid' | 'sso' | null;
  ssoUrl: string | null;
  /** Owner whose request asked for SSO; a later success for it clears the problem. */
  ssoOwner?: string | null;
  /** Owners not discovered yet (token migrated from the single-token version). */
  pending?: boolean;
}

export interface StoredToken extends TokenMeta {
  id: string;
  token: string;
}

/** Token kind by prefix. gho_/ghu_ (OAuth) behave like classic tokens: not limited to one owner. */
export function tokenKindOf(token: string): TokenKind {
  if (token.startsWith('github_pat_')) return 'fine-grained';
  if (/^gh[pou]_/.test(token) || /^[a-f0-9]{40}$/.test(token)) return 'classic';
  return 'unknown';
}

export function initialMeta(token: string, nowIso: string): TokenMeta {
  const kind = tokenKindOf(token);
  return {
    kind,
    hint: token.slice(-4),
    owners: kind === 'fine-grained' ? [] : null,
    publicOnly: false,
    addedAt: nowIso,
    expiresAt: null,
    problem: null,
    ssoUrl: null,
  };
}

/** Coerce stored metadata (missing/garbled → defaults derived from the token). */
export function normalizeMeta(raw: unknown, token: string, nowIso: string): TokenMeta {
  const base = initialMeta(token, nowIso);
  const m = (raw && typeof raw === 'object' ? raw : {}) as Partial<TokenMeta>;
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
  return {
    ...base,
    owners: base.kind === 'fine-grained' ? (Array.isArray(m.owners) ? m.owners.filter((o): o is string => typeof o === 'string') : []) : null,
    publicOnly: m.publicOnly === true,
    addedAt: str(m.addedAt) ?? base.addedAt,
    expiresAt: str(m.expiresAt),
    problem: m.problem === 'invalid' || m.problem === 'sso' ? m.problem : null,
    ssoUrl: str(m.ssoUrl),
    ssoOwner: str(m.ssoOwner),
    pending: m.pending === true || undefined,
  };
}

export function metaOf(t: StoredToken): TokenMeta {
  const { id: _id, token: _token, ...meta } = t;
  return meta;
}

export function toSummary(t: StoredToken): TokenSummary {
  return {
    id: t.id,
    kind: t.kind,
    hint: t.hint,
    owners: t.owners ? [...t.owners] : null,
    publicOnly: t.publicOnly,
    addedAt: t.addedAt,
    expiresAt: t.expiresAt,
    problem: t.problem,
    ssoUrl: t.ssoUrl,
  };
}

/** Tokens GitHub has not rejected, in stored (primary-first) order. */
export function usableTokens(tokens: readonly StoredToken[]): StoredToken[] {
  return tokens.filter((t) => t.problem !== 'invalid');
}

/** A GitHub login (lower-cased), or null. */
export function normalizeOwner(owner: unknown): string | null {
  if (typeof owner !== 'string') return null;
  const o = owner.trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9._-]{0,99})$/.test(o) ? o : null;
}

/** Owner of "/repos/:owner/..." REST paths. */
export function ownerFromPath(path: string): string | null {
  const m = /^\/repos\/([^/?#]+)\//.exec(path);
  return m ? normalizeOwner(decodeURIComponent(m[1])) : null;
}

/**
 * Tokens to try for `owner`, best first: fine-grained tokens known to cover it,
 * then classic/unknown tokens (every owner), then the remaining fine-grained
 * tokens (they still read PUBLIC repositories). Without an owner only the
 * primary token is used. Invalid tokens are skipped.
 */
export function candidates(tokens: readonly StoredToken[], owner: string | null): StoredToken[] {
  const usable = usableTokens(tokens);
  if (!owner) return usable.slice(0, 1);
  const covering = usable.filter((t) => t.owners?.includes(owner));
  const broad = usable.filter((t) => t.owners === null);
  const rest = usable.filter((t) => t.owners !== null && !t.owners.includes(owner));
  return [...covering, ...broad, ...rest];
}

/**
 * GitHub-Authentication-Token-Expiration ("2026-12-31 23:59:59 UTC", also
 * seen with a numeric offset) → ISO string, or null when absent/unparseable.
 */
export function parseTokenExpiration(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\s*(UTC|GMT|Z|[+-]\d{2}:?\d{2})?$/i.exec(header.trim());
  if (m) {
    const [, y, mo, d, h, mi, s, zone] = m;
    let ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0));
    if (zone && /^[+-]/.test(zone)) {
      const sign = zone[0] === '-' ? -1 : 1;
      const digits = zone.slice(1).replace(':', '');
      ms -= sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2))) * 60_000;
    }
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  const t = Date.parse(header);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Authorization URL from "X-GitHub-SSO: required; url=<url>", else null. */
export function parseSsoHeader(headers: HeaderSource): string | null {
  const v = headers.get('x-github-sso');
  if (!v || !/^\s*required\b/i.test(v)) return null;
  const m = /\burl=(https:\/\/github\.com\/\S+)/i.exec(v);
  return m ? m[1].replace(/[;,]$/, '') : null;
}

/** Distinct lower-cased owner logins of a GET /user/repos response. */
export function ownersFromRepos(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  const owners = data
    .map((r) => normalizeOwner((r as { owner?: { login?: unknown } } | null)?.owner?.login))
    .filter((o): o is string => !!o);
  return [...new Set(owners)];
}

/** GraphQL result as returned by http.githubGraphQL (error types kept for routing). */
export type GraphQLResult<T = unknown> = ApiResult<T> & { errorTypes?: string[] };

const ACCESS_ERROR_TYPES = new Set(['NOT_FOUND', 'FORBIDDEN']);

/** True when every top-level alias is null or holds `pullRequest: null`. */
function allAliasesNull(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const values = Object.values(data as Record<string, unknown>);
  return (
    values.length > 0 &&
    values.every((v) => v === null || (typeof v === 'object' && 'pullRequest' in (v as object) && (v as { pullRequest: unknown }).pullRequest === null))
  );
}

/**
 * The token could not see the data (another token might): REST 404/403 that
 * is not a rate limit; GraphQL NOT_FOUND/FORBIDDEN errors, or (with an owner)
 * every aliased repository/pullRequest null while errors are present.
 */
export function isAccessFailure(res: GraphQLResult, kind: 'graphql' | 'rest', owner: string | null): boolean {
  if (res.ok || res.rateLimited) return false;
  if (res.status === 404 || res.status === 403) return true;
  if (kind !== 'graphql') return false;
  const types = res.errorTypes ?? [];
  if (types.some((t) => ACCESS_ERROR_TYPES.has(t))) return true;
  return !!owner && types.length > 0 && allAliasesNull(res.data);
}

/** Number of non-null top-level fields (to pick the most useful partial result). */
export function dataScore(res: ApiResult<unknown>): number {
  const d = res.data;
  if (!d || typeof d !== 'object') return 0;
  return Array.isArray(d) ? d.length : Object.values(d as Record<string, unknown>).filter((v) => v !== null).length;
}
