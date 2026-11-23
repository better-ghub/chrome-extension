// Better GHub - The only place that talks to api.github.com.
//
// - injects the token (content scripts never see it)
// - caps concurrency (the old code fired ~100 parallel requests per PR list
//   page and tripped GitHub's secondary rate limit)
// - tracks rate-limit budgets per resource and short-circuits exhausted ones
// - parses bodies defensively (204, HTML error pages, truncated JSON)

import type { ApiResult, RateLimitSnapshot } from '../core/messages';
import { redactSecrets } from '../redact';
import { blockedUntil, isRateLimitResponse, parseRateLimit, RateLimitTracker, type HeaderSource, type TrackerState } from './rate-limit';
import { API_ORIGIN, bodyMessage, parseJsonBody } from './request-utils';
import { parseSsoHeader, type GraphQLResult } from './token-model';

const MAX_IN_FLIGHT = 4;
const TIMEOUT_MS = 20_000;
const TRACKER_KEY = 'bghub:rateLimits';

const tracker = new RateLimitTracker();
let trackerLoaded: Promise<void> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
/** Bumped by resetRateLimits(); responses to older requests are not recorded. */
let trackerEpoch = 0;

/** Rate-limit state survives service-worker restarts via storage.session. */
function loadTracker(): Promise<void> {
  trackerLoaded ??= chrome.storage.session
    .get(TRACKER_KEY)
    .then((items) => tracker.load(items[TRACKER_KEY] as Partial<TrackerState> | undefined, Date.now()))
    .catch(() => undefined);
  return trackerLoaded;
}

function persistTracker(): void {
  if (persistTimer !== undefined) return;
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    void chrome.storage.session.set({ [TRACKER_KEY]: tracker.toJSON() }).catch(() => undefined);
  }, 300);
}

export function rateLimitSnapshot(resource = 'core'): RateLimitSnapshot | undefined {
  return tracker.snapshot(resource);
}

/**
 * Forget all budgets and blocks: they belonged to the previous credentials.
 * Called when a token is stored and when credentials are dropped.
 */
export async function resetRateLimits(): Promise<void> {
  trackerEpoch++;
  if (persistTimer !== undefined) {
    clearTimeout(persistTimer);
    persistTimer = undefined;
  }
  // Chain after a pending load so stale persisted state cannot land afterwards.
  trackerLoaded = (trackerLoaded ?? Promise.resolve()).then(async () => {
    tracker.clear();
    await chrome.storage.session.remove(TRACKER_KEY).catch(() => undefined);
  });
  await trackerLoaded;
}

/** Seed a budget observed outside the tracker (see GitHubRequest.candidate). */
export function recordRateLimit(resource: string, snap: RateLimitSnapshot | undefined): void {
  if (!snap) return;
  tracker.record(resource, snap, Date.now());
  persistTracker();
}

// --- concurrency cap ---------------------------------------------------------

let inFlight = 0;
const waiters: (() => void)[] = [];

async function acquire(): Promise<void> {
  if (inFlight < MAX_IN_FLIGHT) {
    inFlight++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
}

function release(): void {
  const next = waiters.shift();
  if (next) next(); // hand the slot over directly
  else inFlight--;
}

// --- request -----------------------------------------------------------------

export interface GitHubRequest {
  method: 'GET' | 'POST';
  /** Path relative to api.github.com, already validated. */
  path: string;
  body?: unknown;
  token: string;
  /** Budget this call counts against (see predictResource). */
  resource: string;
  /**
   * The token is a candidate being validated, not the stored one: ignore
   * blocks recorded for the stored token's budget and record nothing.
   */
  candidate?: boolean;
  /** Sees the response headers (e.g. the token expiration header). */
  onHeaders?: (headers: HeaderSource) => void;
}

function rateLimitedResult<T>(resource: string, until: number): ApiResult<T> {
  const snap = tracker.snapshot(resource);
  return {
    ok: false,
    status: 429,
    rateLimited: true,
    error: 'rate-limited',
    rateLimit: { remaining: snap?.remaining ?? 0, limit: snap?.limit ?? null, reset: Math.ceil(until / 1000) },
  };
}

export async function githubRequest<T = unknown>(req: GitHubRequest): Promise<ApiResult<T>> {
  await loadTracker();
  const epoch = trackerEpoch;
  const until = req.candidate ? 0 : tracker.blockedUntil(req.resource, Date.now());
  if (until) return rateLimitedResult<T>(req.resource, until);

  await acquire();
  let response: Response;
  let text = '';
  try {
    response = await fetch(API_ORIGIN + req.path, {
      method: req.method,
      headers: {
        Authorization: `Bearer ${req.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      cache: 'no-store',
      credentials: 'omit',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    text = await response.text().catch(() => '');
  } catch (error) {
    return { ok: false, status: 0, error: `network: ${redactSecrets(error instanceof Error ? error.message : String(error))}` };
  } finally {
    release();
  }

  req.onHeaders?.(response.headers);
  const now = Date.now();
  const rl = parseRateLimit(response.headers);
  const resource = rl.resource ?? req.resource;
  // Not recorded: a 401 reports the anonymous 60/h budget, a candidate token
  // has its own budget, and a reset since the call started means the response
  // belongs to the previous credentials.
  const track = response.status !== 401 && !req.candidate && epoch === trackerEpoch;
  if (track) {
    tracker.record(resource, rl, now);
    persistTracker();
  }
  const snap = { remaining: rl.remaining, limit: rl.limit, reset: rl.reset };
  const rateLimit = track ? tracker.snapshot(resource) : rl.remaining === null && rl.limit === null ? undefined : snap;
  const data = parseJsonBody(text);

  if (!response.ok) {
    const message = bodyMessage(data);
    if (isRateLimitResponse(response.status, response.headers, message)) {
      const blockUntil = blockedUntil(response.headers, now);
      if (track) {
        tracker.block(resource, blockUntil);
        if (resource !== req.resource) tracker.block(req.resource, blockUntil);
        persistTracker();
      }
      return {
        ok: false,
        status: response.status,
        rateLimited: true,
        error: 'rate-limited',
        rateLimit: { remaining: rateLimit?.remaining ?? 0, limit: rateLimit?.limit ?? null, reset: Math.ceil(blockUntil / 1000) },
      };
    }
    // Classic tokens need SAML SSO authorization per organization.
    const ssoUrl = response.status === 403 ? parseSsoHeader(response.headers) : null;
    return {
      ok: false,
      status: response.status,
      error: redactSecrets(message || `HTTP ${response.status}`),
      data: data as T | undefined,
      rateLimit,
      ...(ssoUrl ? { ssoUrl } : {}),
    };
  }
  return { ok: true, status: response.status, data: data as T | undefined, rateLimit };
}

interface GraphQLError {
  message?: string;
  type?: string;
}

/**
 * POST /graphql. GraphQL reports most failures with HTTP 200 + `errors`;
 * partial `data` is returned alongside (e.g. one inaccessible repository in
 * an aliased batch must not hide the other results). `errorTypes` (internal,
 * for token routing) lists each error's type ('UNKNOWN' when untyped).
 */
export async function githubGraphQL<T = unknown>(token: string, query: string, variables?: Record<string, unknown>): Promise<GraphQLResult<T>> {
  const epoch = trackerEpoch;
  const res = await githubRequest<{ data?: T | null; errors?: GraphQLError[] }>({
    method: 'POST',
    path: '/graphql',
    body: { query, variables: variables ?? {} },
    token,
    resource: 'graphql',
  });
  if (!res.ok) return { ...res, data: undefined };
  const body = res.data;
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  const data = body?.data ?? undefined;
  if (!errors.length) return { ok: true, status: res.status, data, rateLimit: res.rateLimit };

  const error = redactSecrets(errors.map((e) => e.message ?? e.type ?? 'error').join('; '));
  const errorTypes = errors.map((e) => e.type ?? 'UNKNOWN');
  if (errors.some((e) => e.type === 'RATE_LIMITED')) {
    const reset = res.rateLimit?.reset;
    const until = reset ? reset * 1000 : Date.now() + 60_000;
    if (epoch === trackerEpoch) {
      tracker.block('graphql', until);
      persistTracker();
    }
    return { ...rateLimitedResult<T>('graphql', until), data, error, errorTypes };
  }
  return { ok: false, status: res.status, data, error, errorTypes, rateLimit: res.rateLimit };
}
