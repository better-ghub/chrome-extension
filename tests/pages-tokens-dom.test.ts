// jsdom: the Options token list / add form, the popup token summary and the
// #add-token/<owner> route, against a mocked background.

import type { AuthStatus, GitHubAccount, TokenSummary } from '../src/core/messages';
import { renderAccountCard } from '../src/pages/auth-view';
import { TokensPanel } from '../src/pages/tokens-view';
import { AccountSection } from '../options/account-view';

type Msg = { type: string; [k: string]: unknown };
type Runtime = { id?: string; sendMessage: unknown };
const runtime = chrome.runtime as unknown as Runtime;
const originalSend = runtime.sendMessage;
const flush = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
const FINE = `github_pat_${'A1b2C3d4E5'.repeat(8)}x`;
const DAY = 24 * 3_600_000;

const ACCOUNT: GitHubAccount = {
  login: 'mona',
  name: 'Mona',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1',
  htmlUrl: 'https://github.com/mona',
};

function token(over: Partial<TokenSummary> & { id: string }): TokenSummary {
  return {
    kind: 'fine-grained',
    hint: 'a1b2',
    owners: ['mona'],
    publicOnly: false,
    addedAt: '2026-11-01T00:00:00Z',
    expiresAt: null,
    problem: null,
    ssoUrl: null,
    ...over,
  };
}

function status(tokens: TokenSummary[], extra: Partial<AuthStatus> = {}): AuthStatus {
  return { authenticated: true, account: ACCOUNT, tokens, ...extra };
}

function mockBackground(handler: (msg: Msg) => unknown): jest.Mock {
  const fn = jest.fn((msg: Msg) => Promise.resolve(handler(msg)));
  runtime.id = 'test-extension';
  runtime.sendMessage = fn;
  return fn;
}

/** Text of the shared screen-reader announcer (set on the next frame). */
async function announced(): Promise<string> {
  await flush(20);
  return document.getElementById('bghub-announcer')?.textContent ?? '';
}

/** Click the inline confirm's confirm button past its double-click guard. */
async function confirmInline(): Promise<void> {
  const now = performance.now();
  const spy = jest.spyOn(performance, 'now').mockReturnValue(now + 1000);
  const buttons = document.querySelectorAll<HTMLButtonElement>('.confirm-group button');
  buttons[buttons.length - 1].click();
  await flush();
  await flush();
  spy.mockRestore();
}

beforeAll(() => {
  // Reduced motion: no exit/cross-fade waits.
  (window as unknown as { matchMedia: unknown }).matchMedia = (q: string) => ({ matches: /reduce/.test(q), media: q });
});

afterEach(() => {
  runtime.sendMessage = originalSend;
  delete runtime.id;
  document.body.replaceChildren();
  jest.restoreAllMocks();
});

describe('token list', () => {
  test('rows show kind, coverage, hint, expiry and problems', () => {
    const now = Date.now();
    const panel = new TokensPanel(
      status([
        token({ id: 'a', owners: ['acme', 'octo-org'], expiresAt: new Date(now + 3 * DAY).toISOString() }),
        token({ id: 'b', kind: 'classic', hint: 'c3d4', owners: null, problem: 'sso', ssoUrl: 'https://github.com/orgs/acme/sso' }),
        token({ id: 'c', hint: 'e5f6', owners: [], publicOnly: true, expiresAt: new Date(now - DAY).toISOString(), problem: 'invalid' }),
      ]),
      { onChange: jest.fn(), onSignedOut: jest.fn() }
    );
    document.body.append(panel.el);
    const rows = panel.el.querySelectorAll<HTMLElement>('.token-row');
    expect(rows).toHaveLength(3);
    expect(panel.el.querySelector('.counter')?.textContent).toBe('3');

    expect(rows[0].querySelector('.badge')?.textContent).toBe('Fine-grained');
    expect(rows[0].querySelector('.token-coverage')?.textContent).toBe('Private repos: acme, octo-org');
    expect(rows[0].querySelector('.token-hint')?.textContent).toBe('…a1b2');
    expect(rows[0].querySelector<HTMLElement>('.token-expiry')?.dataset.tone).toBe('attention');
    expect(rows[0].querySelector('.token-expiry')?.textContent).toBe('Expires in 3 days');

    expect(rows[1].querySelector('.badge')?.textContent).toBe('Classic');
    expect(rows[1].querySelector('.token-coverage')?.textContent).toBe('All your organizations');
    expect(rows[1].querySelector('.token-expiry')?.textContent).toBe('No expiration');
    const sso = rows[1].querySelector<HTMLAnchorElement>('a.token-problem');
    expect(sso?.textContent).toContain('Authorize SSO');
    expect(sso?.href).toBe('https://github.com/orgs/acme/sso');
    expect(sso?.target).toBe('_blank');
    expect(sso?.rel).toContain('noopener');

    expect(rows[2].querySelector('.token-coverage')?.textContent).toBe('Public repositories only — pending organization approval?');
    expect(rows[2].querySelector<HTMLElement>('.token-expiry')?.dataset.tone).toBe('danger');
    expect(rows[2].querySelector('.token-problem')?.textContent).toContain('Revoked or expired — remove it');
    expect(rows[2].dataset.problem).toBe('invalid');
    expect(rows[1].dataset.problem).toBe('sso');
    expect(rows[0].dataset.problem).toBe('none');

    expect(rows[0].querySelector('.token-remove')?.getAttribute('aria-label')).toBe('Remove token …a1b2');
  });
});

describe('adding a token', () => {
  function setup(tokens = [token({ id: 'a' })]): { panel: TokensPanel; onChange: jest.Mock } {
    const onChange = jest.fn();
    const panel = new TokensPanel(status(tokens), { onChange, onSignedOut: jest.fn() });
    document.body.append(panel.el);
    return { panel, onChange };
  }
  const q = <T extends Element>(sel: string): T => document.querySelector(sel) as T;

  test('the toggle reveals the form; the organization builds the GitHub link', () => {
    setup();
    const toggle = q<HTMLButtonElement>('.tokens-add-toggle');
    const panel = q<HTMLElement>('.tokens-add-panel');
    expect(panel.hidden).toBe(true);
    expect(toggle.getAttribute('aria-controls')).toBe(panel.id);
    toggle.click();
    expect(panel.hidden).toBe(false);
    expect(toggle.hidden).toBe(true);
    const org = q<HTMLInputElement>('input[name="organization"]');
    expect(document.activeElement).toBe(org);
    expect(document.querySelector(`label[for="${org.id}"]`)?.textContent).toContain('Organization');

    const link = q<HTMLAnchorElement>('.tokens-add-panel a.connect-create-btn');
    expect(new URL(link.href).searchParams.has('target_name')).toBe(false);
    org.value = 'acme';
    org.dispatchEvent(new Event('input'));
    expect(new URL(link.href).searchParams.get('target_name')).toBe('acme');
    expect(link.textContent).toContain('Create a token for acme');

    org.value = 'not valid!';
    org.dispatchEvent(new Event('input'));
    expect(org.getAttribute('aria-invalid')).toBe('true');
    expect(q<HTMLElement>('.field-warning').hidden).toBe(false);
    expect(new URL(link.href).searchParams.has('target_name')).toBe(false);

    // The classic-token alternative lives in the existing disclosure.
    expect(panel.querySelector('details')?.textContent).toMatch(/classic token covers every organization/);

    // Cancel collapses, resets and returns focus to the toggle.
    const cancel = [...panel.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!;
    cancel.click();
    expect(panel.hidden).toBe(true);
    expect(org.value).toBe('');
    expect(document.activeElement).toBe(toggle);
  });

  test('success: the new row animates in, the form collapses and focus moves to the row', async () => {
    const next = status([token({ id: 'a' }), token({ id: 'b', hint: 'z9z9', owners: ['acme'] })]);
    const bg = mockBackground((msg) => (msg.type === 'auth:setToken' ? next : undefined));
    const { panel, onChange } = setup();
    panel.expandAdd('acme');
    const input = q<HTMLInputElement>('.tokens-add-panel input[name="token"]');
    expect(document.activeElement).toBe(input);
    input.value = FINE;
    q<HTMLFormElement>('.tokens-add-panel form').requestSubmit();
    await flush();

    expect(bg).toHaveBeenCalledWith({ type: 'auth:setToken', token: FINE });
    expect(onChange).toHaveBeenCalledWith(next);
    const rows = document.querySelectorAll<HTMLElement>('.token-row');
    expect(rows).toHaveLength(2);
    expect(rows[1].classList.contains('anim-row-in')).toBe(true);
    expect(rows[0].classList.contains('anim-row-in')).toBe(false);
    expect(document.activeElement).toBe(rows[1]);
    expect(q<HTMLElement>('.tokens-add-panel').hidden).toBe(true);
    expect(q<HTMLButtonElement>('.tokens-add-toggle').hidden).toBe(false);
    expect(input.value).toBe('');
    expect(q<HTMLElement>('.tokens-note').childElementCount).toBe(0);
    expect(await announced()).toBe('Token added. Private repos: acme');
  });

  test('a token that doesn’t reach the requested organization explains why', async () => {
    mockBackground(() => status([token({ id: 'a' }), token({ id: 'b', owners: [], publicOnly: true })]));
    const { panel } = setup();
    panel.expandAdd('acme');
    q<HTMLInputElement>('.tokens-add-panel input[name="token"]').value = FINE;
    q<HTMLFormElement>('.tokens-add-panel form').requestSubmit();
    await flush();
    expect(q<HTMLElement>('.tokens-note').textContent).toMatch(/can’t read private repositories of acme yet/);
  });

  test.each([
    ['duplicate', 'This token is already added.'],
    ['different-account', 'This token belongs to a different GitHub account. Use a token created by @mona.'],
    ['different-account:octocat', 'This token belongs to @octocat, not @mona.'],
    ['invalid', 'GitHub didn’t accept this token.'],
  ])('error %s keeps the form open with a specific message', async (error, message) => {
    mockBackground(() => status([token({ id: 'a' })], { error }));
    const { panel, onChange } = setup();
    panel.expandAdd();
    const input = q<HTMLInputElement>('.tokens-add-panel input[name="token"]');
    input.value = FINE;
    q<HTMLFormElement>('.tokens-add-panel form').requestSubmit();
    await flush();
    expect(onChange).not.toHaveBeenCalled();
    expect(q<HTMLElement>('.tokens-add-panel').hidden).toBe(false);
    expect(q<HTMLElement>('.tokens-add-panel .field-error').textContent).toContain(message);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.querySelectorAll('.token-row')).toHaveLength(1);
  });

  test('a background that doesn’t answer is an error, not a sign-out', async () => {
    mockBackground(() => undefined);
    const { panel } = setup();
    panel.expandAdd();
    q<HTMLInputElement>('.tokens-add-panel input[name="token"]').value = FINE;
    q<HTMLFormElement>('.tokens-add-panel form').requestSubmit();
    await flush();
    expect(q<HTMLElement>('.tokens-add-panel .field-error').textContent).toMatch(/background service isn’t responding/);
  });
});

describe('removing a token', () => {
  test('two-step confirm, then the row leaves and focus moves to the next row', async () => {
    const bg = mockBackground((msg) => (msg.type === 'auth:removeToken' ? status([token({ id: 'b', hint: 'c3d4' })]) : undefined));
    const onChange = jest.fn();
    const panel = new TokensPanel(status([token({ id: 'a' }), token({ id: 'b', hint: 'c3d4' })]), { onChange, onSignedOut: jest.fn() });
    document.body.append(panel.el);

    document.querySelector<HTMLButtonElement>('.token-row .token-remove')!.click();
    expect(document.querySelector('.confirm-question')?.textContent).toBe('Remove this token?');
    expect(bg).not.toHaveBeenCalled();
    await confirmInline();

    expect(bg).toHaveBeenCalledWith({ type: 'auth:removeToken', id: 'a' });
    const rows = document.querySelectorAll<HTMLElement>('.token-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].dataset.tokenId).toBe('b');
    expect(document.activeElement).toBe(rows[0].querySelector('.token-remove'));
    expect(onChange).toHaveBeenCalled();
    expect(await announced()).toBe('Token removed');
  });

  test('removing the only token says it signs out, and does', async () => {
    mockBackground(() => ({ authenticated: false }));
    const onSignedOut = jest.fn();
    const panel = new TokensPanel(status([token({ id: 'a' })]), { onChange: jest.fn(), onSignedOut });
    document.body.append(panel.el);
    document.querySelector<HTMLButtonElement>('.token-remove')!.click();
    expect(document.querySelector('.confirm-question')?.textContent).toBe('This is your only token. Remove it and sign out?');
    expect(document.querySelectorAll('.confirm-group button')[1].textContent).toBe('Remove and sign out');
    await confirmInline();
    expect(onSignedOut).toHaveBeenCalled();
  });

  test('a failed removal keeps the row and says so', async () => {
    mockBackground((msg) => (msg.type === 'auth:removeToken' ? status([token({ id: 'a' }), token({ id: 'b' })]) : undefined));
    const onChange = jest.fn();
    const panel = new TokensPanel(status([token({ id: 'a' }), token({ id: 'b' })]), { onChange, onSignedOut: jest.fn() });
    document.body.append(panel.el);
    document.querySelector<HTMLButtonElement>('.token-remove')!.click();
    await confirmInline();
    expect(document.querySelectorAll('.token-row')).toHaveLength(2);
    expect(onChange).not.toHaveBeenCalled();
    expect(document.querySelector('.toast')?.textContent).toMatch(/Couldn’t remove the token/);
  });
});

describe('account card', () => {
  test('popup: compact coverage line with an attention dot and a Manage link', () => {
    const onManageTokens = jest.fn();
    const soon = new Date(Date.now() + 2 * DAY).toISOString();
    const card = renderAccountCard(status([token({ id: 'a', owners: ['acme'] }), token({ id: 'b', owners: ['octo-org'], expiresAt: soon })]), {
      variant: 'popup',
      onSignedOut: jest.fn(),
      onManageTokens,
    });
    document.body.append(card);
    const line = card.querySelector<HTMLElement>('.account-tokens')!;
    expect(line.querySelector('.account-tokens-text')?.textContent).toBe('2 tokens · acme, octo-org');
    expect(line.querySelector('.dot-attention')).not.toBeNull();
    expect(line.textContent).toContain('A token needs attention');
    const manage = line.querySelector<HTMLAnchorElement>('.account-tokens-manage')!;
    expect(manage.getAttribute('href')).toBe('../options/options.html#account');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    manage.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(onManageTokens).toHaveBeenCalled();
  });

  test('popup: no dot when every token is healthy; classic covers all organizations', () => {
    const card = renderAccountCard(status([token({ id: 'a', kind: 'classic', owners: null })]), { variant: 'popup', onSignedOut: jest.fn() });
    expect(card.querySelector('.account-tokens-text')?.textContent).toBe('1 token · all organizations');
    expect(card.querySelector('.dot-attention')).toBeNull();
  });

  test('page: the token list sits between the account row and the footer', () => {
    const panel = new TokensPanel(status([token({ id: 'a' })]), { onChange: jest.fn(), onSignedOut: jest.fn() });
    const card = renderAccountCard(status([token({ id: 'a' })], { tokenKind: 'fine-grained' }), {
      variant: 'page',
      onSignedOut: jest.fn(),
      body: panel.el,
    });
    expect(card.lastElementChild?.classList.contains('account-foot')).toBe(true);
    expect(card.lastElementChild?.previousElementSibling).toBe(panel.el);
    // Kinds are shown per token, not next to the login.
    expect(card.querySelector('.account-sub .badge')).toBeNull();
  });
});

describe('#add-token/<owner> route', () => {
  test('opens the add form prefilled once the account has loaded, focusing the token input', async () => {
    mockBackground((msg) => (msg.type === 'auth:status' ? status([token({ id: 'a' })]) : undefined));
    const card = document.createElement('div');
    const hero = document.createElement('div');
    document.body.append(card, hero);
    const section = new AccountSection(card, hero);
    section.openAddToken('Octo-Org'); // before the status is known
    await section.load();

    const panel = card.querySelector<HTMLElement>('.tokens-add-panel')!;
    expect(panel.hidden).toBe(false);
    expect(card.querySelector<HTMLInputElement>('input[name="organization"]')?.value).toBe('Octo-Org');
    expect(document.activeElement).toBe(panel.querySelector('input[name="token"]'));
    const link = panel.querySelector<HTMLAnchorElement>('a.connect-create-btn')!;
    expect(new URL(link.href).searchParams.get('target_name')).toBe('Octo-Org');
  });

  test('signed out: the status is re-checked first, then the connect form gets focus', async () => {
    const bg = mockBackground(() => ({ authenticated: false }));
    const card = document.createElement('div');
    const hero = document.createElement('div');
    document.body.append(card, hero);
    const section = new AccountSection(card, hero);
    await section.load();
    expect(bg).toHaveBeenCalledTimes(1);
    section.openAddToken('acme');
    await flush(20);
    expect(bg).toHaveBeenCalledTimes(2); // the cached "signed out" may be stale
    expect(document.activeElement).toBe(card.querySelector('input[name="token"]'));
    expect(card.querySelector('.tokens-add-panel')).toBeNull();
  });

  test('a stale signed-out view (signed in from the popup since) opens the prefilled form', async () => {
    let signedIn = false;
    mockBackground((msg) => (msg.type === 'auth:status' ? (signedIn ? status([token({ id: 'a' })]) : { authenticated: false }) : undefined));
    const card = document.createElement('div');
    const hero = document.createElement('div');
    document.body.append(card, hero);
    const section = new AccountSection(card, hero);
    await section.load();
    expect(card.querySelector('.tokens')).toBeNull();

    signedIn = true;
    section.openAddToken('microsoft');
    await flush(20);
    const panel = card.querySelector<HTMLElement>('.tokens-add-panel')!;
    expect(panel.hidden).toBe(false);
    expect(card.querySelector<HTMLInputElement>('input[name="organization"]')?.value).toBe('microsoft');
    expect(document.activeElement).toBe(panel.querySelector('input[name="token"]'));
  });
});

describe('auth:changed broadcasts', () => {
  type Listener = (msg: unknown) => boolean | void;
  let listeners: Listener[];
  const originalOnMessage = chrome.runtime.onMessage;

  beforeEach(() => {
    listeners = [];
    (chrome.runtime as unknown as { onMessage: unknown }).onMessage = {
      addListener: (fn: Listener) => listeners.push(fn),
      removeListener: (fn: Listener) => (listeners = listeners.filter((l) => l !== fn)),
    };
  });

  afterEach(() => {
    (chrome.runtime as unknown as { onMessage: unknown }).onMessage = originalOnMessage;
  });

  function setup(): { card: HTMLElement; section: AccountSection } {
    const card = document.createElement('div');
    const hero = document.createElement('div');
    document.body.append(card, hero);
    return { card, section: new AccountSection(card, hero) };
  }

  test('signing in elsewhere refreshes the signed-out Account view', async () => {
    let signedIn = false;
    const bg = mockBackground((msg) => (msg.type === 'auth:status' ? (signedIn ? status([token({ id: 'a' })]) : { authenticated: false }) : undefined));
    const { card, section } = setup();
    await section.load();
    const off = section.listen();
    expect(listeners).toHaveLength(1);

    signedIn = true;
    listeners[0]({ type: 'auth:changed', authenticated: true });
    await flush(20);
    expect(bg).toHaveBeenCalledTimes(2);
    expect(card.querySelector('.tokens-list')).not.toBeNull();
    expect(card.querySelector('input[name="token"]')?.closest('.tokens-add-panel')).not.toBeNull();

    // Other broadcasts are ignored.
    listeners[0]({ type: 'cache:cleared' });
    await flush(20);
    expect(bg).toHaveBeenCalledTimes(2);
    off();
    expect(listeners).toHaveLength(0);
  });

  test('a broadcast about our own change keeps the view (no re-render)', async () => {
    mockBackground(() => status([token({ id: 'a' })]));
    const { card, section } = setup();
    await section.load();
    section.listen();
    const list = card.querySelector('.tokens-list');
    listeners[0]({ type: 'auth:changed', authenticated: true });
    await flush(20);
    expect(card.querySelector('.tokens-list')).toBe(list);
  });
});
