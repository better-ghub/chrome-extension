// Better GHub - per-repo review checklist: templates, matching and tick storage (pure).

export interface ChecklistTemplate {
  /** `owner/repo`, `owner/*` or `*` (lower-cased). */
  pattern: string;
  items: string[];
}

export const MAX_ITEMS = 30;
export const MAX_ITEM_LENGTH = 200;
export const MAX_TEMPLATES = 50;

const PATTERN_RE = /^(\*|[a-z0-9][a-z0-9-]*\/(\*|[a-z0-9._-]+))$/;

export function normalizePattern(raw: string): string | null {
  const p = raw.trim().toLowerCase();
  return PATTERN_RE.test(p) ? p : null;
}

function cleanItems(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const items = raw
    .filter((i): i is string => typeof i === 'string')
    .map((i) => i.trim().slice(0, MAX_ITEM_LENGTH))
    .filter(Boolean);
  return items.slice(0, MAX_ITEMS);
}

/** Validate untrusted storage content; invalid or empty templates and duplicate patterns are dropped. */
export function sanitizeTemplates(raw: unknown): ChecklistTemplate[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ChecklistTemplate[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as { pattern?: unknown; items?: unknown };
    const pattern = typeof e.pattern === 'string' ? normalizePattern(e.pattern) : null;
    const items = cleanItems(e.items);
    if (!pattern || !items.length || seen.has(pattern)) continue;
    seen.add(pattern);
    out.push({ pattern, items });
    if (out.length >= MAX_TEMPLATES) break;
  }
  return out;
}

export function sameTemplates(a: readonly ChecklistTemplate[], b: readonly ChecklistTemplate[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Most specific match wins: `owner/repo`, then `owner/*`, then `*`. */
export function pickTemplate(templates: readonly ChecklistTemplate[], owner: string, repo: string): ChecklistTemplate | null {
  const o = owner.toLowerCase();
  const full = `${o}/${repo.toLowerCase()}`;
  return (
    templates.find((t) => t.pattern === full) ?? templates.find((t) => t.pattern === `${o}/*`) ?? templates.find((t) => t.pattern === '*') ?? null
  );
}

/**
 * Editor text: a `[pattern]` line starts a template, every other non-empty
 * line (optionally prefixed with `- `) is an item of the current template.
 */
export function parseChecklistText(text: string): ChecklistTemplate[] {
  const drafts: { pattern: string; items: string[] }[] = [];
  let current: { pattern: string; items: string[] } | null = null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const header = /^\[(.*)\]$/.exec(trimmed);
    if (header) {
      const pattern = normalizePattern(header[1]);
      current = pattern ? { pattern, items: [] } : null;
      if (current) drafts.push(current);
      continue;
    }
    current?.items.push(trimmed.replace(/^[-*]\s+/, ''));
  }
  return sanitizeTemplates(drafts);
}

export function formatChecklistText(templates: readonly ChecklistTemplate[]): string {
  return templates.map((t) => `[${t.pattern}]\n${t.items.map((i) => `- ${i}`).join('\n')}`).join('\n\n');
}

// ---------------------------------------------------------------- ticks

export interface TickRecord {
  /** Ticked item texts (survives reordering/editing of other items). */
  done: string[];
  at: number;
}
export type TickMap = Record<string, TickRecord>;

export const TICKS_STORAGE_KEY = 'bghub:checklistTicks';
export const MAX_TICK_PRS = 300;
export const TICK_MAX_AGE_MS = 120 * 24 * 60 * 60 * 1000;

export function tickKey(owner: string, repo: string, number: number): string {
  return `${owner}/${repo}#${number}`.toLowerCase();
}

export function parseTicks(raw: unknown): TickMap {
  const out: TickMap = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    const r = v as Partial<TickRecord> | null;
    if (r && Array.isArray(r.done) && typeof r.at === 'number' && Number.isFinite(r.at)) {
      out[key] = { done: r.done.filter((d): d is string => typeof d === 'string').slice(0, MAX_ITEMS), at: r.at };
    }
  }
  return out;
}

export function pruneTicks(ticks: TickMap, now: number): TickMap {
  const fresh = Object.entries(ticks).filter(([, v]) => now - v.at <= TICK_MAX_AGE_MS);
  fresh.sort((a, b) => b[1].at - a[1].at);
  return Object.fromEntries(fresh.slice(0, MAX_TICK_PRS));
}

/** Map with `done` stored for `key` (an empty list removes the entry), pruned. */
export function recordTicks(ticks: TickMap, key: string, done: string[], now: number): TickMap {
  const next = { ...ticks };
  if (done.length) next[key] = { done, at: now };
  else delete next[key];
  return pruneTicks(next, now);
}

/** Ticked texts that still exist in `items`. */
export function doneFor(record: TickRecord | undefined, items: readonly string[]): Set<string> {
  return new Set((record?.done ?? []).filter((d) => items.includes(d)));
}
