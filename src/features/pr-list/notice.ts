// Better GHub - Which message the PR list's top bar shows when activity can't
// be loaded (pure, so the priority rules are unit-tested).

export type ListNotice =
  /** GitHub's rate limit: activity paused until `until` (epoch ms). */
  | { kind: 'rate-limited'; until: number }
  /** A stored (classic) token needs SAML SSO authorization for `owner`. */
  | { kind: 'sso'; owner: string; url: string }
  /** No stored token can read private data of `owner`: offer to add one. */
  | { kind: 'needs-token'; owner: string }
  /** The token/SSO notice was dismissed for this page view: show nothing in its place. */
  | { kind: 'dismissed' }
  /** GitHub answered but nothing in this repository is readable (generic). */
  | { kind: 'no-access' };

export interface ListNoticeInput {
  now: number;
  rateLimitedUntil: number;
  ssoUrl: string | null;
  /** Owner from the background's `needsToken`. */
  needsToken: string | null;
  accessError: string | null;
  /** Repository owner as written in the page URL. */
  pageOwner: string;
  hasModels: boolean;
  busy: boolean;
  tokenNoticeDismissed: boolean;
}

/** The owner as written in the page URL when it is the same login (the background lower-cases). */
export function displayOwner(owner: string | null, pageOwner: string): string {
  if (!owner || owner.toLowerCase() === pageOwner.toLowerCase()) return pageOwner;
  return owner;
}

/**
 * Priority: rate limit (nothing works until it resets) → SSO authorization
 * (an existing token would work) → missing token → generic "can't read".
 * null = no notice (show the activity summary).
 */
export function pickListNotice(s: ListNoticeInput): ListNotice | null {
  if (s.rateLimitedUntil > s.now) return { kind: 'rate-limited', until: s.rateLimitedUntil };
  if (s.ssoUrl || s.needsToken) {
    if (s.tokenNoticeDismissed) return { kind: 'dismissed' };
    const owner = displayOwner(s.needsToken, s.pageOwner);
    return s.ssoUrl ? { kind: 'sso', owner, url: s.ssoUrl } : { kind: 'needs-token', owner };
  }
  if (s.accessError && !s.hasModels && !s.busy) return { kind: 'no-access' };
  return null;
}
