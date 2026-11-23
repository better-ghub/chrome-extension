// PR list: token routing hint and the "needs a token" / SSO notices.

import { PRListController } from '../src/features/pr-list/controller';
import { displayOwner, pickListNotice, type ListNoticeInput } from '../src/features/pr-list/notice';

const NOW = Date.parse('2026-11-22T12:00:00Z');

function input(over: Partial<ListNoticeInput> = {}): ListNoticeInput {
  return {
    now: NOW,
    rateLimitedUntil: 0,
    ssoUrl: null,
    needsToken: null,
    accessError: null,
    pageOwner: 'Acme',
    hasModels: false,
    busy: false,
    tokenNoticeDismissed: false,
    ...over,
  };
}

describe('pickListNotice', () => {
  test('nothing wrong → no notice (summary)', () => {
    expect(pickListNotice(input())).toBeNull();
    expect(pickListNotice(input({ hasModels: true }))).toBeNull();
  });

  test('needsToken replaces the generic "can’t read" message', () => {
    expect(pickListNotice(input({ needsToken: 'acme', accessError: 'NOT_FOUND' }))).toEqual({ kind: 'needs-token', owner: 'Acme' });
  });

  test('ssoUrl wins over needsToken (an existing token would work)', () => {
    expect(pickListNotice(input({ needsToken: 'acme', ssoUrl: 'https://github.com/orgs/acme/sso' }))).toEqual({
      kind: 'sso',
      owner: 'Acme',
      url: 'https://github.com/orgs/acme/sso',
    });
    expect(pickListNotice(input({ ssoUrl: 'https://github.com/orgs/acme/sso' }))).toMatchObject({ kind: 'sso', owner: 'Acme' });
  });

  test('the rate limit wins over everything while it lasts', () => {
    expect(pickListNotice(input({ rateLimitedUntil: NOW + 60_000, needsToken: 'acme' }))).toEqual({
      kind: 'rate-limited',
      until: NOW + 60_000,
    });
    expect(pickListNotice(input({ rateLimitedUntil: NOW - 1, needsToken: 'acme' }))?.kind).toBe('needs-token');
  });

  test('generic message only when nothing loaded and nothing is loading', () => {
    expect(pickListNotice(input({ accessError: 'NOT_FOUND' }))).toEqual({ kind: 'no-access' });
    expect(pickListNotice(input({ accessError: 'NOT_FOUND', busy: true }))).toBeNull();
    expect(pickListNotice(input({ accessError: 'NOT_FOUND', hasModels: true }))).toBeNull();
  });

  test('a dismissed token notice is not replaced by the generic one', () => {
    expect(pickListNotice(input({ needsToken: 'acme', accessError: 'x', tokenNoticeDismissed: true }))).toEqual({ kind: 'dismissed' });
    expect(pickListNotice(input({ ssoUrl: 'https://github.com/x', tokenNoticeDismissed: true }))).toEqual({ kind: 'dismissed' });
  });

  test('displayOwner keeps the page’s spelling for the same login', () => {
    expect(displayOwner('acme', 'Acme')).toBe('Acme');
    expect(displayOwner('other', 'Acme')).toBe('other');
    expect(displayOwner(null, 'Acme')).toBe('Acme');
  });
});

// ------------------------------------------------------------ controller

type Msg = { type: string; owner?: string; section?: string; variables?: Record<string, unknown> };
let sendMessage: jest.Mock;

function fixture(numbers: number[]): void {
  const row = (n: number): string => `
    <li>
      <div>
        <div data-listview-item-title-container="true">
          <h3><a data-testid="listitem-title-link" href="/Acme/r/pull/${n}">PR ${n}</a></h3>
        </div>
        <div><span>#${n}</span></div>
      </div>
    </li>`;
  document.body.innerHTML = `<main><ul data-listview-component="items-list">${numbers.map(row).join('')}</ul></main>`;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

function controller(signal: AbortSignal): PRListController {
  return new PRListController({ signal, owner: 'Acme', repo: 'r', authenticated: true, noticeDismissed: false, viewer: 'me', withLabels: false });
}

function respond(graphql: unknown): void {
  sendMessage = jest.fn((msg: Msg) => Promise.resolve(msg.type === 'api:graphql' ? graphql : { ok: true }));
  chrome.runtime.sendMessage = sendMessage as unknown as typeof chrome.runtime.sendMessage;
}

beforeEach(() => {
  (globalThis as unknown as { __resetChromeStorage: () => void }).__resetChromeStorage();
});

test('every GraphQL request carries the page owner for token routing', async () => {
  respond({ ok: true, data: { pr1: null } });
  fixture([1]);
  const ac = new AbortController();
  controller(ac.signal).scan();
  await settle();
  const call = sendMessage.mock.calls.find(([m]) => (m as Msg).type === 'api:graphql')?.[0] as Msg;
  expect(call.owner).toBe('Acme');
  ac.abort();
});

test('needsToken: "Add token" opens the add-token form for that owner; dismissible', async () => {
  respond({ ok: false, error: 'NOT_FOUND', data: { pr1: null, pr2: null }, needsToken: { owner: 'acme' } });
  fixture([1, 2]);
  const ac = new AbortController();
  const c = controller(ac.signal);
  c.scan();
  await settle();

  const bar = document.querySelector<HTMLElement>('.bghub-prl-bar')!;
  expect(bar.hidden).toBe(false);
  expect(bar.textContent).toContain('Private pull requests of Acme need a token for Acme.');
  expect(bar.textContent).not.toContain("can't read");
  expect(document.querySelector('[role="status"]')?.textContent).toBe('Private pull requests of Acme need a token for Acme.');
  // Rows that no token can read are not retried.
  expect(document.querySelectorAll('.bghub-prl-slot')).toHaveLength(0);

  const add = [...bar.querySelectorAll('button')].find((b) => b.textContent === 'Add token')!;
  add.click();
  await settle();
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ui:openOptions', section: 'add-token/Acme' }));

  bar.querySelector<HTMLButtonElement>('.bghub-prl-dismiss')!.click();
  expect(bar.hidden).toBe(true);
  c.scan(); // stays dismissed for this page view, without the generic message
  expect(bar.hidden).toBe(true);
  expect(c.notice()).toEqual({ kind: 'dismissed' });
  ac.abort();
});

test('ssoUrl: links to the authorization page in a new tab', async () => {
  respond({ ok: false, error: 'SAML', data: null, ssoUrl: 'https://github.com/orgs/acme/sso?authorization_request=1' });
  fixture([1]);
  const ac = new AbortController();
  controller(ac.signal).scan();
  await settle();

  const link = document.querySelector<HTMLAnchorElement>('.bghub-prl-bar a')!;
  expect(link.textContent).toContain('Authorize your token for Acme (SSO)');
  expect(link.href).toBe('https://github.com/orgs/acme/sso?authorization_request=1');
  expect(link.target).toBe('_blank');
  expect(link.rel).toContain('noopener');
  expect(document.querySelector('.bghub-prl-dismiss')).not.toBeNull();
  ac.abort();
});

test('an unsafe ssoUrl is ignored (falls back to the generic message)', async () => {
  respond({ ok: false, error: 'SAML', data: { pr1: null }, ssoUrl: 'javascript:alert(1)' });
  fixture([1]);
  const ac = new AbortController();
  controller(ac.signal).scan();
  await settle();
  expect(document.querySelector('.bghub-prl-bar a')).toBeNull();
  expect(document.querySelector('.bghub-prl-bar')?.textContent).toContain("can't read pull requests");
  ac.abort();
});
