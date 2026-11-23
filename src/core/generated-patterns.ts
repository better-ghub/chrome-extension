// Better GHub - "generated file" path patterns (pure). Single implementation
// shared by the Files tab (auto-collapse) and the Options page ("Test a path").
//
// Syntax (documented on GENERATED_PATTERNS_DEFAULT in core/settings.ts):
//   *    any characters except '/'
//   **   any path (including '/'); `**/` also matches zero directories
//   a pattern without '/' matches the basename at any depth   (yarn.lock, *.min.js)
//   a pattern with '/' matches from any directory boundary    (dist/** → dist/a.js, pkg/x/dist/a.js)
//   a leading '/' anchors at the repository root; a trailing '/' means "everything below"
// Everything else is literal (no ?, [], {} magic). Matching is case-sensitive, like git.

const REGEX_SPECIAL = /[.+^${}()|[\]\\?]/g;

/** Regex source for one pattern, or null for blank patterns. */
export function patternSource(raw: string): string | null {
  let p = raw.trim();
  if (!p) return null;
  const anchored = p.startsWith('/');
  p = p.replace(/^\/+/, '');
  if (p.endsWith('/')) p += '**';
  // Collapse redundant globstars so user patterns can't stack nested quantifiers.
  p = p.replace(/\*{3,}/g, '**').replace(/(?:\*\*\/)+/g, '**/');
  if (!p) return null;
  let body = '';
  for (let i = 0; i < p.length; ) {
    if (p.startsWith('**/', i)) {
      body += '(?:[^/]*/)*';
      i += 3;
    } else if (p.startsWith('**', i)) {
      body += '.*';
      i += 2;
    } else if (p[i] === '*') {
      body += '[^/]*';
      i += 1;
    } else {
      body += p[i].replace(REGEX_SPECIAL, '\\$&');
      i += 1;
    }
  }
  // Without '/' the body can only span one segment, so "(^|/)" = "basename at any depth".
  return `${anchored ? '^' : '(?:^|/)'}${body}$`;
}

/** All patterns of a list as one regex (null when the list is effectively empty). */
export function compilePatterns(patterns: readonly string[]): RegExp | null {
  const sources = patterns.map(patternSource).filter((s): s is string => s !== null);
  return sources.length ? new RegExp(sources.map((s) => `(?:${s})`).join('|')) : null;
}

// Settings hand out the same array until they change, so identity is the fast
// path; the string key catches equal lists built per call (tests, Options).
const byIdentity = new WeakMap<readonly string[], RegExp | null>();
const byKey = new Map<string, RegExp | null>();
const MAX_KEYS = 8;

function compiled(patterns: readonly string[]): RegExp | null {
  const hit = byIdentity.get(patterns);
  if (hit !== undefined) return hit;
  const key = patterns.join('\n');
  let re = byKey.get(key);
  if (re === undefined) {
    re = compilePatterns(patterns);
    if (byKey.size >= MAX_KEYS) byKey.delete(byKey.keys().next().value as string);
    byKey.set(key, re);
  }
  byIdentity.set(patterns, re);
  return re;
}

/** Whether `path` (repo-relative, '/'-separated) matches any of `patterns`. */
export function matchesGenerated(path: string, patterns: readonly string[]): boolean {
  const re = compiled(patterns);
  return !!re && !!path && re.test(path.replace(/^\/+/, ''));
}

/** The first pattern of `patterns` that matches `path` (for "why is this generated?"), or null. */
export function firstMatchingPattern(path: string, patterns: readonly string[]): string | null {
  const clean = path.trim().replace(/^\.?\/+/, '');
  if (!clean) return null;
  for (const raw of patterns) {
    const source = patternSource(raw);
    if (source && new RegExp(source).test(clean)) return raw.trim();
  }
  return null;
}

/**
 * What "Copy checkout command" copies. 'gh' → GitHub CLI (handles forks);
 * 'git' → plain git: `pull/<n>/head` is published on the BASE repository for
 * every PR, forks included, so fetching it from `origin` always works.
 */
export function checkoutCommand(number: number, kind: 'gh' | 'git'): string {
  return kind === 'git' ? `git fetch origin pull/${number}/head:pr-${number} && git switch pr-${number}` : `gh pr checkout ${number}`;
}
