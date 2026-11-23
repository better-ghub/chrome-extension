// Better GHub - URL → page classification (pure, unit-testable).

export type PageKind = 'pr' | 'pr-list' | 'dashboard' | 'other';
export type PRTab = 'conversation' | 'commits' | 'checks' | 'files';

export interface PageContext {
  kind: PageKind;
  url: URL;
  owner?: string;
  repo?: string;
  /** PR number on 'pr' pages. */
  number?: number;
  /** Active tab on 'pr' pages. */
  prTab?: PRTab;
}

// First path segments that are GitHub features, not user/org names.
const RESERVED_OWNERS = new Set([
  'settings', 'notifications', 'marketplace', 'explore', 'topics', 'trending', 'collections', 'sponsors',
  'orgs', 'organizations', 'login', 'logout', 'signup', 'join', 'search', 'pulls', 'issues', 'codespaces',
  'features', 'enterprise', 'pricing', 'about', 'apps', 'github-copilot', 'copilot', 'new', 'account', 'stars',
  'watching', 'dashboard', 'site', 'security', 'customer-stories', 'readme', 'team', 'blog', 'events', 'gist',
]);

export function parsePage(input: string | URL): PageContext {
  const url = typeof input === 'string' ? new URL(input) : input;
  const base: PageContext = { kind: 'other', url };
  if (url.hostname !== 'github.com') return base;

  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/' || path === '/dashboard') return { kind: 'dashboard', url };

  const parts = path.split('/').filter(Boolean);
  const [owner, repo, section, num, sub, subId] = parts;
  if (!owner || !repo || RESERVED_OWNERS.has(owner.toLowerCase())) return base;

  if (section === 'pulls' && parts.length <= 4) {
    // /owner/repo/pulls, /owner/repo/pulls/assigned/foo etc.
    return { kind: 'pr-list', url, owner, repo };
  }

  if (section === 'pull' && num && /^\d+$/.test(num)) {
    let prTab: PRTab = 'conversation';
    if (sub === 'files' || sub === 'changes') prTab = 'files';
    // /pull/1/commits/<sha> renders a single-commit diff → behaves like the files tab.
    else if (sub === 'commits') prTab = subId ? 'files' : 'commits';
    else if (sub === 'checks') prTab = 'checks';
    return { kind: 'pr', url, owner, repo, number: Number(num), prTab };
  }

  return base;
}

/** Canonical PR url without tab/hash/query, e.g. https://github.com/o/r/pull/1 */
export function prUrl(ctx: Pick<PageContext, 'owner' | 'repo' | 'number'>): string | null {
  if (!ctx.owner || !ctx.repo || !ctx.number) return null;
  return `https://github.com/${ctx.owner}/${ctx.repo}/pull/${ctx.number}`;
}

/** Parse "https://github.com/o/r/pull/123[/...]" into its parts. */
export function parsePRUrl(href: string): { owner: string; repo: string; number: number } | null {
  try {
    const u = new URL(href, 'https://github.com');
    if (u.hostname !== 'github.com') return null;
    const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    return m ? { owner: m[1], repo: m[2], number: Number(m[3]) } : null;
  } catch {
    return null;
  }
}
