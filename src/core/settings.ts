// Better GHub - Settings
//
// Single source of truth for every user preference stored in
// chrome.storage.sync (falling back to .local, see settings-storage.ts): key names, types and defaults. Content scripts, the
// background worker, popup and options all go through this module so a setting
// can never be written under one key and read under another.
//
// The GitHub token is deliberately NOT part of Settings and NOT in
// chrome.storage (content scripts can read that): the background worker keeps
// it in the extension origin's IndexedDB under TOKEN_KEY (see
// background/secret-store.ts). Other contexts ask the background to make API
// calls and never see it.

import { sanitizeTemplates, type ChecklistTemplate } from './checklist-model';
import { SHORTCUTS_ENABLED_KEY, SHORTCUTS_STORAGE_KEY } from '../shortcuts';
import { isSettingsArea, LOCAL_ONLY_KEY, readSettingItems, removeSettingItems, writeSettingItems } from './settings-storage';

export type Language = 'system' | 'en' | 'pl';

export interface Settings {
  /** UI language; 'system' follows the browser. */
  language: Language;
  /** Master switch for keyboard shortcuts on PR pages. */
  shortcutsEnabled: boolean;
  /** Raw stored bindings — always run through normalizeBindings() before use. */
  shortcutBindings: unknown;
  /** Floating keyboard hint button on PR pages. */
  shortcutHintEnabled: boolean;
  /** Activity chips under every row of the pull request list. */
  prListEnabled: boolean;
  /** Path-based label suggestions in the PR list (needs-tests, docs, ...). */
  suggestedLabelsEnabled: boolean;
  /** "Your pull requests" widget on the github.com dashboard. */
  dashboardEnabled: boolean;
  /** Toolbar badge with the number of updated PRs. */
  notificationsEnabled: boolean;
  /** Minutes between background inbox refreshes. */
  notificationInterval: number;
  /** Minutes PR data is cached before it is refetched. */
  cacheDuration: number;

  // ---- Files changed tab -------------------------------------------------
  /** Collapse generated/vendored files (lockfiles, snapshots, dist/, …) when the Files tab opens. */
  autoCollapseGenerated: boolean;
  /** Glob-like path patterns treated as generated (see GENERATED_PATTERNS_DEFAULT). */
  generatedPatterns: string[];
  /** "12 / 30 files viewed" progress bar + next-unviewed navigation on the Files tab. */
  reviewProgressEnabled: boolean;
  /** What "Copy checkout command" copies: `gh pr checkout 123` or plain git fetch + switch. */
  checkoutCommand: 'gh' | 'git';

  // ---- Pull request status -----------------------------------------------
  /** Days without activity after which an open PR is flagged "stale" (0 = never). */
  staleDays: number;

  // ---- Desktop notifications (chrome.notifications) ----------------------
  /** Master switch for system notifications (the badge is `notificationsEnabled`). */
  desktopNotifications: boolean;
  /** Someone requested your review. */
  notifyReviewRequested: boolean;
  /** A reviewer requested changes on your PR. */
  notifyChangesRequested: boolean;
  /** Checks failed on your PR. */
  notifyChecksFailed: boolean;
  /** Your PR was approved. */
  notifyApproved: boolean;
  /** Suppress notifications between quietHoursStart and quietHoursEnd (local time, "HH:MM"). */
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;

  // ---- Comment templates -------------------------------------------------
  /** Template picker (shortcut) inside GitHub comment boxes. */
  commentTemplatesEnabled: boolean;
  /** Offer the built-in Conventional Comments labels in the picker. */
  conventionalCommentsEnabled: boolean;
  /** The user's own reusable comment snippets. */
  commentSnippets: CommentSnippet[];

  // ---- Review checklist ----------------------------------------------------
  /** Floating per-repo review checklist on PR pages (renders only when a template matches). */
  reviewChecklistEnabled: boolean;
  /** Templates keyed by `owner/repo`, `owner/*` or `*`; the most specific match wins. */
  reviewChecklists: ChecklistTemplate[];
}

/** A user-defined comment template. */
export interface CommentSnippet {
  title: string;
  body: string;
}

export const MAX_SNIPPETS = 50;
export const MAX_SNIPPET_TITLE = 80;
export const MAX_SNIPPET_BODY = 2000;

/** Validate untrusted snippets: drops malformed/empty ones, trims titles, caps lengths and count. */
export function sanitizeSnippets(raw: unknown): CommentSnippet[] {
  if (!Array.isArray(raw)) return [];
  const out: CommentSnippet[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { title, body } = item as Record<string, unknown>;
    if (typeof title !== 'string' || typeof body !== 'string') continue;
    const cleanTitle = title.trim().slice(0, MAX_SNIPPET_TITLE);
    if (!cleanTitle || !body.trim()) continue;
    out.push({ title: cleanTitle, body: body.slice(0, MAX_SNIPPET_BODY) });
    if (out.length >= MAX_SNIPPETS) break;
  }
  return out;
}

/** Default "generated file" patterns: `*` = any chars except '/', `**` = any path, no leading '/' = match at any depth. */
export const GENERATED_PATTERNS_DEFAULT: readonly string[] = Object.freeze([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'Cargo.lock',
  'Gemfile.lock',
  'poetry.lock',
  'composer.lock',
  'go.sum',
  'Podfile.lock',
  '*.min.js',
  '*.min.css',
  '*.map',
  '*.snap',
  '__snapshots__/**',
  'dist/**',
  'build/**',
  'vendor/**',
  '*.pb.go',
  '*_pb2.py',
  '*.generated.*',
]);

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  language: 'system',
  shortcutsEnabled: true,
  shortcutBindings: undefined,
  shortcutHintEnabled: true,
  prListEnabled: true,
  suggestedLabelsEnabled: true,
  dashboardEnabled: true,
  notificationsEnabled: true,
  notificationInterval: 15,
  cacheDuration: 5,
  autoCollapseGenerated: true,
  generatedPatterns: GENERATED_PATTERNS_DEFAULT as string[],
  reviewProgressEnabled: true,
  checkoutCommand: 'gh',
  staleDays: 7,
  desktopNotifications: true,
  notifyReviewRequested: true,
  notifyChangesRequested: true,
  notifyChecksFailed: true,
  notifyApproved: false,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '08:00',
  commentTemplatesEnabled: true,
  conventionalCommentsEnabled: true,
  commentSnippets: [],
  reviewChecklistEnabled: true,
  reviewChecklists: [],
});

/** Storage key for each setting (kept flat for backward compatibility with <= 0.3). */
export const SETTINGS_KEYS: Readonly<Record<keyof Settings, string>> = Object.freeze({
  language: 'language',
  shortcutsEnabled: SHORTCUTS_ENABLED_KEY,
  shortcutBindings: SHORTCUTS_STORAGE_KEY,
  shortcutHintEnabled: 'shortcutHintEnabled',
  prListEnabled: 'prListEnabled',
  suggestedLabelsEnabled: 'suggestedLabelsEnabled',
  dashboardEnabled: 'dashboardEnabled',
  notificationsEnabled: 'notificationsEnabled',
  notificationInterval: 'notificationInterval',
  cacheDuration: 'cacheDuration',
  autoCollapseGenerated: 'autoCollapseGenerated',
  generatedPatterns: 'generatedPatterns',
  reviewProgressEnabled: 'reviewProgressEnabled',
  checkoutCommand: 'checkoutCommand',
  staleDays: 'staleDays',
  desktopNotifications: 'desktopNotifications',
  notifyReviewRequested: 'notifyReviewRequested',
  notifyChangesRequested: 'notifyChangesRequested',
  notifyChecksFailed: 'notifyChecksFailed',
  notifyApproved: 'notifyApproved',
  quietHoursEnabled: 'quietHoursEnabled',
  quietHoursStart: 'quietHoursStart',
  quietHoursEnd: 'quietHoursEnd',
  commentTemplatesEnabled: 'commentTemplatesEnabled',
  conventionalCommentsEnabled: 'conventionalCommentsEnabled',
  commentSnippets: 'commentSnippets',
  reviewChecklistEnabled: 'reviewChecklistEnabled',
  reviewChecklists: 'reviewChecklists',
});

/**
 * Secret-store key of the token. Earlier versions kept it in
 * chrome.storage.local under the same name; the background migrates it once.
 */
export const TOKEN_KEY = 'githubToken';
/** Account data. */
export const USER_KEY = 'githubUser';
/** Background-owned inbox / notification state. */
export const INBOX_STATE_KEY = 'inboxState';

/** Legacy keys from <= 0.3 that nothing reads any more; removed on update. */
export const LEGACY_KEYS = ['cacheEnabled', 'cacheTime', 'batchDelay', 'classicTokenMigrated', 'prNotificationState'];

export const STALE_DAYS_OPTIONS = [0, 3, 7, 14, 30] as const;

export const NOTIFICATION_INTERVAL_OPTIONS = [5, 10, 15, 30, 60] as const;
export const CACHE_DURATION_OPTIONS = [1, 2, 5, 10, 30] as const;

export function coerce<K extends keyof Settings>(key: K, raw: unknown): Settings[K] {
  const def = DEFAULT_SETTINGS[key];
  if (raw === undefined || raw === null) return def;
  switch (key) {
    case 'language':
      return (raw === 'en' || raw === 'pl' || raw === 'system' ? raw : def) as Settings[K];
    case 'shortcutBindings':
      return raw as Settings[K];
    case 'notificationInterval':
    case 'cacheDuration': {
      const n = Number(raw);
      return (Number.isFinite(n) && n > 0 && n <= 24 * 60 ? n : def) as Settings[K];
    }
    case 'staleDays': {
      const n = Number(raw);
      return (Number.isInteger(n) && n >= 0 && n <= 365 ? n : def) as Settings[K];
    }
    case 'generatedPatterns': {
      if (!Array.isArray(raw)) return def;
      const list = raw.filter((p): p is string => typeof p === 'string' && p.trim().length > 0 && p.length <= 200).map((p) => p.trim());
      return list.slice(0, 100) as Settings[K];
    }
    case 'commentSnippets':
      return sanitizeSnippets(raw) as Settings[K];
    case 'reviewChecklists':
      return sanitizeTemplates(raw) as Settings[K];
    case 'checkoutCommand':
      return (raw === 'gh' || raw === 'git' ? raw : def) as Settings[K];
    case 'quietHoursStart':
    case 'quietHoursEnd':
      return (typeof raw === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : def) as Settings[K];
    default:
      return (typeof raw === typeof def ? raw : def) as Settings[K];
  }
}

/** Build a full Settings object from raw storage items (missing/invalid → default). */
export function settingsFromStorage(items: Record<string, unknown>): Settings {
  const out = {} as Settings;
  for (const key of Object.keys(SETTINGS_KEYS) as (keyof Settings)[]) {
    (out as unknown as Record<string, unknown>)[key] = coerce(key, items[SETTINGS_KEYS[key]]);
  }
  return out;
}

export async function getSettings(): Promise<Settings> {
  try {
    const items = await readSettingItems(Object.values(SETTINGS_KEYS));
    return settingsFromStorage(items);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function setSettings(patch: Partial<Settings>): Promise<void> {
  const items: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch) as [keyof Settings, unknown][]) {
    if (key in SETTINGS_KEYS) items[SETTINGS_KEYS[key]] = value;
  }
  if (Object.keys(items).length) await writeSettingItems(items);
}

export async function resetSettings(): Promise<void> {
  await removeSettingItems(Object.values(SETTINGS_KEYS));
}

/**
 * Subscribe to settings changes. The callback receives the full, fresh settings
 * plus the list of setting names that changed. Returns an unsubscribe function.
 */
export function onSettingsChanged(cb: (settings: Settings, changed: (keyof Settings)[]) => void): () => void {
  const reverse = new Map<string, keyof Settings>();
  for (const [name, storageKey] of Object.entries(SETTINGS_KEYS)) reverse.set(storageKey, name as keyof Settings);

  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    if (!isSettingsArea(area)) return;
    const changed = Object.keys(changes)
      .filter((k) => k !== LOCAL_ONLY_KEY)
      .map((k) => reverse.get(k))
      .filter((k): k is keyof Settings => !!k);
    if (!changed.length) return;
    void getSettings().then((s) => cb(s, changed));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
