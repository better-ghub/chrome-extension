// Better GHub - PR page: "changes since your last visit" bookkeeping (pure).

export interface VisitRecord {
  /** Head commit SHA seen on the last visit. */
  sha: string;
  /** Epoch ms of that visit. */
  at: number;
}

export type VisitMap = Record<string, VisitRecord>;

export const VISITS_STORAGE_KEY = 'bghub:lastVisits';
export const MAX_VISITS = 500;
export const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export function visitKey(owner: string, repo: string, number: number): string {
  return `${owner}/${repo}#${number}`.toLowerCase();
}

/** Validate untrusted storage content; unusable entries are dropped. */
export function parseVisits(raw: unknown): VisitMap {
  const out: VisitMap = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    const r = v as Partial<VisitRecord> | null;
    if (r && typeof r.sha === 'string' && /^[0-9a-f]{7,64}$/i.test(r.sha) && typeof r.at === 'number' && Number.isFinite(r.at)) {
      out[key] = { sha: r.sha, at: r.at };
    }
  }
  return out;
}

/** Drop entries older than 90 days, then the oldest ones beyond the cap. */
export function pruneVisits(visits: VisitMap, now: number): VisitMap {
  const fresh = Object.entries(visits).filter(([, v]) => now - v.at <= MAX_AGE_MS);
  fresh.sort((a, b) => b[1].at - a[1].at);
  return Object.fromEntries(fresh.slice(0, MAX_VISITS));
}

/** Map with `key` recorded as seen at `sha` / `now` (pruned). */
export function recordVisit(visits: VisitMap, key: string, sha: string, now: number): VisitMap {
  return pruneVisits({ ...visits, [key]: { sha, at: now } }, now);
}

/** The previous record when it names a different head commit, else null. */
export function changedSince(prev: VisitRecord | undefined | null, head: string): VisitRecord | null {
  return prev && prev.sha.toLowerCase() !== head.toLowerCase() ? prev : null;
}

export type CompareOutcome = { kind: 'commits'; count: number } | { kind: 'rewritten' } | { kind: 'none' };

/** Interpret a GitHub compare response (`old...new`). Failure (null) means the old commit is gone. */
export function interpretCompare(data: unknown): CompareOutcome {
  if (!data || typeof data !== 'object') return { kind: 'rewritten' };
  const d = data as { status?: unknown; total_commits?: unknown; ahead_by?: unknown };
  if (d.status === 'identical') return { kind: 'none' };
  const count = typeof d.total_commits === 'number' ? d.total_commits : typeof d.ahead_by === 'number' ? d.ahead_by : null;
  if (d.status === 'ahead' && count !== null && count > 0) return { kind: 'commits', count };
  return { kind: 'rewritten' };
}

/** `/o/r/pull/n/files/<old>..<new>` (short SHAs are enough for GitHub). */
export function rangeFilesPath(owner: string, repo: string, number: number, oldSha: string, newSha: string): string {
  return `/${owner}/${repo}/pull/${number}/files/${oldSha.slice(0, 12)}..${newSha.slice(0, 12)}`;
}

export function filesTabPath(owner: string, repo: string, number: number): string {
  return `/${owner}/${repo}/pull/${number}/files`;
}

/** "2 hours ago" style text; locale-aware via Intl, English fallback. */
export function relativeTime(then: number, now: number, locale = 'en'): string {
  const sec = Math.round((then - now) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  let fmt: Intl.RelativeTimeFormat;
  try {
    fmt = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  } catch {
    fmt = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  }
  for (const [unit, size] of units) {
    if (Math.abs(sec) >= size) return fmt.format(Math.round(sec / size), unit);
  }
  return fmt.format(Math.min(sec, 0), 'second');
}
