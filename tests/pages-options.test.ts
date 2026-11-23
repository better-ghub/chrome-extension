// Options page: the 'files' route, the stale-after select, nested switches,
// the pattern editor and the test notification (jsdom).

import { DEFAULT_SETTINGS, GENERATED_PATTERNS_DEFAULT, getSettings, type Settings } from '../src/core/settings';
import { parseRoute } from '../src/pages/route';
import { FilesView } from '../options/files-view';
import { sendTestNotification, testNotificationMessage, type NotificationsApi } from '../options/notify-test';
import { SettingsForm, staleDaysLabel } from '../options/settings-form';

const flush = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  (globalThis as unknown as { __resetChromeStorage: () => void }).__resetChromeStorage();
  document.body.replaceChildren();
});

describe('routes', () => {
  test.each([
    ['#files', 'files'],
    ['#FILES', 'files'],
    ['#files-changed', 'files'],
    ['#generated', 'files'],
    ['#checkout', 'files'],
  ])('%s → %s', (hash, section) => {
    expect(parseRoute(hash)).toEqual({ section, welcome: false });
  });

  test('existing routes are unchanged', () => {
    expect(parseRoute('#pr-list')).toEqual({ section: 'pr-list', welcome: false });
    expect(parseRoute('#notifications')).toEqual({ section: 'notifications', welcome: false });
    expect(parseRoute('#nope')).toEqual({ section: 'account', welcome: false });
  });
});

test('stale-after labels', () => {
  expect(staleDaysLabel(0)).toBe('Never');
  expect(staleDaysLabel(1)).toBe('1 day');
  expect(staleDaysLabel(14)).toBe('14 days');
});

function settings(over: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...over } as Settings;
}

describe('settings form', () => {
  function mount(s: Settings): { form: SettingsForm; q: <T extends HTMLElement>(sel: string) => T } {
    document.body.innerHTML = `
      <select id="set-stale" data-setting="staleDays"></select>
      <input type="checkbox" id="desktop" data-setting="desktopNotifications" />
      <div id="events" data-depends="desktopNotifications">
        <input type="checkbox" id="approved" data-setting="notifyApproved" />
      </div>
      <div id="quiet" data-depends="desktopNotifications">
        <input type="checkbox" id="quiet-on" data-setting="quietHoursEnabled" />
      </div>
      <div id="range" data-depends="desktopNotifications quietHoursEnabled">
        <input type="time" id="start" data-setting="quietHoursStart" />
      </div>
      <div class="segmented">
        <input type="radio" name="checkoutCommand" value="gh" data-radio-setting="checkoutCommand" />
        <input type="radio" name="checkoutCommand" value="git" data-radio-setting="checkoutCommand" />
      </div>`;
    const form = new SettingsForm(document.body, s, async () => undefined);
    return { form, q: <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T };
  }

  test('stale select offers "Never" and the presets, selecting the stored value', () => {
    const { q } = mount(settings({ staleDays: 7 }));
    const select = q<HTMLSelectElement>('#set-stale');
    expect([...select.options].map((o) => o.value)).toEqual(['0', '3', '7', '14', '30']);
    expect(select.options[0].textContent).toBe('Never');
    expect(select.value).toBe('7');
  });

  test('nested switches: per-event and quiet hours need the master switch, times need both', () => {
    const { form, q } = mount(settings({ desktopNotifications: true, quietHoursEnabled: false }));
    expect(q<HTMLInputElement>('#approved').disabled).toBe(false);
    expect(q<HTMLInputElement>('#quiet-on').disabled).toBe(false);
    expect(q<HTMLInputElement>('#start').disabled).toBe(true);
    expect(q<HTMLElement>('#range').classList.contains('is-disabled')).toBe(true);

    form.sync(settings({ desktopNotifications: true, quietHoursEnabled: true }));
    expect(q<HTMLInputElement>('#start').disabled).toBe(false);
    expect(q<HTMLInputElement>('#start').value).toBe('22:00');

    form.sync(settings({ desktopNotifications: false, quietHoursEnabled: true }));
    expect(q<HTMLInputElement>('#approved').disabled).toBe(true);
    expect(q<HTMLInputElement>('#quiet-on').disabled).toBe(true);
    expect(q<HTMLInputElement>('#start').disabled).toBe(true);
  });

  test('saves numbers, times and radio choices', async () => {
    const { q } = mount(settings({ desktopNotifications: true, quietHoursEnabled: true }));
    const select = q<HTMLSelectElement>('#set-stale');
    select.value = '0';
    select.dispatchEvent(new Event('change'));
    const start = q<HTMLInputElement>('#start');
    start.value = '21:30';
    start.dispatchEvent(new Event('change'));
    const git = document.querySelector<HTMLInputElement>('input[value="git"]')!;
    git.checked = true;
    git.dispatchEvent(new Event('change'));
    await flush();
    const saved = await getSettings();
    expect(saved.staleDays).toBe(0);
    expect(saved.quietHoursStart).toBe('21:30');
    expect(saved.checkoutCommand).toBe('git');

    // An emptied time field is not saved; the stored value comes back.
    start.value = '';
    start.dispatchEvent(new Event('change'));
    await flush();
    expect((await getSettings()).quietHoursStart).toBe('21:30');
    expect(start.value).toBe('21:30');
  });
});

describe('files view', () => {
  function mount(s: Settings): { save: jest.Mock; q: <T extends HTMLElement>(sel: string) => T; view: FilesView } {
    document.body.innerHTML = `
      <textarea id="set-patterns"></textarea>
      <span id="patterns-count"></span>
      <button id="patterns-reset"></button>
      <input id="pattern-test" />
      <p id="pattern-test-result"></p>
      <input type="radio" name="checkoutCommand" value="gh" />
      <input type="radio" name="checkoutCommand" value="git" />
      <code id="checkout-preview"></code>`;
    const save = jest.fn(() => Promise.resolve());
    const view = new FilesView(document.body, s, save);
    return { save, view, q: <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T };
  }

  test('shows the patterns, the count and a disabled reset for the defaults', () => {
    const { q } = mount(settings());
    expect(q<HTMLTextAreaElement>('#set-patterns').value).toBe(GENERATED_PATTERNS_DEFAULT.join('\n'));
    expect(q('#patterns-count').textContent).toBe(`${GENERATED_PATTERNS_DEFAULT.length} patterns`);
    expect(q<HTMLButtonElement>('#patterns-reset').disabled).toBe(true);
  });

  test('editing saves the parsed list on blur; reset restores the defaults', async () => {
    const { q, save } = mount(settings());
    const area = q<HTMLTextAreaElement>('#set-patterns');
    area.value = 'dist/**\n\n*.map\n*.map';
    area.dispatchEvent(new Event('input'));
    expect(q('#patterns-count').textContent).toBe('2 patterns');
    expect(q<HTMLButtonElement>('#patterns-reset').disabled).toBe(false);
    area.dispatchEvent(new Event('blur'));
    await flush();
    expect(save).toHaveBeenCalledWith(['dist/**', '*.map']);

    q<HTMLButtonElement>('#patterns-reset').click();
    await flush();
    expect(save).toHaveBeenLastCalledWith([...GENERATED_PATTERNS_DEFAULT]);
    expect(area.value).toBe(GENERATED_PATTERNS_DEFAULT.join('\n'));
  });

  test('"Test a path" uses the patterns as typed', () => {
    const { q } = mount(settings({ generatedPatterns: ['dist/**'] }));
    const input = q<HTMLInputElement>('#pattern-test');
    const result = q('#pattern-test-result');
    expect(result.textContent).toMatch(/Type a file path/);
    input.value = 'packages/a/dist/x.js';
    input.dispatchEvent(new Event('input'));
    expect(result.textContent).toBe('Generated: matches dist/**');
    expect(result.dataset.tone).toBe('success');
    input.value = 'src/x.ts';
    input.dispatchEvent(new Event('input'));
    expect(result.textContent).toBe('Not generated: no pattern matches');
    const area = q<HTMLTextAreaElement>('#set-patterns');
    area.value = 'src/**';
    area.dispatchEvent(new Event('input'));
    expect(result.textContent).toBe('Generated: matches src/**');
  });

  test('checkout preview follows the radios and synced settings', () => {
    const { q, view } = mount(settings({ checkoutCommand: 'gh' }));
    expect(q('#checkout-preview').textContent).toBe('gh pr checkout 123');
    const git = document.querySelector<HTMLInputElement>('input[value="git"]')!;
    git.checked = true;
    git.dispatchEvent(new Event('change'));
    expect(q('#checkout-preview').textContent).toBe('git fetch origin pull/123/head:pr-123 && git switch pr-123');
    view.sync(settings({ checkoutCommand: 'gh', generatedPatterns: ['a.lock'] }));
    expect(q('#checkout-preview').textContent).toBe('gh pr checkout 123');
    expect(q<HTMLTextAreaElement>('#set-patterns').value).toBe('a.lock');
  });
});

describe('test notification', () => {
  test('creates a basic notification with the extension icon', async () => {
    const create = jest.fn((_id: string, _o: unknown, cb?: (id: string) => void) => cb?.('x'));
    const api: NotificationsApi = { create, getPermissionLevel: (cb) => cb('granted') };
    await expect(sendTestNotification(api)).resolves.toBe('sent');
    const [id, options] = create.mock.calls[0];
    expect(id).toMatch(/^bghub-test-/);
    expect(options).toMatchObject({ type: 'basic', iconUrl: '../icons/icon128.png', title: 'Better GHub' });
  });

  test('handles a missing API, a denied permission and errors', async () => {
    await expect(sendTestNotification(undefined)).resolves.toBe('unavailable');
    const create = jest.fn();
    await expect(sendTestNotification({ create, getPermissionLevel: (cb) => cb('denied') })).resolves.toBe('blocked');
    expect(create).not.toHaveBeenCalled();
    await expect(
      sendTestNotification({
        create: () => {
          throw new Error('nope');
        },
      })
    ).resolves.toBe('error');
    expect(testNotificationMessage('unavailable')).toBe('Notifications aren’t available in this browser');
    expect(testNotificationMessage('sent')).toBe('Test notification sent');
  });
});
