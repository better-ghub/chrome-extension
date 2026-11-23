// Better GHub - Pure helpers for the background API layer (unit-tested).

export const API_ORIGIN = 'https://api.github.com';

/**
 * Validate a REST path from another context. Only same-origin relative paths
 * ("/repos/o/r/pulls?per_page=5") are allowed: no absolute URLs, no
 * protocol-relative "//host", and no backslashes (the URL parser treats "\" as
 * "/" for https URLs, so "/\evil.com" would otherwise escape api.github.com).
 * Returns the normalized path + query, or null when rejected.
 */
export function validateRestPath(path: unknown): string | null {
  if (typeof path !== 'string' || path.length === 0 || path.length > 2048) return null;
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  if (/[\s\\]/.test(path)) return null;
  try {
    const url = new URL(path, API_ORIGIN);
    if (url.origin !== API_ORIGIN) return null;
    return url.pathname + url.search;
  } catch {
    return null;
  }
}

/**
 * The GraphQL document with comments and string literals replaced by spaces,
 * in ONE left-to-right pass (a "#" inside a string is not a comment and a
 * quote inside a comment is not a string; stripping them separately can hide
 * code). Returns null for an unterminated string.
 */
export function stripGraphQL(doc: string): string | null {
  let out = '';
  let i = 0;
  while (i < doc.length) {
    const ch = doc[i];
    if (ch === '#') {
      while (i < doc.length && doc[i] !== '\n' && doc[i] !== '\r') i++;
      out += ' ';
    } else if (doc.startsWith('"""', i)) {
      // Block string: only \""" escapes the delimiter.
      let j = i + 3;
      while (j < doc.length && !doc.startsWith('"""', j)) j += doc.startsWith('\\"""', j) ? 4 : 1;
      if (j >= doc.length) return null;
      i = j + 3;
      out += ' ';
    } else if (ch === '"') {
      let j = i + 1;
      while (j < doc.length && doc[j] !== '"') {
        if (doc[j] === '\\') j++; // the escaped character is part of the string
        if (doc[j] === '\n' || doc[j] === '\r') return null; // strings cannot span lines
        j++;
      }
      if (j >= doc.length) return null;
      i = j + 1;
      out += ' ';
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

const WRITE_KEYWORD = /(^|[^_0-9A-Za-z])(mutation|subscription)(?![_0-9A-Za-z])/i;

/** True when a GraphQL document may contain a mutation (never cached). Unparseable counts as one. */
export function isMutation(query: string): boolean {
  const code = stripGraphQL(query);
  return code === null || WRITE_KEYWORD.test(code);
}

/**
 * Strict allow-list for documents from content scripts: after comments and
 * strings are stripped, the document must start with the `query` keyword
 * (commas and the BOM are insignificant in GraphQL, like whitespace) and must
 * not contain `mutation` / `subscription` anywhere, in any letter case.
 */
export function isReadOnlyQuery(query: unknown): boolean {
  if (typeof query !== 'string') return false;
  const code = stripGraphQL(query);
  if (code === null || WRITE_KEYWORD.test(code)) return false;
  return /^query(?![_0-9A-Za-z])/.test(code.replace(/^[\s,\uFEFF]+/, ''));
}

/** cyrb53: fast, well-distributed 53-bit string hash (cache keys, not security). */
export function hashString(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Stable JSON (sorted object keys) so equal variables hash equally. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

/**
 * Accepted token formats: fine-grained (github_pat_), classic PAT (ghp_),
 * OAuth / app tokens (gho_, ghu_, ghs_, ghr_), and pre-2021 40-hex tokens.
 */
export function isTokenFormatValid(token: string): boolean {
  return /^(github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|[a-f0-9]{40})$/.test(token);
}

export { tokenKindOf } from './token-model';

/** Parse a response body defensively: empty (204) and HTML bodies yield undefined. */
export function parseJsonBody(text: string): unknown {
  if (!text) return undefined;
  const first = text.trimStart()[0];
  if (first !== '{' && first !== '[') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** `message` field of a GitHub error body, if any. */
export function bodyMessage(body: unknown): string {
  if (body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string') {
    return (body as { message: string }).message;
  }
  return '';
}
