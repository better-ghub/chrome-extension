// Better GHub - Settings export / import (pure functions)
//
// File format: { app: "better-ghub", version, exportedAt, settings: { <setting name>: value } }.
// Only settings are exported - never tokens, inbox state or caches.

import { coerce, SETTINGS_KEYS, type Settings } from '../core/settings';

export const EXPORT_APP = 'better-ghub';
export const EXPORT_FILENAME = 'better-ghub-settings.json';
/** Settings files are tiny; refuse anything bigger instead of parsing it. */
export const MAX_IMPORT_BYTES = 256 * 1024;

export interface SettingsFile {
  app: typeof EXPORT_APP;
  version: string;
  exportedAt: string;
  settings: Partial<Record<keyof Settings, unknown>>;
}

export type ParseError = 'invalid-json' | 'wrong-app' | 'no-settings' | 'too-large';
export type ParseResult = { ok: true; settings: Partial<Settings>; count: number } | { ok: false; error: ParseError };

export function buildSettingsFile(settings: Settings, version: string, now: Date = new Date()): SettingsFile {
  const out: SettingsFile['settings'] = {};
  for (const key of Object.keys(SETTINGS_KEYS) as (keyof Settings)[]) {
    if (settings[key] !== undefined) out[key] = settings[key];
  }
  return { app: EXPORT_APP, version, exportedAt: now.toISOString(), settings: out };
}

export function serializeSettings(settings: Settings, version: string, now?: Date): string {
  return JSON.stringify(buildSettingsFile(settings, version, now), null, 2) + '\n';
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Parse and validate an exported file. Unknown keys are ignored; known keys go
 * through coerce() (invalid values fall back to the default), and null values
 * are skipped. Shortcut bindings must at least be an object.
 */
export function parseSettingsFile(text: string): ParseResult {
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, error: 'too-large' };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid-json' };
  }
  if (!isRecord(data) || data.app !== EXPORT_APP) return { ok: false, error: 'wrong-app' };
  if (!isRecord(data.settings)) return { ok: false, error: 'no-settings' };

  const settings: Record<string, unknown> = {};
  for (const key of Object.keys(SETTINGS_KEYS) as (keyof Settings)[]) {
    if (!Object.prototype.hasOwnProperty.call(data.settings, key)) continue;
    const raw = data.settings[key];
    if (raw === undefined || raw === null) continue;
    if (key === 'shortcutBindings' && !isRecord(raw)) continue;
    settings[key] = coerce(key, raw);
  }
  const count = Object.keys(settings).length;
  if (!count) return { ok: false, error: 'no-settings' };
  return { ok: true, settings: settings as Partial<Settings>, count };
}
