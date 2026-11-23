// Better GHub - Locale-aware formatting for the extension pages.
//
// Pure functions (locale and "now" are parameters with sensible defaults) so
// they can be unit-tested without a DOM or chrome APIs.

import { getLocale, getMessage, t } from '../i18n';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

type DateInput = string | number | Date | null | undefined;

/** Epoch ms for an ISO string / epoch ms / Date; NaN when unusable. */
export function toEpochMs(value: DateInput): number {
  if (value === null || value === undefined || value === '') return NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return Date.parse(value);
}

export interface RelativeParts {
  value: number;
  unit: Intl.RelativeTimeFormatUnit;
}

/**
 * Pick the largest sensible unit for an elapsed duration. Anything under 45
 * seconds (or in the future, i.e. clock skew) is "now" (value 0, unit second).
 */
export function relativeParts(ms: number, now: number): RelativeParts {
  const diff = Math.max(0, now - ms);
  if (diff < 45 * SECOND) return { value: 0, unit: 'second' };
  if (diff < HOUR) return { value: Math.max(1, Math.round(diff / MINUTE)), unit: 'minute' };
  if (diff < DAY) return { value: Math.round(diff / HOUR), unit: 'hour' };
  if (diff < 7 * DAY) return { value: Math.round(diff / DAY), unit: 'day' };
  if (diff < 30 * DAY) return { value: Math.round(diff / (7 * DAY)), unit: 'week' };
  if (diff < 365 * DAY) return { value: Math.max(1, Math.round(diff / (30 * DAY))), unit: 'month' };
  return { value: Math.round(diff / (365 * DAY)), unit: 'year' };
}

const rtfCache = new Map<string, Intl.RelativeTimeFormat>();

function rtf(locale: string, style: Intl.RelativeTimeFormatStyle, numeric: 'always' | 'auto'): Intl.RelativeTimeFormat {
  const key = `${locale}|${style}|${numeric}`;
  let f = rtfCache.get(key);
  if (!f) {
    try {
      f = new Intl.RelativeTimeFormat(locale, { style, numeric });
    } catch {
      f = new Intl.RelativeTimeFormat('en', { style, numeric });
    }
    rtfCache.set(key, f);
  }
  return f;
}

/**
 * Compact relative time for lists, e.g. "2h ago" / "2 g. temu", "now".
 * Returns '' for unusable input.
 */
export function relativeTime(value: DateInput, now = Date.now(), locale = getLocale()): string {
  const ms = toEpochMs(value);
  if (!Number.isFinite(ms)) return '';
  const { value: n, unit } = relativeParts(ms, now);
  if (n === 0) return rtf(locale, 'narrow', 'auto').format(0, 'second');
  return rtf(locale, 'narrow', 'always').format(-n, unit);
}

/** Long relative time for tooltips / screen readers, e.g. "2 hours ago". */
export function relativeTimeLong(value: DateInput, now = Date.now(), locale = getLocale()): string {
  const ms = toEpochMs(value);
  if (!Number.isFinite(ms)) return '';
  const { value: n, unit } = relativeParts(ms, now);
  if (n === 0) return rtf(locale, 'long', 'auto').format(0, 'second');
  return rtf(locale, 'long', 'always').format(-n, unit);
}

/** Full date + time, e.g. "Nov 22, 2026, 3:04 PM". */
export function absoluteTime(value: DateInput, locale = getLocale()): string {
  const ms = toEpochMs(value);
  if (!Number.isFinite(ms)) return '';
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(ms);
  } catch {
    return new Date(ms).toISOString();
  }
}

/**
 * "in 42 minutes" for a future epoch-seconds timestamp (GitHub's rate-limit
 * reset). Rounds up so "in 0 minutes" never shows; '' when unknown or past.
 */
export function resetsIn(resetEpochSec: number | null | undefined, now = Date.now(), locale = getLocale()): string {
  if (typeof resetEpochSec !== 'number' || !Number.isFinite(resetEpochSec)) return '';
  const diff = resetEpochSec * 1000 - now;
  if (diff <= 0) return '';
  const minutes = Math.ceil(diff / MINUTE);
  if (minutes < 60) return rtf(locale, 'long', 'always').format(minutes, 'minute');
  return rtf(locale, 'long', 'always').format(Math.round(minutes / 60), 'hour');
}

/**
 * Time until a future moment, e.g. "in 12 days" / "za 12 dni". Minutes under
 * an hour, hours under a day, days under 60 days, then months. '' when the
 * value is unusable or not in the future.
 */
export function timeUntil(value: DateInput, now = Date.now(), locale = getLocale()): string {
  const ms = toEpochMs(value);
  if (!Number.isFinite(ms)) return '';
  const diff = ms - now;
  if (diff <= 0) return '';
  const f = rtf(locale, 'long', 'always');
  if (diff < HOUR) return f.format(Math.max(1, Math.ceil(diff / MINUTE)), 'minute');
  if (diff < DAY) return f.format(Math.max(1, Math.round(diff / HOUR)), 'hour');
  if (diff < 60 * DAY) return f.format(Math.round(diff / DAY), 'day');
  return f.format(Math.round(diff / (30 * DAY)), 'month');
}

/** Date without time, e.g. "Feb 21, 2027". */
export function absoluteDate(value: DateInput, locale = getLocale()): string {
  const ms = toEpochMs(value);
  if (!Number.isFinite(ms)) return '';
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(ms);
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

export function formatNumber(n: number, locale = getLocale()): string {
  try {
    return new Intl.NumberFormat(locale).format(n);
  } catch {
    return String(n);
  }
}

/** Duration in minutes as a unit string: "5 min" / "1 hr" (short) or "5 minutes" (long). */
export function formatMinutes(minutes: number, display: 'short' | 'long' = 'short', locale = getLocale()): string {
  const useHours = minutes >= 60 && minutes % 60 === 0;
  const value = useHours ? minutes / 60 : minutes;
  try {
    return new Intl.NumberFormat(locale, { style: 'unit', unit: useHours ? 'hour' : 'minute', unitDisplay: display }).format(value);
  } catch {
    return `${value} ${useHours ? 'h' : 'min'}`;
  }
}

/** CLDR plural category for `n` in `locale` (one/few/many/other…). */
export function pluralCategory(n: number, locale = getLocale()): Intl.LDMLPluralRule {
  try {
    return new Intl.PluralRules(locale).select(n);
  } catch {
    return n === 1 ? 'one' : 'other';
  }
}

/**
 * Pluralised message. Looks up `<base>_<category>` (e.g. threads_few in
 * Polish), then `<base>_other`, then the English fallbacks. `$1` is the
 * formatted number.
 */
export function plural(base: string, n: number, fallback: { one: string; other: string }, locale = getLocale()): string {
  const num = formatNumber(n, locale);
  const category = pluralCategory(n, locale);
  for (const key of [`${base}_${category}`, `${base}_other`]) {
    const msg = getMessage(key, num);
    if (msg !== key) return msg;
  }
  return t(`${base}_${category}`, n === 1 ? fallback.one : fallback.other, num);
}
