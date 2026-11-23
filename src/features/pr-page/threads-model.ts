// Better GHub - PR page: what the unresolved-threads panel shows for each thread.
// Text only (textContent / attributes); nothing from the page is ever parsed as HTML.

import { collectUnresolvedThreads } from './actions/threads';
import { isUserContent, SEL } from './dom-queries';
import { cleanPath, reactHeaderPath } from './files-model';

export interface ThreadItem {
  el: Element;
  /** File path, '' when unknown. */
  path: string;
  /** First ~120 characters of the first comment. */
  excerpt: string;
  /** Login of the first comment's author, '' when unknown. */
  author: string;
  /** https:// avatar URL or null. */
  avatar: string | null;
  outdated: boolean;
}

export const EXCERPT_LENGTH = 120;

/** Collapse whitespace and cut at `max` characters (on a word boundary when one is close). */
export function excerpt(text: string, max = EXCERPT_LENGTH): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.7 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** First match outside user-authored markdown. */
function own<T extends Element = Element>(root: Element, selector: string): T | null {
  return Array.from(root.querySelectorAll<T>(selector)).find((el) => !isUserContent(el)) ?? null;
}

/**
 * Conversation threads carry the path in their header link
 * (`a.Link--primary.text-mono`); Files-tab threads live inside the file.
 */
export function threadPath(thread: Element): string {
  const link = own(thread, 'a.Link--primary.text-mono, [data-path]');
  const fromLink = link ? cleanPath(link.getAttribute('data-path') || link.getAttribute('title') || link.textContent || '') : '';
  if (fromLink) return fromLink;
  const file = thread.closest(SEL.classicFile);
  if (file) {
    return cleanPath(file.getAttribute('data-tagsearch-path') || file.querySelector(SEL.classicFileHeader)?.getAttribute('data-path') || '');
  }
  const reactHeader = thread.closest('[id^="diff-"]')?.querySelector(SEL.reactFileHeader);
  return reactHeader ? reactHeaderPath(reactHeader) : '';
}

const OUTDATED = /^outdated$/i;

/** "Outdated" label in the thread header, an outdated wrapper, or GitHub's data attribute. */
export function isOutdated(thread: Element): boolean {
  if (thread.getAttribute('data-outdated') === 'true') return true;
  if (thread.closest('.outdated-diff-comment-container, .outdated-comment')) return true;
  for (const el of Array.from(thread.querySelectorAll('.Label, [class*="Label-module__"], .State'))) {
    if (!isUserContent(el) && OUTDATED.test((el.textContent ?? '').trim())) return true;
  }
  return false;
}

function firstBody(thread: Element): string {
  const body = thread.querySelector('.comment-body, .markdown-body, [class*="markdown-body"]');
  return body?.textContent ?? '';
}

function author(thread: Element): string {
  const el = own(thread, '.author, a[data-hovercard-type="user"], [data-testid="author-link"]');
  return (el?.textContent ?? '').replace(/\s+/g, '').replace(/^@/, '');
}

function avatar(thread: Element): string | null {
  const img = own<HTMLImageElement>(thread, 'img.avatar, img.avatar-user, img[data-testid="github-avatar"], img[class*="Avatar"]');
  const src = img?.getAttribute('src') ?? '';
  return src.startsWith('https://') ? src : null;
}

export function threadItem(thread: Element): ThreadItem {
  return {
    el: thread,
    path: threadPath(thread),
    excerpt: excerpt(firstBody(thread)),
    author: author(thread),
    avatar: avatar(thread),
    outdated: isOutdated(thread),
  };
}

/** Unresolved threads of the current tab, in document order. */
export function buildThreadItems(root: ParentNode = document): ThreadItem[] {
  return collectUnresolvedThreads(root).map(threadItem);
}
