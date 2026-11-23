// Better GHub - GitHub rate-limit bookkeeping (pure, unit-tested).
//
// GitHub keeps separate budgets per resource ("core" REST, "graphql",
// "search", ...) and reports which one a response counted against in
// `x-ratelimit-resource`. Exhausting one budget must not block the others.
//
// A 403 is NOT automatically a rate limit: "Resource not accessible by
// personal access token", SAML enforcement or IP allow lists also answer 403.
// Treating those as rate limits used to lock out every call for up to an hour.

import type { RateLimitSnapshot } from '../core/messages';

export interface HeaderSource {
  get(name: string): string | null;
}

function num(v: string | null): number | null {
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseRateLimit(headers: HeaderSource): RateLimitSnapshot & { resource: string | null } {
  return {
    remaining: num(headers.get('x-ratelimit-remaining')),
    limit: num(headers.get('x-ratelimit-limit')),
    reset: num(headers.get('x-ratelimit-reset')),
    resource: headers.get('x-ratelimit-resource'),
  };
}

/**
 * True when a failed response is a primary or secondary rate limit:
 * 403/429 AND (budget exhausted, a retry-after hint, or a message saying so).
 */
export function isRateLimitResponse(status: number, headers: HeaderSource, bodyMessage = ''): boolean {
  if (status !== 403 && status !== 429) return false;
  if (headers.get('x-ratelimit-remaining') === '0') return true;
  if (headers.get('retry-after') !== null) return true;
  return /rate limit/i.test(bodyMessage);
}

/** Epoch ms until which a rate-limited resource should not be called again. */
export function blockedUntil(headers: HeaderSource, now: number): number {
  const retryAfter = num(headers.get('retry-after'));
  if (retryAfter !== null && retryAfter > 0) return now + retryAfter * 1000;
  const reset = num(headers.get('x-ratelimit-reset'));
  if (headers.get('x-ratelimit-remaining') === '0' && reset !== null) return Math.max(reset * 1000, now + 1000);
  // Secondary limit without hints: GitHub asks clients to wait at least a minute.
  return now + 60_000;
}

/** The budget a request will count against (known before the response arrives). */
export function predictResource(kind: 'graphql' | 'rest', path = ''): string {
  if (kind === 'graphql') return 'graphql';
  if (path.startsWith('/search/code')) return 'code_search';
  if (path.startsWith('/search/')) return 'search';
  return 'core';
}

export interface TrackerState {
  snapshots: Record<string, RateLimitSnapshot>;
  blocked: Record<string, number>;
}

export class RateLimitTracker {
  private snapshots = new Map<string, RateLimitSnapshot>();
  private blocked = new Map<string, number>();

  /** Record the budget reported by a response; an exhausted budget blocks until reset. */
  record(resource: string, snap: RateLimitSnapshot, now: number): void {
    if (snap.remaining === null && snap.limit === null) return;
    this.snapshots.set(resource, { remaining: snap.remaining, limit: snap.limit, reset: snap.reset });
    if (snap.remaining === 0 && snap.reset !== null) this.block(resource, Math.max(snap.reset * 1000, now + 1000));
  }

  block(resource: string, untilMs: number): void {
    this.blocked.set(resource, Math.max(untilMs, this.blocked.get(resource) ?? 0));
  }

  /** Epoch ms the resource is blocked until, or 0 when it can be called. */
  blockedUntil(resource: string, now: number): number {
    const until = this.blocked.get(resource) ?? 0;
    if (until && until <= now) {
      this.blocked.delete(resource);
      return 0;
    }
    return until;
  }

  snapshot(resource: string): RateLimitSnapshot | undefined {
    return this.snapshots.get(resource);
  }

  /** Forget every budget and block (new credentials). */
  clear(): void {
    this.snapshots.clear();
    this.blocked.clear();
  }

  toJSON(): TrackerState {
    return { snapshots: Object.fromEntries(this.snapshots), blocked: Object.fromEntries(this.blocked) };
  }

  load(state: Partial<TrackerState> | undefined, now: number): void {
    if (!state) return;
    for (const [k, v] of Object.entries(state.snapshots ?? {})) if (!this.snapshots.has(k)) this.snapshots.set(k, v);
    for (const [k, v] of Object.entries(state.blocked ?? {})) if (typeof v === 'number' && v > now) this.block(k, v);
  }
}
