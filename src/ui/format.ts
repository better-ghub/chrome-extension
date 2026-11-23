// Better GHub - Localized formatting helpers for injected UI.

import { getLocale, t } from '../i18n';

const MARK = '⁣'; // invisible separator, never present in translations

/**
 * Translate `key` and splice DOM nodes into its `$1`, `$2`… placeholders, so
 * word order stays up to the translation (no string concatenation):
 *   tNodes('prlActComment', '$1 commented · $2', [strong('alice'), timeEl])
 */
export function tNodes(key: string, fallback: string, parts: (Node | string)[]): (Node | string)[] {
  const marks = parts.map((_, i) => `${MARK}${i}${MARK}`);
  const text = t(key, fallback, marks);
  const out: (Node | string)[] = [];
  const re = new RegExp(`${MARK}(\\d+)${MARK}`, 'g');
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const part = parts[Number(m[1])];
    if (part !== undefined) out.push(part);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * Plural-aware message: looks up `${key}_${category}` (Intl.PluralRules
 * categories — English one/other, Polish one/few/many/other).
 */
export function tPlural(key: string, n: number, fallbackOne: string, fallbackOther: string): string {
  let category = 'other';
  try {
    category = new Intl.PluralRules(getLocale()).select(n);
  } catch {
    /* unsupported locale */
  }
  const fallback = n === 1 ? fallbackOne : fallbackOther;
  return t(`${key}_${category}`, fallback, [formatNumber(n)]);
}

export function formatNumber(n: number, compact = false): string {
  try {
    return new Intl.NumberFormat(getLocale(), compact && Math.abs(n) >= 10_000 ? { notation: 'compact', maximumFractionDigits: 1 } : {}).format(n);
  } catch {
    return String(n);
  }
}
