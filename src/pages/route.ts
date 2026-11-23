// Better GHub - Options page hash routing (pure).

export const SECTIONS = ['account', 'pr-list', 'files', 'templates', 'dashboard', 'shortcuts', 'notifications', 'language', 'about'] as const;

export type SectionId = (typeof SECTIONS)[number];

export interface Route {
  section: SectionId;
  /** `#welcome` (opened by the background after install): show the onboarding hero. */
  welcome: boolean;
  /**
   * `#add-token/<owner>` (from the "Add token" notice on GitHub): open Account
   * with the add-token form expanded and prefilled with <owner> ('' when the
   * hash names no valid owner). Absent for every other route.
   */
  addTokenFor?: string;
}

/** Hash prefix of the add-token route. */
export const ADD_TOKEN_ROUTE = 'add-token';

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** Hash for the add-token route, e.g. "add-token/acme". */
export function addTokenHash(owner: string): string {
  return OWNER_RE.test(owner) ? `${ADD_TOKEN_ROUTE}/${owner}` : ADD_TOKEN_ROUTE;
}

/** Old/alternative hashes that should keep working. */
const ALIASES: Record<string, SectionId> = {
  auth: 'account',
  authorization: 'account',
  token: 'account',
  prs: 'pr-list',
  'pull-requests': 'pr-list',
  'pr-lists': 'pr-list',
  'files-changed': 'files',
  generated: 'files',
  snippets: 'templates',
  'comment-templates': 'templates',
  checkout: 'files',
  keyboard: 'shortcuts',
  'keyboard-shortcuts': 'shortcuts',
  badge: 'notifications',
  data: 'language',
  cache: 'language',
  settings: 'language',
};

export function parseRoute(hash: string): Route {
  const raw = decodeURIComponentSafe(hash.replace(/^#\/?/, '')).trim();
  const id = raw.toLowerCase();
  if (id === ADD_TOKEN_ROUTE || id.startsWith(`${ADD_TOKEN_ROUTE}/`)) {
    // Keep the owner's case as written (GitHub logins are case-insensitive).
    const owner = raw.slice(ADD_TOKEN_ROUTE.length + 1).replace(/^@/, '').replace(/\/+$/, '');
    return { section: 'account', welcome: false, addTokenFor: OWNER_RE.test(owner) ? owner : '' };
  }
  if (id === 'welcome') return { section: 'account', welcome: true };
  if ((SECTIONS as readonly string[]).includes(id)) return { section: id as SectionId, welcome: false };
  return { section: ALIASES[id] ?? 'account', welcome: false };
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
