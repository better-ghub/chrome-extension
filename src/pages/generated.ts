// Better GHub - "Generated file" path patterns and the checkout command
// preview for the Options page (pure). Matching itself lives in
// src/core/generated-patterns.ts so Options and the Files tab never disagree.
//
// Pattern syntax (same rules as the Files tab on github.com):
//   *    any characters except '/'
//   **   any path (may span '/')
//   no '/' in the pattern → matched against the file name, at any depth
//   with a '/'           → matched at any directory boundary ("dist/**"
//                           matches "dist/a.js" and "packages/x/dist/a.js")
//   a leading '/'        → anchored at the repository root

import { checkoutCommand, firstMatchingPattern } from '../core/generated-patterns';

/** Same limits the settings module applies when reading the list. */
export const MAX_PATTERNS = 100;
export const MAX_PATTERN_LENGTH = 200;

/** The first pattern that marks `path` as generated, or null (same matcher as the Files tab). */
export function matchGenerated(path: string, patterns: readonly string[]): string | null {
  return firstMatchingPattern(path, patterns);
}

export function isGeneratedPath(path: string, patterns: readonly string[]): boolean {
  return firstMatchingPattern(path, patterns) !== null;
}

/** Textarea → pattern list: one per line, trimmed, blanks and duplicates dropped, capped. */
export function parsePatterns(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const p = line.trim();
    if (!p || p.length > MAX_PATTERN_LENGTH || out.includes(p)) continue;
    out.push(p);
    if (out.length >= MAX_PATTERNS) break;
  }
  return out;
}

export function samePatterns(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((p, i) => p === b[i]);
}

// ------------------------------------------------------------- checkout

/** What "Copy checkout command" copies for pull request `number`. */
export function checkoutCommandFor(kind: 'gh' | 'git', number: number): string {
  return checkoutCommand(number, kind);
}
