// Snooze moments are computed with local Date setters. jest.config.js pins
// TZ=Europe/Warsaw (a DST-observing zone) so the daylight-saving cases below
// really cross a transition on any machine.

import {
  formatSnoozeMoment,
  nextMondayMorning,
  snoozedUntilText,
  snoozeForAnHour,
  snoozeUntil,
  tomorrowMorning,
} from '../src/pages/snooze';

/** Local wall-clock time as "YYYY-MM-DD HH:MM (weekday)". */
function local(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} (${day})`;
}

describe('snooze moments', () => {
  test('one hour is exactly 60 minutes later', () => {
    const now = new Date(2026, 10, 23, 14, 37, 12);
    expect(snoozeForAnHour(now).getTime() - now.getTime()).toBe(3_600_000);
    expect(snoozeUntil('hour', now).getTime()).toBe(now.getTime() + 3_600_000);
  });

  test('tomorrow 9:00 local, also late at night and across a month end', () => {
    expect(local(tomorrowMorning(new Date(2026, 10, 23, 14, 0)))).toBe('2026-11-24 09:00 (Tue)');
    expect(local(tomorrowMorning(new Date(2026, 10, 23, 23, 59)))).toBe('2026-11-24 09:00 (Tue)');
    expect(local(tomorrowMorning(new Date(2026, 10, 30, 8, 0)))).toBe('2026-12-01 09:00 (Tue)');
    expect(local(tomorrowMorning(new Date(2026, 11, 31, 12, 0)))).toBe('2027-01-01 09:00 (Fri)');
  });

  test.each([
    ['Monday', new Date(2026, 10, 23, 8, 0), '2026-11-30 09:00 (Mon)'], // next week, even before 9:00
    ['Monday evening', new Date(2026, 10, 23, 20, 0), '2026-11-30 09:00 (Mon)'],
    ['Tuesday', new Date(2026, 10, 24, 12, 0), '2026-11-30 09:00 (Mon)'],
    ['Saturday', new Date(2026, 10, 28, 12, 0), '2026-11-30 09:00 (Mon)'],
    ['Sunday', new Date(2026, 10, 29, 22, 0), '2026-11-30 09:00 (Mon)'], // tomorrow
  ])('next Monday 9:00 from %s', (_name, now, expected) => {
    expect(local(nextMondayMorning(now))).toBe(expected);
    expect(local(snoozeUntil('monday', now))).toBe(expected);
  });

  test('DST: 9:00 wall-clock time on both sides of a change (Europe/Warsaw)', () => {
    // Clocks go back on Sun 2026-10-25 (25-hour day) …
    const sat = new Date(2026, 9, 24, 10, 0);
    const sun = tomorrowMorning(sat);
    expect(local(sun)).toBe('2026-10-25 09:00 (Sun)');
    expect(sun.getTime() - sat.getTime()).toBe(24 * 3_600_000); // 23h wall-clock + the extra hour
    expect(local(nextMondayMorning(sat))).toBe('2026-10-26 09:00 (Mon)');
    // … and forward on Sun 2026-03-29 (23-hour day).
    const sat2 = new Date(2026, 2, 28, 10, 0);
    expect(local(tomorrowMorning(sat2))).toBe('2026-03-29 09:00 (Sun)');
    expect(local(nextMondayMorning(new Date(2026, 2, 27, 18, 0)))).toBe('2026-03-30 09:00 (Mon)');
  });
});

describe('"until …" labels', () => {
  const now = new Date(2026, 10, 23, 10, 0); // Monday

  test('time today, weekday within a week, date after that', () => {
    expect(formatSnoozeMoment(new Date(2026, 10, 23, 14, 30).toISOString(), now, 'en')).toBe('14:30');
    expect(formatSnoozeMoment(new Date(2026, 10, 24, 9, 0).toISOString(), now, 'en')).toBe('Tue 09:00');
    expect(formatSnoozeMoment(new Date(2026, 10, 30, 9, 0).toISOString(), now, 'en')).toBe('Mon 09:00');
    expect(formatSnoozeMoment(new Date(2026, 11, 7, 9, 0).toISOString(), now, 'en')).toBe('Dec 7, 09:00');
    expect(formatSnoozeMoment(null, now, 'en')).toBe('');
  });

  test('localized', () => {
    expect(formatSnoozeMoment(new Date(2026, 10, 30, 9, 0).toISOString(), now, 'pl')).toBe('pon., 09:00');
    expect(snoozedUntilText(new Date(2026, 10, 30, 9, 0).toISOString(), now, 'en')).toBe('until Mon 09:00');
  });
});
