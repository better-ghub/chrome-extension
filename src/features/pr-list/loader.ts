// Better GHub - Row data store: batches visible rows into GraphQL chunks,
// keeps results for the lifetime of a mount (React re-renders re-insert our
// nodes from here without refetching) and retries failures with backoff.

import { sendToBackground } from '../../core/messages';
import { analyzePR, type RawPR, type RowModel } from './analyze';
import { buildPRQuery, chunk, type PRRef } from './query';

export type RowState =
  | { status: 'loading' }
  | { status: 'ready'; model: RowModel }
  /** The PR/repo is not readable with this token (404 / SAML / no access). */
  | { status: 'gone' }
  | { status: 'error'; attempts: number; retryAt: number };

const MAX_ATTEMPTS = 3;
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

function isGitHubUrl(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && u.hostname === 'github.com';
  } catch {
    return false;
  }
}
const BACKOFF_MS = 15_000;

export interface LoaderOptions {
  signal: AbortSignal;
  /** Repository owner of the list page: routes requests to the token that covers it. */
  owner?: string;
  viewer: string;
  withLabels: boolean;
  /** settings.staleDays (0 = never stale). */
  staleDays?: number;
  /** Called with the keys whose state changed. */
  onUpdate: (keys: string[]) => void;
}

export class RowLoader {
  private states = new Map<string, RowState>();
  private queue = new Map<string, PRRef>();
  private flushScheduled = false;
  private wakeTimer: ReturnType<typeof setTimeout> | undefined;
  /** Epoch ms until which GitHub said to back off (0 = not limited). */
  rateLimitedUntil = 0;
  /** Set when GitHub answered but the token cannot read this repository. */
  accessError: string | null = null;
  /** Owner none of the stored tokens can read private data of (from the background). */
  needsToken: string | null = null;
  /** SAML SSO authorization URL GitHub asked for. */
  ssoUrl: string | null = null;

  constructor(private readonly opts: LoaderOptions) {
    opts.signal.addEventListener('abort', () => clearTimeout(this.wakeTimer), { once: true });
  }

  get(key: string): RowState | undefined {
    return this.states.get(key);
  }

  /** Ensure data for `ref` is loaded or loading; cheap to call on every scan. */
  request(ref: PRRef): RowState {
    const now = Date.now();
    const current = this.states.get(ref.key);
    if (current && current.status !== 'error') return current;
    if (current?.status === 'error' && (current.attempts >= MAX_ATTEMPTS || now < current.retryAt)) return current;
    if (now < this.rateLimitedUntil) return current ?? { status: 'gone' };
    const loading: RowState = { status: 'loading' };
    this.states.set(ref.key, loading);
    this.queue.set(ref.key, ref);
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      // Collect every row of this scan into as few requests as possible.
      queueMicrotask(() => this.flush());
    }
    return loading;
  }

  private flush(): void {
    this.flushScheduled = false;
    if (this.opts.signal.aborted) return;
    const refs = [...this.queue.values()];
    this.queue.clear();
    for (const part of chunk(refs)) void this.fetchChunk(part);
  }

  private async fetchChunk(refs: PRRef[]): Promise<void> {
    const { query, variables, aliases } = buildPRQuery(refs, { withFiles: this.opts.withLabels });
    const res = await sendToBackground(
      'api:graphql',
      { query, variables, owner: this.opts.owner ?? refs[0]?.owner },
      { ok: false, error: 'unavailable' }
    );
    if (this.opts.signal.aborted) return;

    const needs = res.needsToken?.owner;
    if (typeof needs === 'string' && LOGIN_RE.test(needs)) this.needsToken = needs;
    if (isGitHubUrl(res.ssoUrl)) this.ssoUrl = res.ssoUrl;
    // No stored token can read these rows: retrying won't help until one is added.
    const blocked = !!res.needsToken || !!res.ssoUrl;

    const data = (res.data ?? null) as Record<string, { pullRequest?: RawPR | null } | null> | null;
    if (res.rateLimited) {
      const reset = res.rateLimit?.reset ? res.rateLimit.reset * 1000 : Date.now() + 60_000;
      this.rateLimitedUntil = Math.max(this.rateLimitedUntil, reset);
    }
    let gone = 0;
    refs.forEach((ref, i) => {
      const pr = data?.[aliases[i]]?.pullRequest;
      if (pr) {
        this.states.set(ref.key, { status: 'ready', model: analyzePR(pr, this.opts.viewer, this.opts.withLabels, { staleDays: this.opts.staleDays }) });
      } else if ((data || blocked) && !res.rateLimited) {
        // GitHub answered, this alias is null: not found / not accessible.
        this.states.set(ref.key, { status: 'gone' });
        gone++;
      } else {
        const prev = this.states.get(ref.key);
        const attempts = (prev?.status === 'error' ? prev.attempts : 0) + 1;
        this.states.set(ref.key, { status: 'error', attempts, retryAt: Date.now() + BACKOFF_MS * 2 ** (attempts - 1) });
      }
    });
    if (gone === refs.length && res.error) this.accessError = res.error;
    this.opts.onUpdate(refs.map((r) => r.key));
    this.scheduleWake();
  }

  /**
   * Retries only happen when the controller rescans, which normally follows
   * DOM mutations — an idle list page has none. Wake it up when the earliest
   * retry (or the end of a rate-limit pause) is due.
   */
  private scheduleWake(): void {
    if (this.opts.signal.aborted) return;
    const now = Date.now();
    let next = this.rateLimitedUntil > now ? this.rateLimitedUntil : Infinity;
    for (const s of this.states.values()) {
      if (s.status === 'error' && s.attempts < MAX_ATTEMPTS) next = Math.min(next, Math.max(s.retryAt, this.rateLimitedUntil));
    }
    clearTimeout(this.wakeTimer);
    if (!Number.isFinite(next)) return;
    this.wakeTimer = setTimeout(() => {
      if (!this.opts.signal.aborted) this.opts.onUpdate([]);
    }, Math.max(1000, next - now + 250));
  }

  /** True while any requested row is still loading. */
  busy(): boolean {
    for (const s of this.states.values()) if (s.status === 'loading') return true;
    return false;
  }
}
