// Better GHub - Token pre-validation and auth error classification.
//
// The popup/options never talk to GitHub directly: the background validates
// the token. These helpers only catch obvious paste mistakes before a network
// round trip and map background errors to friendly, specific messages.

export type TokenFormatIssue = 'empty' | 'whitespace' | 'not-pat' | 'prefix' | 'characters' | 'length' | null;

export interface TokenCheck {
  /** The token as it will be sent (trimmed, surrounding quotes removed). */
  token: string;
  issue: TokenFormatIssue;
}

/** Personal access token prefixes the extension accepts. */
export const FINE_GRAINED_PREFIX = 'github_pat_';
export const CLASSIC_PREFIX = 'ghp_';

/** GitHub token prefixes that are NOT personal access tokens (OAuth, app, refresh…). */
const OTHER_GITHUB_PREFIXES = /^(gho|ghu|ghs|ghr)_/;

/** Shortest plausible PAT: classic tokens are exactly 40 chars, fine-grained ~93. */
export const MIN_TOKEN_LENGTH = 40;

export function checkTokenFormat(raw: string): TokenCheck {
  let token = raw.trim();
  // People often paste tokens copied from a JSON/env file with quotes around them.
  const quoted = /^(['"`])(.*)\1$/.exec(token);
  if (quoted) token = quoted[2].trim();

  if (!token) return { token, issue: 'empty' };
  if (/\s/.test(token)) return { token, issue: 'whitespace' };
  if (OTHER_GITHUB_PREFIXES.test(token)) return { token, issue: 'not-pat' };
  if (!token.startsWith(FINE_GRAINED_PREFIX) && !token.startsWith(CLASSIC_PREFIX)) return { token, issue: 'prefix' };
  if (!/^[A-Za-z0-9_]+$/.test(token)) return { token, issue: 'characters' };
  if (token.length < MIN_TOKEN_LENGTH) return { token, issue: 'length' };
  return { token, issue: null };
}

export function tokenKindOf(token: string): 'fine-grained' | 'classic' | 'unknown' {
  if (token.startsWith(FINE_GRAINED_PREFIX)) return 'fine-grained';
  if (token.startsWith(CLASSIC_PREFIX)) return 'classic';
  return 'unknown';
}

/** Sentinel errors produced by the pages themselves (never by the background). */
export const ERROR_UNAVAILABLE = 'bghub:background-unavailable';
export const ERROR_TIMEOUT = 'bghub:timeout';

export type AuthErrorKind = 'invalid' | 'network' | 'rate-limited' | 'permissions' | 'unavailable' | 'unknown';

/**
 * Classify the background's human-readable auth error. The contract only says
 * it "distinguishes invalid (401) vs network", so match generously on wording
 * and status codes.
 */
export function classifyAuthError(error: string | undefined | null): AuthErrorKind {
  if (!error) return 'unknown';
  if (error === ERROR_UNAVAILABLE) return 'unavailable';
  if (error === ERROR_TIMEOUT) return 'network';
  const e = error.toLowerCase();
  if (/rate.?limit|secondary limit|\b429\b/.test(e)) return 'rate-limited';
  if (/\b401\b|invalid|bad credentials|unauthori[sz]ed|expired|revoked|rejected/.test(e)) return 'invalid';
  if (/\b403\b|forbidden|permission|scope|saml|sso/.test(e)) return 'permissions';
  if (/network|fetch|offline|timeout|timed out|connect|unreachable|\b5\d\d\b|dns|internet/.test(e)) return 'network';
  return 'unknown';
}
