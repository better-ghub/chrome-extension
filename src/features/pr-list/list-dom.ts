// Better GHub - Adapter for GitHub's React pull request list.
//
// Verified structure (Nov 2026, /<owner>/<repo>/pulls). Class names are
// CSS-module hashes (e.g. `listItem__X41oTe`) that change with every GitHub
// deploy, so only data-testid / data-* attributes and structure are used:
//
//   ul[data-listview-component="items-list"] > li            (25 per page)
//     div[data-listview-item-title-container]
//       a[data-testid="listitem-title-link"][data-hovercard-type="pull_request"]
//     <meta line>   = parent of [data-testid="timestamp-container"]
//                     ("#123", author link, <relative-time>, review/checks)
//   The meta line's parent is the row's main-content column; our chip row is
//   inserted right after the meta line.

import { parsePRUrl } from '../../core/page';
import { prKey, type PRRef } from './query';

export const LIST_SELECTOR = 'ul[data-listview-component="items-list"]';
const TITLE_LINK = 'a[data-testid="listitem-title-link"]';
const TIMESTAMP = '[data-testid="timestamp-container"]';
const TITLE_CONTAINER = '[data-listview-item-title-container]';
export const SLOT_CLASS = 'bghub-prl-slot';

export interface RowInfo {
  li: HTMLLIElement;
  ref: PRRef;
  /** Our chip row goes right after this element. */
  anchor: Element;
}

export function findList(root: ParentNode = document): HTMLUListElement | null {
  return root.querySelector<HTMLUListElement>(LIST_SELECTOR);
}

export function listRows(list: HTMLUListElement): HTMLLIElement[] {
  return [...list.children].filter((c): c is HTMLLIElement => c instanceof HTMLLIElement);
}

export function parseRow(li: HTMLLIElement): RowInfo | null {
  const link = li.querySelector<HTMLAnchorElement>(TITLE_LINK);
  const pr = link ? parsePRUrl(link.getAttribute('href') ?? '') : null;
  if (!pr) return null;
  const anchor = li.querySelector(TIMESTAMP)?.parentElement ?? li.querySelector(TITLE_CONTAINER);
  if (!anchor) return null;
  return { li, anchor, ref: { ...pr, key: prKey(pr.owner, pr.repo, pr.number) } };
}

export function findSlot(li: HTMLLIElement): HTMLElement | null {
  return li.querySelector<HTMLElement>(`.${SLOT_CLASS}`);
}

/** Current GitHub user (empty when logged out) — no API call needed. */
export function viewerLogin(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="user-login"]')?.content ?? '';
}
