// Better GHub - Multi-token helpers for the extension pages (pure, no DOM).
//
// A fine-grained token reads the PRIVATE repositories of exactly one owner
// (the user or one organization) plus every public repository, so people who
// work across organizations store one token per organization. These helpers
// describe the stored tokens (coverage, expiry, problems) and build the
// prefilled "new token" link for GitHub.

import type { TokenKind, TokenSummary } from '../core/messages';
import { t } from '../i18n';
import { absoluteDate, plural, timeUntil, toEpochMs } from './format';

const DAY = 24 * 60 * 60 * 1000;

/** Tokens expiring within this many days are highlighted. */
export const EXPIRY_WARNING_DAYS = 7;

/** GitHub caps personal access token names at 40 characters. */
export const TOKEN_NAME_MAX = 40;

export const NEW_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

/** GitHub user / organization login. */
export const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

// ------------------------------------------------------------------ owners

/**
 * Organization typed (or pasted) by the user → login. Accepts "acme",
 * "@acme" and github.com URLs. '' when empty, null when it can't be a login.
 */
export function normalizeOwner(raw: string | null | undefined): string | null {
  let s = (raw ?? '').trim();
  s = s.replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\/(?:orgs\/)?/i, '');
  s = s.replace(/^@/, '').replace(/\/.*$/, '');
  if (!s) return '';
  return LOGIN_RE.test(s) ? s : null;
}

// ------------------------------------------------------------ prefill link

/** "Better GHub – acme", capped at GitHub's 40-character limit. */
export function tokenName(owner: string): string {
  const name = owner ? `Better GHub – ${owner}` : 'Better GHub';
  const chars = Array.from(name);
  return chars.length <= TOKEN_NAME_MAX ? name : `${chars.slice(0, TOKEN_NAME_MAX - 1).join('')}…`;
}

/**
 * GitHub's "new fine-grained token" page, prefilled with a name, a short
 * description, the resource owner (omitted when empty → GitHub defaults to
 * the user), a 90-day expiry and read-only access to pull requests, contents
 * and metadata.
 */
export function tokenPrefillUrl(
  org: string,
  description = t('tokensPrefillDescription', 'Read-only pull request insights on github.com')
): string {
  const owner = normalizeOwner(org) || '';
  const params: [string, string][] = [
    ['name', tokenName(owner)],
    ['description', description],
  ];
  if (owner) params.push(['target_name', owner]);
  params.push(['expires_in', '90'], ['pull_requests', 'read'], ['contents', 'read'], ['metadata', 'read']);
  return `${NEW_TOKEN_URL}?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

// ---------------------------------------------------------------- labels

export function tokenKindName(kind: TokenKind): string {
  if (kind === 'fine-grained') return t('tokensKindFineGrained', 'Fine-grained');
  if (kind === 'classic') return t('tokensKindClassic', 'Classic');
  return t('tokensKindOther', 'Other');
}

/** "…a1b2" from the last characters the background exposes. */
export function tokenHint(hint: string): string {
  return hint ? `…${hint}` : '';
}

/** What a token can read, e.g. "Private repos: acme, octo-org". */
export function coverageText(token: Pick<TokenSummary, 'owners' | 'publicOnly'>): string {
  if (token.owners === null) return t('tokensCoverageAll', 'All your organizations');
  if (token.owners.length) return t('tokensCoveragePrivate', 'Private repos: $1', token.owners.join(', '));
  return t('tokensCoveragePublicOnly', 'Public repositories only — pending organization approval?');
}

/** True when the token reaches every owner the account can access. */
export function coversAllOwners(token: Pick<TokenSummary, 'owners'>): boolean {
  return token.owners === null;
}

// ---------------------------------------------------------------- expiry

export type ExpiryTone = 'muted' | 'attention' | 'danger';

export interface ExpiryInfo {
  text: string;
  tone: ExpiryTone;
  /** Absolute date for a tooltip ('' without an expiry). */
  date: string;
}

export function expiryInfo(expiresAt: string | null | undefined, now = Date.now(), locale?: string): ExpiryInfo {
  const ms = toEpochMs(expiresAt);
  if (!Number.isFinite(ms)) return { text: t('tokensNoExpiry', 'No expiration'), tone: 'muted', date: '' };
  const date = absoluteDate(ms, locale);
  if (ms <= now) return { text: t('tokensExpired', 'Expired'), tone: 'danger', date };
  return {
    text: t('tokensExpiresIn', 'Expires $1', timeUntil(ms, now, locale)),
    tone: ms - now <= EXPIRY_WARNING_DAYS * DAY ? 'attention' : 'muted',
    date,
  };
}

/** A problem GitHub reported, or an expiry within EXPIRY_WARNING_DAYS (or past). */
export function tokenNeedsAttention(token: Pick<TokenSummary, 'problem' | 'expiresAt'>, now = Date.now()): boolean {
  if (token.problem) return true;
  const ms = toEpochMs(token.expiresAt);
  return Number.isFinite(ms) && ms - now <= EXPIRY_WARNING_DAYS * DAY;
}

// ---------------------------------------------------------------- summary

/** Owners shown before "+N" in the compact popup summary. */
const SUMMARY_OWNERS = 3;

/** Compact "2 tokens · acme, octo-org" / "1 token · all organizations". */
export function tokensSummary(tokens: Pick<TokenSummary, 'owners' | 'publicOnly'>[], locale?: string): string {
  const count = plural('tokensCount', tokens.length, { one: '$1 token', other: '$1 tokens' }, locale);
  let coverage: string;
  if (tokens.some(coversAllOwners)) {
    coverage = t('tokensSummaryAll', 'all organizations');
  } else {
    const owners: string[] = [];
    for (const token of tokens) {
      for (const owner of token.owners ?? []) if (!owners.includes(owner)) owners.push(owner);
    }
    if (!owners.length) {
      coverage = t('tokensSummaryPublic', 'public repositories only');
    } else {
      const shown = owners.slice(0, SUMMARY_OWNERS);
      if (owners.length > SUMMARY_OWNERS) shown.push(t('tokensSummaryMore', '+$1', String(owners.length - SUMMARY_OWNERS)));
      coverage = shown.join(', ');
    }
  }
  return t('tokensSummaryLine', '$1 · $2', [count, coverage]);
}

// ----------------------------------------------------------------- errors

/**
 * For a 'different-account' error, the other account's login when the
 * background included it ('different-account:octocat'), else ''. undefined
 * for any other error.
 */
export function differentAccountLogin(error: string | null | undefined): string | undefined {
  const m = /^different-account(?:[:\s]+@?([A-Za-z0-9][A-Za-z0-9-]{0,38}))?$/i.exec((error ?? '').trim());
  if (!m) return undefined;
  return m[1] ?? '';
}
