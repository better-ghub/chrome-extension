import * as fs from 'fs';
import * as path from 'path';
import { getLocale, reloadI18n } from '../src/i18n';
import {
  absoluteTime,
  formatMinutes,
  formatNumber,
  plural,
  pluralCategory,
  relativeParts,
  relativeTime,
  relativeTimeLong,
  resetsIn,
  toEpochMs,
} from '../src/pages/format';

const NOW = Date.parse('2026-11-22T12:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('relativeParts', () => {
  test.each([
    [0, 0, 'second'],
    [44_000, 0, 'second'],
    [50_000, 1, 'minute'],
    [5 * MIN, 5, 'minute'],
    [59 * MIN, 59, 'minute'],
    [2 * HOUR, 2, 'hour'],
    [23 * HOUR, 23, 'hour'],
    [3 * DAY, 3, 'day'],
    [14 * DAY, 2, 'week'],
    [60 * DAY, 2, 'month'],
    [800 * DAY, 2, 'year'],
  ])('%i ms ago → %i %s', (ago, value, unit) => {
    expect(relativeParts(NOW - ago, NOW)).toEqual({ value, unit });
  });

  test('future timestamps (clock skew) read as "now"', () => {
    expect(relativeParts(NOW + HOUR, NOW)).toEqual({ value: 0, unit: 'second' });
  });
});

describe('relativeTime', () => {
  test('compact English', () => {
    expect(relativeTime(NOW - 2 * HOUR, NOW, 'en')).toBe('2h ago');
    expect(relativeTime(new Date(NOW - 5 * MIN).toISOString(), NOW, 'en')).toBe('5m ago');
    expect(relativeTime(NOW - 10_000, NOW, 'en')).toBe('now');
  });

  test('Polish uses the Polish locale data', () => {
    expect(relativeTime(NOW - 3 * DAY, NOW, 'pl')).toBe('3 dni temu');
  });

  test('long form for tooltips and screen readers', () => {
    expect(relativeTimeLong(NOW - 2 * HOUR, NOW, 'en')).toBe('2 hours ago');
    expect(relativeTimeLong(NOW - 1 * DAY, NOW, 'en')).toBe('1 day ago');
  });

  test('unusable input renders nothing', () => {
    expect(relativeTime(null, NOW, 'en')).toBe('');
    expect(relativeTime('not a date', NOW, 'en')).toBe('');
    expect(relativeTimeLong(undefined, NOW, 'en')).toBe('');
    expect(absoluteTime('nope', 'en')).toBe('');
    expect(Number.isNaN(toEpochMs(''))).toBe(true);
  });

  test('absolute time is a readable date', () => {
    expect(absoluteTime(NOW, 'en')).toMatch(/2026/);
  });
});

describe('resetsIn', () => {
  const nowSec = NOW / 1000;
  test('rounds up to whole minutes and switches to hours', () => {
    expect(resetsIn(nowSec + 30, NOW, 'en')).toBe('in 1 minute');
    expect(resetsIn(nowSec + 42 * 60, NOW, 'en')).toBe('in 42 minutes');
    expect(resetsIn(nowSec + 2 * 3600, NOW, 'en')).toBe('in 2 hours');
    expect(resetsIn(nowSec + 42 * 60, NOW, 'pl')).toBe('za 42 minuty');
  });

  test('past or unknown resets render nothing', () => {
    expect(resetsIn(nowSec - 10, NOW, 'en')).toBe('');
    expect(resetsIn(null, NOW, 'en')).toBe('');
    expect(resetsIn(undefined, NOW, 'en')).toBe('');
  });
});

describe('number and duration formatting', () => {
  test('locale-aware numbers', () => {
    expect(formatNumber(4812, 'en')).toBe('4,812');
    expect(formatNumber(4812, 'pl')).toBe('4812');
  });

  test('minutes, collapsing whole hours', () => {
    expect(formatMinutes(5, 'short', 'en')).toBe('5 min');
    expect(formatMinutes(60, 'short', 'en')).toBe('1 hr');
    expect(formatMinutes(10, 'long', 'en')).toBe('10 minutes');
    expect(formatMinutes(1, 'long', 'en')).toBe('1 minute');
    expect(formatMinutes(90, 'long', 'en')).toBe('90 minutes');
  });
});

describe('plural', () => {
  const fallback = { one: '$1 unresolved thread', other: '$1 unresolved threads' };

  test('English fallbacks when no messages are loaded', () => {
    expect(plural('inboxUnresolvedThreads', 1, fallback, 'en')).toBe('1 unresolved thread');
    expect(plural('inboxUnresolvedThreads', 3, fallback, 'en')).toBe('3 unresolved threads');
  });

  test('CLDR categories', () => {
    expect(pluralCategory(1, 'pl')).toBe('one');
    expect(pluralCategory(3, 'pl')).toBe('few');
    expect(pluralCategory(5, 'pl')).toBe('many');
    expect(pluralCategory(22, 'pl')).toBe('few');
  });

  describe('with Polish messages loaded', () => {
    const runtime = chrome.runtime as unknown as { id?: string; sendMessage: unknown };
    const originalSend = runtime.sendMessage;

    beforeAll(async () => {
      const messages = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '_locales', 'pl', 'messages.json'), 'utf8'));
      // jsdom pages load locales through the background ('i18n:load').
      runtime.id = 'test-extension';
      runtime.sendMessage = (msg: { type: string }) =>
        Promise.resolve(msg.type === 'i18n:load' ? { ok: true, messages } : undefined);
      await chrome.storage.local.set({ language: 'pl' });
      await reloadI18n();
    });

    afterAll(async () => {
      runtime.sendMessage = originalSend;
      delete runtime.id;
      (globalThis as unknown as { __resetChromeStorage: () => void }).__resetChromeStorage();
      await reloadI18n();
    });

    test('picks one / few / many forms', () => {
      expect(getLocale()).toBe('pl');
      expect(plural('inboxUnresolvedThreads', 1, fallback)).toBe('1 nierozwiązany wątek');
      expect(plural('inboxUnresolvedThreads', 3, fallback)).toBe('3 nierozwiązane wątki');
      expect(plural('inboxUnresolvedThreads', 5, fallback)).toBe('5 nierozwiązanych wątków');
      expect(plural('inboxUnresolvedThreads', 22, fallback)).toBe('22 nierozwiązane wątki');
    });
  });
});
