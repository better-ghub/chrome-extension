// Better GHub - PR page: switch PR tabs (Conversation / Commits / Checks / Files changed).

import type { PageContext, PRTab } from '../../../core/page';
import { t } from '../../../i18n';
import { isUserContent } from '../dom-queries';
import { tabName } from '../labels';
import type { ActionContext } from './types';

const TAB_SUFFIXES: Record<PRTab, readonly string[]> = {
  conversation: [''],
  commits: ['/commits'],
  checks: ['/checks'],
  // Classic "Files changed" lives on /files, the React experience on /changes.
  files: ['/files', '/changes'],
};

/** Tab navigation containers across GitHub UI generations. */
const TAB_LINKS = 'nav[aria-label*="ull request"] a[href], .tabnav-tabs a[href], a.tabnav-tab[href], [role="tablist"] a[href]';

const normPath = (p: string): string => p.replace(/\/+$/, '').toLowerCase();

export function tabPaths(page: Pick<PageContext, 'owner' | 'repo' | 'number'>, tab: PRTab): string[] {
  const base = `/${page.owner}/${page.repo}/pull/${page.number}`;
  return TAB_SUFFIXES[tab].map((s) => normPath(base + s));
}

/** Exact tab check: /pull/1/commits/<sha> is not the Commits tab, /pull/1/files/<range> not Files. */
export function isOnTab(pathname: string, page: Pick<PageContext, 'owner' | 'repo' | 'number'>, tab: PRTab): boolean {
  return tabPaths(page, tab).includes(normPath(pathname));
}

function linkPath(a: HTMLAnchorElement): string | null {
  try {
    const u = new URL(a.getAttribute('href') ?? '', location.href);
    return u.origin === location.origin ? normPath(u.pathname) : null;
  } catch {
    return null;
  }
}

/** The tab's own link, so a click lets Turbo/React navigate without a full reload. */
export function findTabLink(root: ParentNode, paths: readonly string[]): HTMLAnchorElement | null {
  const matches = (a: HTMLAnchorElement): boolean => {
    const p = linkPath(a);
    return !!p && paths.includes(p);
  };
  const inNav = Array.from(root.querySelectorAll<HTMLAnchorElement>(TAB_LINKS)).find(matches);
  if (inNav) return inNav;
  return Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]')).find((a) => !isUserContent(a) && matches(a)) ?? null;
}

export function gotoTab(ctx: ActionContext, tab: PRTab): void {
  const { page } = ctx;
  if (!page.owner || !page.repo || !page.number) return;
  if (isOnTab(location.pathname, page, tab)) {
    ctx.toasts.show(t('prPageAlreadyOnTab', "You're already on $1", tabName(tab)), { variant: 'info', binding: ctx.binding, id: 'goto' });
    return;
  }
  const paths = tabPaths(page, tab);
  const link = findTabLink(document, paths);
  if (link) link.click();
  else location.assign(`/${page.owner}/${page.repo}/pull/${page.number}${TAB_SUFFIXES[tab][0]}`);
}
