import { readSettingItems } from '../src/core/settings-storage';
import type { AuthStatus, InboxItem } from '../src/core/messages';
import { renderApiMeter, renderConnectForm } from '../src/pages/auth-view';
import { attachInlineConfirm, fillTemplate } from '../src/pages/dom-ui';
import { defaultBindings, SHORTCUTS_STORAGE_KEY } from '../src/shortcuts';
import { ShortcutsView } from '../options/shortcuts-view';
import { InboxView } from '../popup/inbox-view';

type Runtime = { id?: string; sendMessage: unknown };
const runtime = chrome.runtime as unknown as Runtime;
const originalSend = runtime.sendMessage;
const flush = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
const FINE = `github_pat_${'A1b2C3d4E5'.repeat(8)}x`;

function mockBackground(handler: (msg: { type: string; [k: string]: unknown }) => unknown): jest.Mock {
  const fn = jest.fn((msg: { type: string }) => Promise.resolve(handler(msg)));
  runtime.id = 'test-extension';
  runtime.sendMessage = fn;
  return fn;
}

afterEach(() => {
  runtime.sendMessage = originalSend;
  delete runtime.id;
  document.body.replaceChildren();
  (globalThis as unknown as { __resetChromeStorage: () => void }).__resetChromeStorage();
});

function keydown(el: Element, init: KeyboardEventInit): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(ev);
  return ev;
}

describe('fillTemplate', () => {
  test('replaces $n with nodes, keeps surrounding text', () => {
    const kbd = document.createElement('kbd');
    kbd.textContent = 'K';
    const div = document.createElement('div');
    div.append(fillTemplate('Press $1 now ($2)', kbd, 'x'));
    expect(div.innerHTML).toBe('Press <kbd>K</kbd> now (x)');
  });
});

describe('connect form', () => {
  function setup(onConnected = jest.fn()): { form: HTMLFormElement; input: HTMLInputElement; onConnected: jest.Mock } {
    const el = renderConnectForm({ variant: 'popup', onConnected });
    document.body.append(el);
    return { form: el.querySelector('form') as HTMLFormElement, input: el.querySelector('input') as HTMLInputElement, onConnected };
  }

  test('rejects malformed tokens inline without calling the background', async () => {
    const bg = mockBackground(() => undefined);
    const { form, input } = setup();
    input.value = 'hello';
    form.requestSubmit();
    await flush();
    expect(bg).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const errorId = input.getAttribute('aria-describedby')?.split(' ')[0] ?? '';
    const error = document.getElementById(errorId);
    expect(error?.hidden).toBe(false);
    expect(error?.textContent).toMatch(/github_pat_/);
    // Editing clears the error (no timers involved).
    input.value = 'x';
    input.dispatchEvent(new Event('input'));
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(error?.hidden).toBe(true);
  });

  test('sends the token to the background and reports success', async () => {
    const status: AuthStatus = {
      authenticated: true,
      account: { login: 'mona', name: 'Mona', avatarUrl: 'https://avatars.githubusercontent.com/u/1', htmlUrl: 'https://github.com/mona' },
    };
    const bg = mockBackground((msg) => (msg.type === 'auth:setToken' ? status : undefined));
    const { form, input, onConnected } = setup();
    input.value = `  ${FINE} `;
    form.requestSubmit();
    await flush();
    expect(bg).toHaveBeenCalledWith({ type: 'auth:setToken', token: FINE });
    expect(onConnected).toHaveBeenCalledWith(expect.objectContaining({ authenticated: true }));
    expect(input.value).toBe('');
  });

  test('distinguishes an invalid token from a network problem', async () => {
    mockBackground(() => ({ authenticated: false, error: 'HTTP 401: Bad credentials' }));
    const { form, input, onConnected } = setup();
    input.value = FINE;
    form.requestSubmit();
    await flush();
    expect(onConnected).not.toHaveBeenCalled();
    expect(document.body.textContent).toMatch(/didn’t accept this token/);

    mockBackground(() => ({ authenticated: false, error: 'Network error: Failed to fetch' }));
    form.requestSubmit();
    await flush();
    expect(document.body.textContent).toMatch(/Couldn’t reach GitHub/);
  });

  test('reveal toggle flips the input type and aria-pressed', () => {
    const { input } = setup();
    const reveal = document.querySelector('[aria-pressed]') as HTMLButtonElement;
    expect(input.type).toBe('password');
    reveal.click();
    expect(input.type).toBe('text');
    expect(reveal.getAttribute('aria-pressed')).toBe('true');
    reveal.click();
    expect(input.type).toBe('password');
  });
});

describe('API meter', () => {
  test('exposes a labelled meter with a tone', () => {
    const el = renderApiMeter({ remaining: 400, limit: 5000, reset: null });
    expect(el?.dataset.tone).toBe('attention');
    const meter = el?.querySelector('[role="meter"]');
    expect(meter?.getAttribute('aria-valuenow')).toBe('400');
    expect(meter?.getAttribute('aria-valuemax')).toBe('5000');
    expect(renderApiMeter({ remaining: null, limit: 5000, reset: null })).toBeNull();
    expect(renderApiMeter(undefined)).toBeNull();
  });
});

describe('inline confirm', () => {
  test('two-step confirm with cancel / Escape and a double-click guard', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Sign out';
    document.body.append(trigger);
    const onConfirm = jest.fn(() => true);
    attachInlineConfirm(trigger, { confirmLabel: 'Sign out', onConfirm });

    trigger.click();
    expect(trigger.hidden).toBe(true);
    const group = document.querySelector('.confirm-group') as HTMLElement;
    const [cancel, confirm] = group.querySelectorAll('button');
    confirm.click(); // within the guard window: ignored
    expect(onConfirm).not.toHaveBeenCalled();

    keydown(group, { key: 'Escape' });
    expect(trigger.hidden).toBe(false);
    expect(document.querySelector('.confirm-group')).toBeNull();

    trigger.click();
    (document.querySelector('.confirm-group button') as HTMLButtonElement).click(); // cancel
    expect(trigger.hidden).toBe(false);
    expect(cancel).toBeTruthy();

    trigger.click();
    await flush(400);
    (document.querySelectorAll('.confirm-group button')[1] as HTMLButtonElement).click();
    await flush();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(trigger.hidden).toBe(false);
  });
});

describe('shortcut editor', () => {
  function setup(): { view: ShortcutsView; key: (action: string) => HTMLButtonElement; row: (action: string) => HTMLElement } {
    const view = new ShortcutsView(undefined);
    document.body.append(view.el);
    const row = (action: string): HTMLElement => view.el.querySelector(`[data-action="${action}"]`) as HTMLElement;
    return { view, row, key: (action) => row(action).querySelector('.keycap-btn') as HTMLButtonElement };
  }

  const stored = async (): Promise<Record<string, unknown>> =>
    (await readSettingItems([SHORTCUTS_STORAGE_KEY]))[SHORTCUTS_STORAGE_KEY] as Record<string, unknown>;

  test('records on the clicked button only and saves', async () => {
    const { key } = setup();
    const btn = key('copyBranch');
    btn.focus();
    btn.click();
    expect(btn.getAttribute('aria-pressed')).toBe('true');

    // A key pressed elsewhere on the page is not captured.
    const outside = keydown(document.body, { key: 'x', code: 'KeyX', altKey: true });
    expect(outside.defaultPrevented).toBe(false);
    expect(btn.getAttribute('aria-pressed')).toBe('true');

    const ev = keydown(btn, { key: 'x', code: 'KeyX', altKey: true });
    expect(ev.defaultPrevented).toBe(true);
    await flush();
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect((await stored()).copyBranch).toMatchObject({ code: 'KeyX', alt: true });
    expect(btn.textContent).toContain('X');
  });

  test('bare keys show a persistent inline error and keep recording', async () => {
    const { key, row } = setup();
    const btn = key('copyBranch');
    btn.click();
    keydown(btn, { key: 'x', code: 'KeyX' });
    await flush();
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.getAttribute('aria-invalid')).toBe('true');
    expect(row('copyBranch').querySelector('.sc-message')?.textContent).toMatch(/Ctrl, Alt or ⌘/);
    expect(await stored()).toBeUndefined();
  });

  test('Escape cancels and Tab is never recorded', async () => {
    const { key } = setup();
    const btn = key('copyBranch');
    btn.click();
    keydown(btn, { key: 'Escape', code: 'Escape' });
    await flush();
    expect(btn.getAttribute('aria-pressed')).toBe('false');

    btn.click();
    const tab = keydown(btn, { key: 'Tab', code: 'Tab' });
    expect(tab.defaultPrevented).toBe(false);
    await flush();
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(await stored()).toBeUndefined();
  });

  test('Backspace unbinds; per-row Reset restores the default', async () => {
    const { key, row } = setup();
    const btn = key('copyBranch');
    btn.click();
    keydown(btn, { key: 'Backspace', code: 'Backspace' });
    await flush();
    expect((await stored()).copyBranch).toBeNull();
    const reset = row('copyBranch').querySelector('.sc-reset') as HTMLButtonElement;
    expect(reset.hidden).toBe(false);
    reset.click();
    await flush();
    expect((await stored()).copyBranch).toEqual(defaultBindings().copyBranch);
    expect(reset.hidden).toBe(true);
  });

  test('duplicates are reported per row and can be replaced', async () => {
    const { key, row } = setup();
    const btn = key('copyBranch');
    btn.click();
    keydown(btn, { key: 'c', code: 'KeyC', altKey: true }); // Alt+C = toggleComments
    await flush();
    const message = row('copyBranch').querySelector('.sc-message') as HTMLElement;
    expect(message.textContent).toMatch(/already used by/);
    expect(await stored()).toBeUndefined();

    (message.querySelector('.sc-replace') as HTMLButtonElement).click();
    await flush();
    const saved = await stored();
    expect(saved.copyBranch).toMatchObject({ code: 'KeyC', alt: true });
    expect(saved.toggleComments).toBeNull();
    expect(key('toggleComments').textContent).toMatch(/Not set/);
  });

  test('the Enter that starts recording is not recorded', async () => {
    const { key } = setup();
    const btn = key('copyBranch');
    keydown(btn, { key: 'Enter', code: 'Enter' }); // held while the click fires
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    keydown(btn, { key: 'Enter', code: 'Enter', repeat: true });
    await flush();
    expect(btn.hasAttribute('aria-invalid')).toBe(false);
    btn.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  test('blur cancels recording', () => {
    const { key } = setup();
    const btn = key('copyBranch');
    btn.focus();
    btn.click();
    btn.blur();
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('popup inbox view', () => {
  function pr(n: number, over: Partial<InboxItem> = {}): InboxItem {
    return {
      url: `https://github.com/o/r/pull/${n}`,
      repo: 'o/r',
      number: n,
      title: `Title <b>${n}</b>`,
      author: 'mona',
      authorAvatarUrl: null,
      isDraft: false,
      updatedAt: new Date(Date.now() - n * 60_000).toISOString(),
      reasons: ['review-requested'],
      reviewDecision: null,
      checks: 'SUCCESS',
      unresolvedThreads: 0,
      additions: 10,
      deletions: 2,
      hasConflicts: false,
      unseen: n === 1,
      ...over,
    };
  }

  test('renders tabs, rows (escaped), opens and marks seen', () => {
    const onOpen = jest.fn();
    const view = new InboxView({ onOpen, onMarkAllSeen: jest.fn(), onRetry: jest.fn(), onTabChange: jest.fn(), pin: jest.fn(), snooze: jest.fn() }, null);
    document.body.append(view.el);
    view.setInbox({ items: [pr(1), pr(2), pr(3, { reasons: ['authored'] })], unseenCount: 1, fetchedAt: Date.now() });

    const tabs = view.el.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    const rows = view.el.querySelectorAll<HTMLAnchorElement>('.pr-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('.pr-title')?.innerHTML).toContain('&lt;b&gt;1&lt;/b&gt;');
    expect(rows[0].classList.contains('is-unseen')).toBe(true);
    expect(view.el.querySelector('.btn-link')?.hasAttribute('hidden')).toBe(false);

    rows[0].click();
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ number: 1 }), false);
    view.markSeen([rows[0].dataset.url ?? '']);
    expect(rows[0].classList.contains('is-unseen')).toBe(false);
    expect((view.el.querySelector('.btn-link') as HTMLButtonElement).hidden).toBe(true);

    // Arrow keys move between rows (roving tabindex).
    rows[0].focus();
    keydown(rows[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
  });

  test('switches tabs with the keyboard and shows empty states', () => {
    const view = new InboxView({ onOpen: jest.fn(), onMarkAllSeen: jest.fn(), onRetry: jest.fn(), onTabChange: jest.fn(), pin: jest.fn(), snooze: jest.fn() }, null);
    document.body.append(view.el);
    view.setInbox({ items: [pr(1)], unseenCount: 1, fetchedAt: Date.now() });
    const first = view.el.querySelector('[role="tab"]') as HTMLElement;
    first.focus();
    keydown(first, { key: 'ArrowRight' });
    expect(view.currentTab).toBe('authored');
    expect(view.el.querySelector('.empty-title')?.textContent).toBe('No open pull requests');
  });

  test('error with nothing to show offers a retry', () => {
    const onRetry = jest.fn();
    const view = new InboxView({ onOpen: jest.fn(), onMarkAllSeen: jest.fn(), onRetry, onTabChange: jest.fn(), pin: jest.fn(), snooze: jest.fn() }, null);
    document.body.append(view.el);
    view.showError('Boom');
    (view.el.querySelector('.empty button') as HTMLButtonElement).click();
    expect(onRetry).toHaveBeenCalled();
    expect(view.el.textContent).toContain('Boom');
  });
});

import { closeMenu, isMenuOpen, openMenu, whenMenuClosed } from '../src/pages/menu';

describe('menu: deferred work until close', () => {
  test('whenMenuClosed runs immediately without a menu, and after close() otherwise', async () => {
    const now = jest.fn();
    whenMenuClosed(now);
    expect(now).toHaveBeenCalledTimes(1);

    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    openMenu(trigger, [{ label: 'Pin', onSelect: () => undefined }], { label: 'Actions' });
    expect(isMenuOpen()).toBe(true);
    const later = jest.fn();
    whenMenuClosed(later);
    await Promise.resolve();
    expect(later).not.toHaveBeenCalled();
    closeMenu(false);
    await Promise.resolve();
    expect(later).toHaveBeenCalledTimes(1);
    expect(isMenuOpen()).toBe(false);
    trigger.remove();
  });
});
