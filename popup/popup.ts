// Better GHub - Toolbar popup: account, pull request inbox and quick toggles.
//
// Everything that needs GitHub goes through the background worker (see
// src/core/messages.ts); this page never sees the stored token.

import { h } from '../src/core/dom';
import { icon } from '../src/core/icons';
import type { AuthStatus, BackgroundRequests, Inbox, InboxItem, TabBroadcast } from '../src/core/messages';
import { getSettings, onSettingsChanged, setSettings, type Settings } from '../src/core/settings';
import { initI18n, t, translatePage } from '../src/i18n';
import { normalizeBindings } from '../src/shortcuts';
import { authErrorMessage, connectedMessage, renderAccountCard, renderConnectForm, syncApiMeter } from '../src/pages/auth-view';
import { AUTH_TIMEOUT, AUTH_UNAVAILABLE, inboxFallback, normalizeAuthStatus, normalizeInbox, request, TIMEOUT } from '../src/pages/bg';
import { announce, btnLabel, fillTemplate, isBusy, keyCaps, SavedIndicator, setButtonBusy, swapContent, toast } from '../src/pages/dom-ui';
import type { InboxTab } from '../src/pages/inbox';
import { classifyAuthError, ERROR_TIMEOUT, ERROR_UNAVAILABLE } from '../src/pages/token';
import { buildSummary, copyText } from '../src/pages/summary';
import { InboxView } from './inbox-view';

type ViewState = 'loading' | 'signed-out' | 'signed-in' | 'error';

/** Per-popup conveniences (not settings): last auth state for the boot skeleton, last tab. */
const LAST_AUTH_KEY = 'bghub.popup.signedIn';
const LAST_TAB_KEY = 'bghub.popup.tab';

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: purely cosmetic */
  }
}

const app = byId('app');
const main = byId('main');
const refreshBtn = byId<HTMLButtonElement>('refresh');
const copyBtn = byId<HTMLButtonElement>('copy-summary');
const settingsBtn = byId<HTMLButtonElement>('open-settings');

let account: HTMLElement | null = null;
/** When the account card was last rendered (a broadcast right after our own change needn't redraw it). */
let accountRenderedAt = 0;
let inbox: InboxView | null = null;
let inboxLoading = false;

function setState(state: ViewState): void {
  app.dataset.state = state;
  refreshBtn.hidden = state !== 'signed-in';
  copyBtn.hidden = state !== 'signed-in';
  main.setAttribute('aria-busy', String(state === 'loading'));
}

// ------------------------------------------------------------------ boot

function bootSkeleton(signedIn: boolean): HTMLElement {
  if (!signedIn) {
    return h(
      'div',
      { class: 'boot-skeleton', attrs: { 'aria-hidden': 'true' } },
      h('span', { class: 'skeleton', style: { width: '48px', height: '48px', borderRadius: '50%' } }),
      h('span', { class: 'skeleton', style: { width: '70%', height: '16px' } }),
      h('span', { class: 'skeleton', style: { width: '90%', height: '12px' } }),
      h('span', { class: 'skeleton', style: { width: '100%', height: '32px' } })
    );
  }
  return h(
    'div',
    { class: 'boot-skeleton is-signed-in', attrs: { 'aria-hidden': 'true' } },
    h(
      'div',
      { class: 'boot-account' },
      h('span', { class: 'skeleton', style: { width: '36px', height: '36px', borderRadius: '50%' } }),
      h(
        'span',
        { class: 'boot-lines' },
        h('span', { class: 'skeleton', style: { width: '45%', height: '12px' } }),
        h('span', { class: 'skeleton', style: { width: '30%', height: '10px' } })
      )
    ),
    h('span', { class: 'skeleton', style: { width: '100%', height: '30px', borderRadius: '6px' } }),
    ...[0, 1, 2, 3].map(() =>
      h(
        'div',
        { class: 'pr-skeleton' },
        h('span', { class: 'skeleton pr-skeleton-icon' }),
        h(
          'span',
          { class: 'pr-skeleton-lines' },
          h('span', { class: 'skeleton', style: { width: '40%', height: '10px' } }),
          h('span', { class: 'skeleton', style: { width: '85%', height: '12px' } }),
          h('span', { class: 'skeleton', style: { width: '30%', height: '10px' } })
        )
      )
    )
  );
}

async function fetchAuth(refresh: boolean): Promise<AuthStatus> {
  return normalizeAuthStatus(await request('auth:status', { refresh }, AUTH_UNAVAILABLE, TIMEOUT.quick, AUTH_TIMEOUT));
}

/** Route an AuthStatus to the right view. */
async function applyAuth(status: AuthStatus, opts: { celebrate?: boolean; expired?: boolean } = {}): Promise<void> {
  if (status.authenticated) {
    writeLocal(LAST_AUTH_KEY, '1');
    await showSignedIn(status, !!opts.celebrate);
    return;
  }
  const kind = classifyAuthError(status.error);
  if (kind === 'unavailable' || kind === 'network') {
    await showProblem(status.error);
    return;
  }
  writeLocal(LAST_AUTH_KEY, '0');
  let notice: string | null = null;
  if (opts.expired) notice = t('authSessionExpired', 'GitHub no longer accepts your saved token. Connect again to continue.');
  else if (status.error) notice = `${t('authStoredTokenFailed', 'Your saved token stopped working.')} ${authErrorMessage(status.error)}`;
  await showSignedOut(notice);
}

async function showSignedOut(notice: string | null): Promise<void> {
  teardownInbox();
  account = null;
  setState('signed-out');
  const form = renderConnectForm({
    variant: 'popup',
    notice,
    onConnected: (status) => {
      announce(connectedMessage(status));
      void applyAuth(status, { celebrate: true }).then(() => loadInbox(true));
    },
  });
  await swapContent(main, form);
}

async function showProblem(error: string | undefined): Promise<void> {
  teardownInbox();
  setState('error');
  const unavailable = error === ERROR_UNAVAILABLE;
  const retry = h('button', { class: 'btn btn-sm', attrs: { type: 'button' } }, icon('sync', 14), btnLabel(t('commonRetry', 'Try again')));
  retry.addEventListener('click', () => {
    if (isBusy(retry)) return;
    setButtonBusy(retry, true);
    void boot(true);
  });
  await swapContent(
    main,
    h(
      'div',
      { class: 'empty popup-problem', attrs: { role: 'alert' } },
      h('div', { class: 'empty-icon', dataset: { tone: 'danger' } }, icon(unavailable ? 'plug' : 'alert', 24)),
      h('p', {
        class: 'empty-title',
        text: unavailable ? t('popupUnavailableTitle', 'Better GHub isn’t responding') : t('popupOfflineTitle', 'Can’t reach GitHub'),
      }),
      h('p', {
        class: 'empty-body',
        text: unavailable
          ? t('popupUnavailableBody', 'The extension’s background service didn’t answer. Try again, or reload the extension.')
          : error === ERROR_TIMEOUT
            ? t('authErrorNetwork', 'Couldn’t reach GitHub. Check your connection and try again.')
            : authErrorMessage(error),
      }),
      retry
    )
  );
  retry.focus();
}

async function showSignedIn(status: AuthStatus, celebrate: boolean): Promise<void> {
  teardownInbox();
  setState('signed-in');
  accountRenderedAt = Date.now();
  account = renderAccountCard(status, {
    variant: 'popup',
    celebrate,
    onSignedOut: () => {
      writeLocal(LAST_AUTH_KEY, '0');
      void showSignedOut(null);
    },
    onManageTokens: () => void openOptions('account'),
  });
  inbox = new InboxView(
    {
      onOpen: openPullRequest,
      onOpenUrl: openUrl,
      onMarkAllSeen: () => void markAllSeen(),
      onRetry: () => void loadInbox(true),
      onTabChange: (tab: InboxTab) => writeLocal(LAST_TAB_KEY, tab),
      pin: (url, pinned) => inboxAction('inbox:pin', { url, pinned }),
      snooze: (url, until) => inboxAction('inbox:snooze', { url, until }),
    },
    readLocal(LAST_TAB_KEY)
  );
  const view = h(
    'div',
    { class: 'signed-in' },
    h('section', { class: 'account-section', attrs: { 'aria-label': t('popupAccount', 'Account') } }, account),
    inbox.el
  );
  await swapContent(main, view);
}

function teardownInbox(): void {
  inbox?.destroy();
  inbox = null;
  inboxLoading = false;
  setRefreshing(false);
}

// ----------------------------------------------------------------- inbox

function setRefreshing(on: boolean): void {
  refreshBtn.classList.toggle('is-spinning', on);
  refreshBtn.setAttribute('aria-busy', String(on));
  inbox?.setRefreshing(on);
}

async function loadInbox(force: boolean): Promise<void> {
  const view = inbox;
  if (!view || inboxLoading) return;
  inboxLoading = true;
  setRefreshing(true);
  view.showLoading();
  const res = normalizeInbox(
    await request('inbox:get', { force }, inboxFallback(ERROR_UNAVAILABLE), TIMEOUT.inbox, inboxFallback(ERROR_TIMEOUT))
  );
  if (view !== inbox) return; // signed out (or re-rendered) meanwhile
  inboxLoading = false;
  setRefreshing(false);

  if (res.needsAuth) {
    await applyAuth({ authenticated: false }, { expired: true });
    return;
  }
  if (res.error === ERROR_UNAVAILABLE || res.error === ERROR_TIMEOUT) {
    view.showError(
      res.error === ERROR_TIMEOUT
        ? t('inboxErrorTimeout', 'GitHub is taking too long to answer. Try again in a moment.')
        : t('popupUnavailableBody', 'The extension’s background service didn’t answer. Try again, or reload the extension.')
    );
    return;
  }
  view.setInbox(res);
  if (res.error) view.showError(inboxErrorMessage(res.error));
  else if (force) announce(t('inboxUpdatedAnnouncement', 'Inbox updated'));

  // The fetch used API budget: refresh the meter from the background's snapshot.
  const status = await fetchAuth(false);
  if (status.authenticated && account && view === inbox) syncApiMeter(account, status.rateLimit);
}

/** Pin / snooze request: the fresh inbox, or null when the background failed (the view rolls back). */
async function inboxAction<K extends 'inbox:pin' | 'inbox:snooze'>(type: K, payload: BackgroundRequests[K]['req']): Promise<Inbox | null> {
  const res = normalizeInbox(
    await request(type, payload, inboxFallback(ERROR_UNAVAILABLE), TIMEOUT.quick, inboxFallback(ERROR_TIMEOUT))
  );
  if (res.needsAuth || res.error === ERROR_UNAVAILABLE || res.error === ERROR_TIMEOUT) return null;
  return res;
}

function inboxErrorMessage(error: string): string {
  const kind = classifyAuthError(error);
  if (kind === 'rate-limited') return t('authErrorRateLimited', 'GitHub’s rate limit was hit. Try again in a few minutes.');
  if (kind === 'network') return t('authErrorNetwork', 'Couldn’t reach GitHub. Check your connection and try again.');
  return t('inboxErrorGeneric', 'Some pull requests couldn’t be loaded: $1', error);
}

/** Options page at `section`, reusing an open options tab (the background focuses it). */
async function openOptions(section: string): Promise<void> {
  const res = await request('ui:openOptions', { section }, { ok: false }, TIMEOUT.quick);
  if (res.ok) {
    window.close();
    return;
  }
  chrome.runtime.openOptionsPage().catch(() => window.open(chrome.runtime.getURL(`options/options.html#${section}`), '_blank'));
}

function openPullRequest(item: InboxItem, background: boolean): void {
  inbox?.markSeen([item.url]);
  // Fire-and-forget: the popup closes as soon as the new tab takes focus.
  void request('inbox:markSeen', { urls: [item.url] }, { ok: false, unseenCount: 0 }, TIMEOUT.quick);
  chrome.tabs.create({ url: item.url, active: !background }).catch(() => {
    window.open(item.url, '_blank', 'noopener,noreferrer');
  });
}

function openUrl(url: string, background: boolean): void {
  chrome.tabs.create({ url, active: !background }).catch(() => {
    window.open(url, '_blank', 'noopener,noreferrer');
  });
}

async function copySummary(): Promise<void> {
  const text = buildSummary(inbox?.allItems ?? []);
  if (!text) {
    toast(t('summaryEmpty', 'Nothing to summarize yet'));
    return;
  }
  const copied = await copyText(text);
  toast(
    copied ? t('summaryCopied', 'Summary copied to the clipboard') : t('summaryCopyFailed', 'Couldn’t copy the summary'),
    copied ? 'success' : 'danger'
  );
}

async function markAllSeen(): Promise<void> {
  const view = inbox;
  if (!view) return;
  view.markSeen();
  const res = await request('inbox:markSeen', {}, { ok: false, unseenCount: -1 }, TIMEOUT.quick);
  if (view !== inbox) return;
  if (res.ok) {
    announce(t('inboxAllRead', 'All pull requests marked as read'));
  } else {
    toast(t('inboxMarkReadFailed', 'Couldn’t mark pull requests as read'), 'danger');
    void loadInbox(false);
  }
}

// ---------------------------------------------------------------- footer

const savedQuick = new SavedIndicator();

function syncFooter(settings: Settings): void {
  document.querySelectorAll<HTMLInputElement>('input[data-setting]').forEach((input) => {
    const key = input.dataset.setting as keyof Settings;
    input.checked = settings[key] === true;
  });
  const hint = byId('shortcut-hint');
  const binding = normalizeBindings(settings.shortcutBindings).showHelp;
  if (!settings.shortcutsEnabled || !binding) {
    hint.hidden = true;
    return;
  }
  hint.replaceChildren(fillTemplate(t('popupShortcutHint', 'Press $1 on any pull request for shortcuts'), keyCaps(binding)));
  hint.hidden = false;
}

function initFooter(settings: Settings): void {
  const toggles = document.querySelector('.quick-toggles');
  toggles?.appendChild(savedQuick.el);
  savedQuick.el.classList.add('quick-saved');

  document.querySelectorAll<HTMLInputElement>('input[data-setting]').forEach((input) => {
    input.addEventListener('change', async () => {
      const key = input.dataset.setting as 'shortcutsEnabled' | 'notificationsEnabled';
      try {
        await setSettings({ [key]: input.checked });
        savedQuick.flash();
      } catch {
        input.checked = !input.checked;
        savedQuick.flash(t('commonSaveFailed', 'Couldn’t save'), 'error');
      }
    });
  });
  syncFooter(settings);
  onSettingsChanged((next) => syncFooter(next));
}

// ------------------------------------------------------------------ init

async function boot(refresh: boolean): Promise<void> {
  const status = await fetchAuth(refresh);
  await applyAuth(status);
  if (status.authenticated) await loadInbox(false);
}

/**
 * The background broadcasts 'auth:changed' after any sign-in / sign-out /
 * token change (also from the options page). Signed-in state flipped → boot
 * again; still signed in → refresh the account card (token summary, meter).
 */
async function onAuthChanged(authenticated: boolean): Promise<void> {
  const signedIn = app.dataset.state === 'signed-in';
  if (authenticated !== signedIn) {
    await boot(false);
    return;
  }
  if (!authenticated || !account || Date.now() - accountRenderedAt < 3000) return;
  const status = await fetchAuth(false);
  if (!status.authenticated || !account?.isConnected) return;
  const next = renderAccountCard(status, {
    variant: 'popup',
    onSignedOut: () => {
      writeLocal(LAST_AUTH_KEY, '0');
      void showSignedOut(null);
    },
    onManageTokens: () => void openOptions('account'),
  });
  account.replaceWith(next);
  account = next;
  accountRenderedAt = Date.now();
}

function listenForBroadcasts(): void {
  try {
    chrome.runtime.onMessage.addListener((msg: TabBroadcast) => {
      if (msg?.type === 'auth:changed') void onAuthChanged(msg.authenticated === true);
      else if (msg?.type === 'cache:cleared' && inbox) void loadInbox(false);
      return false;
    });
  } catch {
    /* outside the extension (tests) */
  }
}

async function init(): Promise<void> {
  try {
    await initI18n();
    translatePage();
  } catch {
    /* English fallbacks from the markup / t() keep the popup usable */
  }
  try {
    byId('version').textContent = `v${chrome.runtime.getManifest().version}`;
  } catch {
    /* outside the extension (tests) */
  }
  refreshBtn.appendChild(icon('sync', 16));
  copyBtn.appendChild(icon('copy', 16));
  copyBtn.addEventListener('click', () => void copySummary());
  settingsBtn.appendChild(icon('gear', 16));
  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage().catch(() => window.open(chrome.runtime.getURL('options/options.html'), '_blank'));
  });
  refreshBtn.addEventListener('click', () => void loadInbox(true));

  const likelySignedIn = readLocal(LAST_AUTH_KEY) === '1';
  setState(likelySignedIn ? 'signed-in' : 'loading');
  refreshBtn.hidden = true;
  copyBtn.hidden = true;
  main.replaceChildren(bootSkeleton(likelySignedIn));
  document.body.classList.add('is-ready');

  const settings = await getSettings();
  initFooter(settings);
  listenForBroadcasts();
  await boot(false);
}

void init().finally(() => document.body.classList.add('is-ready'));
