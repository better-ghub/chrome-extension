import { parsePage, parsePRUrl, prUrl } from '../src/core/page';
import { DEFAULT_SETTINGS, getSettings, SETTINGS_KEYS, setSettings, settingsFromStorage } from '../src/core/settings';
import { t } from '../src/i18n';
import { h } from '../src/core/dom';
import { iconSvg } from '../src/core/icons';

function resetStorage(): void {
  (globalThis as unknown as { __resetChromeStorage: () => void }).__resetChromeStorage();
}

describe('parsePage', () => {
  test.each([
    ['https://github.com/', 'dashboard'],
    ['https://github.com/dashboard', 'dashboard'],
    ['https://github.com/o/r/pulls', 'pr-list'],
    ['https://github.com/o/r/pulls?q=is%3Aopen', 'pr-list'],
    ['https://github.com/o/r/pull/12', 'pr'],
    ['https://github.com/o/r/pull/12/files', 'pr'],
    ['https://github.com/o/r', 'other'],
    ['https://github.com/o/r/issues', 'other'],
    ['https://github.com/settings/profile', 'other'],
    ['https://github.com/pulls', 'other'],
    ['https://gist.github.com/o/r/pull/1', 'other'],
  ])('%s → %s', (url, kind) => {
    expect(parsePage(url).kind).toBe(kind);
  });

  test('PR tab detection', () => {
    expect(parsePage('https://github.com/o/r/pull/1').prTab).toBe('conversation');
    expect(parsePage('https://github.com/o/r/pull/1/files').prTab).toBe('files');
    expect(parsePage('https://github.com/o/r/pull/1/changes').prTab).toBe('files');
    expect(parsePage('https://github.com/o/r/pull/1/commits').prTab).toBe('commits');
    expect(parsePage('https://github.com/o/r/pull/1/commits/abc123').prTab).toBe('files');
    expect(parsePage('https://github.com/o/r/pull/1/checks').prTab).toBe('checks');
    expect(parsePage('https://github.com/o/r/pull/1/').number).toBe(1);
  });

  test('prUrl / parsePRUrl', () => {
    expect(prUrl({ owner: 'o', repo: 'r', number: 5 })).toBe('https://github.com/o/r/pull/5');
    expect(prUrl({ owner: 'o' })).toBeNull();
    expect(parsePRUrl('https://github.com/o/r/pull/9/files#diff-1')).toEqual({ owner: 'o', repo: 'r', number: 9 });
    expect(parsePRUrl('/o/r/pull/3')).toEqual({ owner: 'o', repo: 'r', number: 3 });
    expect(parsePRUrl('https://evil.com/o/r/pull/3')).toBeNull();
  });
});

describe('settings', () => {
  beforeEach(resetStorage);

  test('defaults when storage is empty', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  test('invalid values fall back to defaults', () => {
    const s = settingsFromStorage({
      [SETTINGS_KEYS.language]: 'de',
      [SETTINGS_KEYS.notificationInterval]: -3,
      [SETTINGS_KEYS.prListEnabled]: 'yes',
    });
    expect(s.language).toBe('system');
    expect(s.notificationInterval).toBe(DEFAULT_SETTINGS.notificationInterval);
    expect(s.prListEnabled).toBe(true);
  });

  test('setSettings writes under the mapped storage keys (in sync)', async () => {
    await setSettings({ shortcutsEnabled: false, notificationInterval: 30 });
    const raw = await chrome.storage.sync.get(null);
    expect(raw.shortcutsEnabled).toBe(false);
    expect(raw.notificationInterval).toBe(30);
    expect((await getSettings()).notificationInterval).toBe(30);
  });
});

describe('i18n t()', () => {
  test('uses the fallback and substitutes $n when the key is unknown', () => {
    expect(t('definitelyMissingKey', 'Hello $1, you have $2', ['Ada', '3'])).toBe('Hello Ada, you have 3');
  });
});

describe('dom h()', () => {
  test('builds elements with escaped text children', () => {
    const el = h('button', { class: 'bghub-btn', attrs: { type: 'button', disabled: true, hidden: false } }, '<b>x</b>', 3);
    expect(el.className).toBe('bghub-btn');
    expect(el.getAttribute('type')).toBe('button');
    expect(el.hasAttribute('disabled')).toBe(true);
    expect(el.hasAttribute('hidden')).toBe(false);
    expect(el.innerHTML).toBe('&lt;b&gt;x&lt;/b&gt;3');
  });
});

describe('icons', () => {
  test('renders a known octicon', () => {
    expect(iconSvg('x', 12)).toContain('octicon-x');
    expect(iconSvg('x', 12)).toContain('width="12"');
  });
});

describe('settings: feature settings validation', () => {
  test('generatedPatterns keeps only non-empty strings, staleDays/quiet hours validated', () => {
    const s = settingsFromStorage({
      generatedPatterns: ['dist/**', '', 3, '  *.lock  '],
      staleDays: 2.5,
      quietHoursStart: '25:00',
      quietHoursEnd: '07:30',
    });
    expect(s.generatedPatterns).toEqual(['dist/**', '*.lock']);
    expect(s.staleDays).toBe(DEFAULT_SETTINGS.staleDays);
    expect(s.quietHoursStart).toBe(DEFAULT_SETTINGS.quietHoursStart);
    expect(s.quietHoursEnd).toBe('07:30');
  });

  test('defaults: generated patterns include lockfiles and snapshots', () => {
    expect(DEFAULT_SETTINGS.generatedPatterns).toEqual(expect.arrayContaining(['package-lock.json', '*.snap', 'dist/**']));
  });
});

import { daysSince, isReady, isStale } from '../src/core/readiness';

describe('readiness', () => {
  const base = { isDraft: false, reviewDecision: 'APPROVED' as const, checks: 'SUCCESS' as const, hasConflicts: false, unresolvedThreads: 0 };
  test('ready only when approved, green, conflict-free, no unresolved threads, not draft', () => {
    expect(isReady(base)).toBe(true);
    expect(isReady({ ...base, checks: null })).toBe(true);
    expect(isReady({ ...base, checks: 'PENDING' })).toBe(false);
    expect(isReady({ ...base, reviewDecision: null })).toBe(false);
    expect(isReady({ ...base, hasConflicts: true })).toBe(false);
    expect(isReady({ ...base, unresolvedThreads: 1 })).toBe(false);
    expect(isReady({ ...base, isDraft: true })).toBe(false);
  });
  test('stale after N whole days, 0 disables', () => {
    const now = Date.parse('2026-11-23T12:00:00Z');
    expect(daysSince('2026-11-16T12:00:00Z', now)).toBe(7);
    expect(isStale('2026-11-16T12:00:00Z', 7, now)).toBe(true);
    expect(isStale('2026-11-17T12:00:00Z', 7, now)).toBe(false);
    expect(isStale('2026-01-01T00:00:00Z', 0, now)).toBe(false);
    expect(isStale(null, 7, now)).toBe(false);
  });
});

import { isPageMutation } from '../src/core/dom';

describe('observe() mutation filter', () => {
  const rec = (init: Partial<MutationRecord>): MutationRecord =>
    ({ type: 'childList', addedNodes: [] as unknown as NodeList, removedNodes: [] as unknown as NodeList, ...init }) as MutationRecord;
  const list = (...n: Node[]): NodeList => n as unknown as NodeList;

  test('changes inside our UI (e.g. toast text) are ignored', () => {
    const ours = document.createElement('div');
    ours.className = 'bghub-toast';
    const text = document.createTextNode('old');
    expect(isPageMutation(rec({ target: ours, removedNodes: list(text) }))).toBe(false);
    expect(isPageMutation(rec({ type: 'characterData', target: ours.appendChild(document.createTextNode('x')) }))).toBe(false);
  });

  test('inserting our chip into a GitHub element is ignored; GitHub changes are not', () => {
    const gh = document.createElement('li');
    const chip = document.createElement('span');
    chip.className = 'bghub-chip';
    expect(isPageMutation(rec({ target: gh, addedNodes: list(chip) }))).toBe(false);
    expect(isPageMutation(rec({ target: gh, addedNodes: list(document.createElement('div')) }))).toBe(true);
    expect(isPageMutation(rec({ target: gh, removedNodes: list(document.createTextNode('x')) }))).toBe(true);
    expect(isPageMutation(rec({ type: 'attributes', target: gh }))).toBe(true);
  });
});
