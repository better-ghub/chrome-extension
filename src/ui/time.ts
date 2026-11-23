// Better GHub - Relative times.
//
// We emit GitHub's own <relative-time datetime="…"> custom element: GitHub's
// page registers it, upgrades nodes created by content scripts too, keeps the
// text live and adds a full-date title. `lang` makes it use the extension's
// language. The text content is a localized fallback for the moment before
// the upgrade (and for tests / pages without the element).

import { getLocale } from '../i18n';
import { h } from '../core/dom';

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400],
  ['month', 30 * 86_400],
  ['week', 7 * 86_400],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

function pickUnit(seconds: number): [Intl.RelativeTimeFormatUnit, number] {
  for (const [unit, size] of UNITS) {
    if (seconds >= size) return [unit, Math.floor(seconds / size)];
  }
  return ['minute', 0];
}

/** Compact "5m" / "2h" / "3d" (localized narrow units). */
export function formatMicro(iso: string, now = Date.now(), locale = getLocale()): string {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000);
  const [unit, value] = pickUnit(seconds);
  try {
    return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'narrow' }).format(Math.max(1, value));
  } catch {
    return `${Math.max(1, value)}${unit[0]}`;
  }
}

/** "2 hours ago" / "2 godziny temu". */
export function formatAgo(iso: string, now = Date.now(), locale = getLocale()): string {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000);
  const [unit, value] = pickUnit(seconds);
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-value, value === 0 ? 'second' : unit);
  } catch {
    return new Date(iso).toLocaleString();
  }
}

export function relativeTime(iso: string, opts: { micro?: boolean; className?: string } = {}): HTMLElement {
  const el = h('relative-time' as keyof HTMLElementTagNameMap, {
    class: opts.className ?? 'bghub-time',
    attrs: { datetime: iso, lang: getLocale(), format: opts.micro ? 'micro' : null, tense: 'past' },
    text: opts.micro ? formatMicro(iso) : formatAgo(iso),
  });
  return el as HTMLElement;
}
