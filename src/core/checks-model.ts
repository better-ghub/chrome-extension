// Better GHub - Failed CI details: one read-only GraphQL query for a PR's head
// commit, a pure parser, and a small in-memory cache (pure, unit-tested).

export interface FailedCheck {
  name: string;
  /** Workflow name for GitHub Actions runs (absent for commit statuses / other apps). */
  workflow?: string;
  /** Details page on github.com, or null (callers fall back to the Checks tab). */
  url: string | null;
}

export interface ChecksSummary {
  failed: FailedCheck[];
  pending: number;
  passed: number;
}

export interface PRRefLite {
  owner: string;
  repo: string;
  number: number;
}

export const CHECKS_QUERY = `query BghubChecks($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      commits(last: 1) {
        nodes {
          commit {
            oid
            statusCheckRollup {
              contexts(first: 100) {
                nodes {
                  __typename
                  ... on CheckRun { name conclusion status detailsUrl checkSuite { workflowRun { workflow { name } } } }
                  ... on StatusContext { context state targetUrl description }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

const FAILED_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const PASSED_CONCLUSIONS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);

interface RawContext {
  __typename?: string;
  name?: string;
  conclusion?: string | null;
  status?: string | null;
  detailsUrl?: string | null;
  checkSuite?: { workflowRun?: { workflow?: { name?: string | null } | null } | null } | null;
  context?: string;
  state?: string | null;
  targetUrl?: string | null;
}

/** Only links on github.com are rendered as hrefs (details URLs of other apps are not trusted). */
export function safeGitHubUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'github.com' ? u.href : null;
  } catch {
    return null;
  }
}

/** Parse the `api:graphql` data of CHECKS_QUERY. Returns null when the PR / rollup is missing. */
export function parseChecks(data: unknown): ChecksSummary | null {
  const repository = (data as { repository?: { pullRequest?: unknown } | null } | null)?.repository;
  const pr = repository?.pullRequest as
    | { commits?: { nodes?: ({ commit?: { statusCheckRollup?: { contexts?: { nodes?: (RawContext | null)[] | null } | null } | null } } | null)[] | null } | null }
    | null
    | undefined;
  const nodes = pr?.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes;
  if (!Array.isArray(nodes)) return null;
  const failed: FailedCheck[] = [];
  const seen = new Set<string>();
  let pending = 0;
  let passed = 0;
  for (const node of nodes) {
    if (!node) continue;
    if (node.__typename === 'StatusContext') {
      const name = node.context || 'status';
      if (node.state === 'ERROR' || node.state === 'FAILURE') {
        const key = `${name}\u0000`;
        if (!seen.has(key)) {
          seen.add(key);
          failed.push({ name, url: safeGitHubUrl(node.targetUrl) });
        }
      } else if (node.state === 'SUCCESS') passed++;
      else pending++;
      continue;
    }
    const name = node.name || 'check';
    if (node.status && node.status !== 'COMPLETED') {
      pending++;
    } else if (node.conclusion && FAILED_CONCLUSIONS.has(node.conclusion)) {
      const workflow = node.checkSuite?.workflowRun?.workflow?.name || undefined;
      const key = `${name}\u0000${workflow ?? ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        failed.push({ name, ...(workflow ? { workflow } : {}), url: safeGitHubUrl(node.detailsUrl) });
      }
    } else if (node.conclusion && PASSED_CONCLUSIONS.has(node.conclusion)) {
      passed++;
    } else {
      pending++;
    }
  }
  return { failed, pending, passed };
}

/** "owner/repo#123" or a PR URL → ref (null when it is not a pull request URL). */
export function parsePrUrl(url: string): PRRefLite | null {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url);
  return m ? { owner: m[1], repo: m[2], number: Number(m[3]) } : null;
}

export function checksTabUrl(prUrl: string): string {
  const m = /^(https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+)/.exec(prUrl);
  return `${m ? m[1] : prUrl.replace(/[?#].*$/, '')}/checks`;
}

/** Runs a read-only GraphQL query through the background. */
export type GraphqlSender = (query: string, variables: Record<string, unknown>, owner: string) => Promise<{ ok: boolean; data?: unknown }>;

const CACHE_TTL = 2 * 60_000;
const cache = new Map<string, { at: number; value: ChecksSummary | null }>();
const inflight = new Map<string, Promise<ChecksSummary | null>>();

export function clearChecksCache(): void {
  cache.clear();
  inflight.clear();
}

/**
 * Fetch (lazily, once per PR) the checks of the PR's head commit. Cached in
 * memory for a couple of minutes; failures resolve to null and are not cached.
 * Pass the head `sha` when the caller knows it so a new push invalidates the entry.
 */
export function loadChecks(prUrl: string, send: GraphqlSender, sha = '', now = Date.now()): Promise<ChecksSummary | null> {
  const ref = parsePrUrl(prUrl);
  if (!ref) return Promise.resolve(null);
  const key = `${ref.owner}/${ref.repo}#${ref.number}@${sha}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL) return Promise.resolve(hit.value);
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = send(CHECKS_QUERY, { owner: ref.owner, repo: ref.repo, number: ref.number }, ref.owner)
    .then((res) => {
      const value = res.ok || res.data ? parseChecks(res.data) : null;
      if (value) cache.set(key, { at: now, value });
      return value;
    })
    .catch(() => null)
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
