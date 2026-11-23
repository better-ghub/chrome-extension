// Better GHub - PR page: fuzzy file matching for the file finder (pure).

export interface FinderFile {
  path: string;
  generated: boolean;
}

export interface FinderMatch {
  file: FinderFile;
  score: number;
  /** Indices into `file.path` of the matched characters (for highlighting). */
  positions: number[];
}

const SEPARATORS = '/._- ';

/**
 * Greedy left-to-right subsequence match of `query` in `text[from..]`.
 * Returns matched indices or null. Prefers word starts and runs.
 */
function subsequence(query: string, text: string, from: number): number[] | null {
  const positions: number[] = [];
  let pos = from;
  for (const ch of query) {
    let found = -1;
    // Prefer a boundary hit when one is close; otherwise the first occurrence.
    for (let i = text.indexOf(ch, pos); i !== -1; i = text.indexOf(ch, i + 1)) {
      if (found === -1) found = i;
      const prev = i === 0 ? '/' : text[i - 1];
      if (i === pos || SEPARATORS.includes(prev)) {
        found = i;
        break;
      }
      if (i - pos > 6) break;
    }
    if (found === -1) return null;
    positions.push(found);
    pos = found + 1;
  }
  return positions;
}

function scorePositions(positions: number[], text: string, offset: number): number {
  let score = 0;
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    const prev = p === 0 ? '/' : text[p - 1];
    score += 10;
    if (SEPARATORS.includes(prev)) score += 8;
    if (i > 0) {
      const gap = p - positions[i - 1] - 1;
      score += gap === 0 ? 12 : -Math.min(gap, 6);
    }
  }
  if (positions[0] === offset) score += 10;
  return score - Math.floor((text.length - offset) / 8);
}

/** Score `query` against a path; null = no match. Basename hits outrank directory hits. */
export function matchPath(query: string, path: string): { score: number; positions: number[] } | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return { score: 0, positions: [] };
  const lower = path.toLowerCase();
  const base = path.lastIndexOf('/') + 1;
  const name = lower.slice(base);

  if (name === q) return { score: 1000, positions: range(base, q.length) };
  if (name.startsWith(q)) return { score: 600 - name.length, positions: range(base, q.length) };
  const idx = name.indexOf(q);
  if (idx !== -1) return { score: 400 - name.length + (SEPARATORS.includes(name[idx - 1] ?? '/') ? 40 : 0), positions: range(base + idx, q.length) };

  const inName = subsequence(q, lower, base);
  if (inName) return { score: 200 + scorePositions(inName, lower, base), positions: inName };

  const inPath = subsequence(q, lower, 0);
  if (inPath) return { score: scorePositions(inPath, lower, 0), positions: inPath };
  return null;
}

function range(start: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => start + i);
}

/** Matching files, best first (stable: ties keep diff order). Empty query → all files. */
export function rankFiles(query: string, files: readonly FinderFile[], limit = 200): FinderMatch[] {
  const out: (FinderMatch & { i: number })[] = [];
  files.forEach((file, i) => {
    const m = matchPath(query, file.path);
    if (m) out.push({ file, score: m.score, positions: m.positions, i });
  });
  out.sort((a, b) => b.score - a.score || a.i - b.i);
  return out.slice(0, limit);
}
