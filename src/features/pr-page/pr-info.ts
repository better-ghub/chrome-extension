// Better GHub - PR page: head branch & title extraction (pure, DOM-fixture testable).

import { queryFirst } from './dom-queries';

export interface HeadRef {
  /** Branch name only — what gets copied. */
  branch: string;
  /** What the toast shows: "owner:branch" for forks, else the branch. */
  display: string;
}

/**
 * Classic header: `<span class="commit-ref head-ref" title="owner/repo:branch">`
 * (the inner <a> carries the same title). The visible text is "branch" for
 * same-repo PRs and "owner:branch" for forks. React header: data-testid.
 */
const HEAD_REF_SELECTORS = [
  '.gh-header-meta .commit-ref.head-ref',
  '.commit-ref.head-ref',
  'span.head-ref',
  '.head-ref',
  '[data-testid*="head-ref"]',
  '.gh-header-meta .commit-ref:last-of-type',
] as const;

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * Parse "owner/repo:branch", "owner:branch" or "branch". Git forbids ':' in
 * ref names, so the first ':' always separates the owner part.
 */
export function parseHeadRef(raw: string, prOwner?: string): HeadRef | null {
  const text = clean(raw).replace(/\s/g, '');
  if (!text) return null;
  const colon = text.indexOf(':');
  if (colon === -1) return { branch: text, display: text };
  const ownerPart = text.slice(0, colon);
  const branch = text.slice(colon + 1);
  if (!branch) return null;
  const owner = ownerPart.split('/')[0];
  const fork = !!owner && (!prOwner || owner.toLowerCase() !== prOwner.toLowerCase());
  return { branch, display: fork ? `${owner}:${branch}` : branch };
}

export function findHeadRef(root: ParentNode, prOwner?: string): HeadRef | null {
  const el = queryFirst(root, HEAD_REF_SELECTORS);
  if (el) {
    const title = el.getAttribute('title') || el.querySelector('[title]')?.getAttribute('title') || '';
    const parsed = parseHeadRef(title.includes(':') ? title : el.textContent || title, prOwner);
    if (parsed) return parsed;
  }
  // React header: "… wants to merge … into BASE from HEAD" rendered with
  // BranchName links. The header is rendered twice (normal + sticky), so
  // dedupe by text; only trust it when exactly base + head remain.
  const names = uniqueTexts(
    Array.from(root.querySelectorAll('[data-component="BranchName"], .BranchName, [class*="BranchName"]')).filter(
      (el) => !el.closest('.markdown-body, .comment-body')
    )
  );
  return names.length === 2 ? parseHeadRef(names[1], prOwner) : null;
}

function uniqueTexts(els: Element[]): string[] {
  const out: string[] = [];
  for (const el of els) {
    const text = clean(el.textContent ?? '');
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

/** Narrow an unknown REST payload (`GET /repos/o/r/pulls/n`) to a head ref. */
export function headRefFromApi(data: unknown, prOwner?: string): HeadRef | null {
  if (!data || typeof data !== 'object') return null;
  const head = (data as { head?: unknown }).head;
  if (!head || typeof head !== 'object') return null;
  const { ref, label } = head as { ref?: unknown; label?: unknown };
  if (typeof ref !== 'string' || !ref) return null;
  const parsed = typeof label === 'string' ? parseHeadRef(label, prOwner) : null;
  return { branch: ref, display: parsed?.display ?? ref };
}

/**
 * Precise title nodes only. The React header's `[data-component="PH_Title"]`
 * also contains the number, author and branch names, so we never read it as a
 * whole; when no precise node exists the document title is the safest source.
 */
const TITLE_SELECTORS = ['.js-issue-title', 'h1 [class*="markdownTitle"]', '[data-component="PH_Title"] [class*="markdownTitle"]'] as const;

/** Strip a trailing " #12" / " - #12" (the header renders the number next to the title). */
export function cleanTitle(raw: string, number?: number): string {
  const num = number ? String(number) : '\\d+';
  return clean(raw).replace(new RegExp(`\\s*(?:[-–—·:]\\s*)?#${num}$`), '').trim();
}

/** "<title> by <user> · Pull Request #N · owner/repo · GitHub" → "<title>". */
export function titleFromDocumentTitle(docTitle: string): string | null {
  const m = docTitle.match(/^(.*) by [^·]+ · Pull Request #\d+/) ?? docTitle.match(/^(.*?) · Pull Request #\d+/);
  const title = m ? clean(m[1]) : '';
  return title || null;
}

export function findTitle(root: ParentNode, number?: number, docTitle = document.title): string | null {
  const el = queryFirst(root, TITLE_SELECTORS);
  const fromDom = el ? cleanTitle(el.textContent ?? '', number) : '';
  return fromDom || titleFromDocumentTitle(docTitle) || cleanTitle(root.querySelector('.gh-header-title, h1')?.textContent ?? '', number) || null;
}

export function escapeMarkdownText(s: string): string {
  return s.replace(/([\\[\]])/g, '\\$1');
}

export function markdownLink(title: string, number: number, url: string): string {
  return `[${escapeMarkdownText(title)} (#${number})](${url})`;
}
