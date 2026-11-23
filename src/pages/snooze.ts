// Better GHub - Snooze times for the popup inbox (pure).
//
// All "until" moments are computed with LOCAL Date setters (setDate/setHours),
// never by adding 24h multiples, so they land on 9:00 wall-clock time across
// daylight-saving changes.

import { getLocale, t } from '../i18n';

export type SnoozeOption = 'hour' | 'tomorrow' | 'monday';

export const SNOOZE_OPTIONS: readonly SnoozeOption[] = ['hour', 'tomorrow', 'monday'];

/** Hour of day (local) the "tomorrow" / "Monday" snoozes end. */
export const SNOOZE_MORNING_HOUR = 9;

/** One hour from `now`. */
export function snoozeForAnHour(now: Date): Date {
  return new Date(now.getTime() + 60 * 60 * 1000);
}

/** Tomorrow at 9:00 local time. */
export function tomorrowMorning(now: Date, hour = SNOOZE_MORNING_HOUR): Date {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/**
 * The next Monday at 9:00 local time. On a Monday this is the Monday of next
 * week (snoozing "until Monday" on Monday morning means next week); on a
 * Sunday it is tomorrow.
 */
export function nextMondayMorning(now: Date, hour = SNOOZE_MORNING_HOUR): Date {
  const d = new Date(now.getTime());
  const days = (8 - d.getDay()) % 7 || 7; // Sun → 1, Mon → 7, Tue → 6, …, Sat → 2
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

export function snoozeUntil(option: SnoozeOption, now = new Date()): Date {
  switch (option) {
    case 'hour':
      return snoozeForAnHour(now);
    case 'tomorrow':
      return tomorrowMorning(now);
    case 'monday':
      return nextMondayMorning(now);
  }
}

export function snoozeOptionLabel(option: SnoozeOption): string {
  switch (option) {
    case 'hour':
      return t('inboxSnoozeHour', 'Snooze for 1 hour');
    case 'tomorrow':
      return t('inboxSnoozeTomorrow', 'Snooze until tomorrow 9:00');
    case 'monday':
      return t('inboxSnoozeMonday', 'Snooze until Monday 9:00');
  }
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Short local moment for "until …": "14:30" today, "Mon 09:00" within a week,
 * "Dec 7, 09:00" later. '' for unusable input.
 */
export function formatSnoozeMoment(iso: string | null | undefined, now = new Date(), locale = getLocale()): string {
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return '';
  const at = new Date(ms);
  const time: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  let opts: Intl.DateTimeFormatOptions;
  if (sameLocalDay(at, now)) opts = time;
  else if (ms - now.getTime() < 7 * 24 * 60 * 60 * 1000) opts = { weekday: 'short', ...time };
  else opts = { month: 'short', day: 'numeric', ...time };
  try {
    return new Intl.DateTimeFormat(locale, opts).format(at);
  } catch {
    return at.toISOString();
  }
}

/** "until Mon 09:00". */
export function snoozedUntilText(iso: string | null | undefined, now = new Date(), locale?: string): string {
  return t('inboxSnoozedUntil', 'until $1', formatSnoozeMoment(iso, now, locale));
}
