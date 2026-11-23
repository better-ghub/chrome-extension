// Better GHub - Options: Account section and the #welcome onboarding hero.

import { h } from '../src/core/dom';
import { icon, type IconName } from '../src/core/icons';
import type { AuthStatus, TabBroadcast } from '../src/core/messages';
import { t } from '../src/i18n';
import {
  authErrorMessage,
  connectedMessage,
  externalLink,
  LINKS,
  renderAccountCard,
  renderConnectForm,
  syncApiMeter,
} from '../src/pages/auth-view';
import { AUTH_TIMEOUT, AUTH_UNAVAILABLE, normalizeAuthStatus, request, TIMEOUT } from '../src/pages/bg';
import { announce, checkDraw, setButtonBusy, stagger, swapContent } from '../src/pages/dom-ui';
import { classifyAuthError } from '../src/pages/token';
import { TokensPanel } from '../src/pages/tokens-view';

interface Feature {
  icon: IconName;
  title: string;
  body: string;
}

function features(): Feature[] {
  return [
    {
      icon: 'comment-discussion',
      title: t('welcomeFeatureListTitle', 'Activity at a glance'),
      body: t('welcomeFeatureListBody', 'Last comment, last commit and unresolved threads under every pull request in lists.'),
    },
    {
      icon: 'command-palette',
      title: t('welcomeFeatureShortcutsTitle', 'Shortcuts on PR pages'),
      body: t('welcomeFeatureShortcutsBody', 'Collapse threads, jump between unresolved comments and copy branch names.'),
    },
    {
      icon: 'bell',
      title: t('welcomeFeatureInboxTitle', 'Inbox and badge'),
      body: t('welcomeFeatureInboxBody', 'Review requests and your pull requests in the toolbar, with a badge when something changes.'),
    },
    {
      icon: 'home',
      title: t('welcomeFeatureDashboardTitle', 'Dashboard card'),
      body: t('welcomeFeatureDashboardBody', 'Your open pull requests and their review status at the top of github.com.'),
    },
  ];
}

function skeleton(): HTMLElement {
  return h(
    'div',
    { class: 'account-skeleton', attrs: { 'aria-hidden': 'true' } },
    h('span', { class: 'skeleton', style: { width: '48px', height: '48px', borderRadius: '50%' } }),
    h(
      'span',
      { class: 'account-skeleton-lines' },
      h('span', { class: 'skeleton', style: { width: '40%', height: '14px' } }),
      h('span', { class: 'skeleton', style: { width: '25%', height: '12px' } })
    )
  );
}

/** What the Account card shows, to tell whether a broadcast changed anything. */
function statusKey(status: AuthStatus | null): string {
  if (!status) return '';
  return JSON.stringify([
    status.authenticated,
    status.account?.login ?? null,
    status.error ?? null,
    (status.tokens ?? []).map((x) => [x.id, x.owners, x.publicOnly, x.problem, x.expiresAt]),
  ]);
}

export class AccountSection {
  private status: AuthStatus | null = null;
  private welcomeRoute = false;
  /** Hero stays for the whole visit once shown (so the "all set" state can be seen). */
  private heroShown = false;
  private celebrate = false;
  private tokens: TokensPanel | null = null;
  /** Owner from an `#add-token/<owner>` route, applied once the status is known. */
  private pendingAdd: string | null = null;
  /** Focus the token input after the next render (signed out from this page). */
  private focusTokenInput = false;
  /** Bumped per load so an older, slower answer never overwrites a newer one. */
  private loadSeq = 0;

  constructor(
    private readonly card: HTMLElement,
    private readonly hero: HTMLElement
  ) {}

  setWelcome(welcome: boolean): void {
    this.welcomeRoute = welcome;
    if (welcome) this.heroShown = true;
    this.renderHero();
  }

  /**
   * `#add-token/<owner>`: expand the add-token form prefilled with `owner`
   * ('' = none) and focus it. Signed out, the connect form gets focus instead.
   */
  openAddToken(owner: string): void {
    this.pendingAdd = owner;
    // The view may be stale (signed in from the popup since): refresh first;
    // load() applies the pending route once the fresh status is rendered.
    if (this.status && !this.status.authenticated) {
      void this.load();
      return;
    }
    this.applyPendingAdd();
  }

  /**
   * Follow sign-ins, sign-outs and token changes made elsewhere (popup,
   * another options tab): the background broadcasts 'auth:changed'.
   * Returns the unsubscribe function.
   */
  listen(): () => void {
    const listener = (msg: TabBroadcast): boolean => {
      if (msg?.type === 'auth:changed') void this.refreshIfChanged();
      return false;
    };
    try {
      chrome.runtime.onMessage.addListener(listener);
    } catch {
      return () => undefined;
    }
    return () => chrome.runtime.onMessage.removeListener(listener);
  }

  /**
   * Re-render only when the status really differs from what is shown — our
   * own add/remove/sign-out already updated it (and must keep its animation
   * and focus). Waits while a token request from this page is in flight.
   */
  private async refreshIfChanged(attempt = 0): Promise<void> {
    if (this.card.querySelector('.is-busy') && attempt < 60) {
      setTimeout(() => void this.refreshIfChanged(attempt + 1), 500);
      return;
    }
    const seq = ++this.loadSeq;
    const status = normalizeAuthStatus(await request('auth:status', {}, AUTH_UNAVAILABLE, TIMEOUT.quick, AUTH_TIMEOUT));
    if (seq !== this.loadSeq || statusKey(status) === statusKey(this.status)) return;
    // A failed status read is not news: keep what is shown.
    const kind = classifyAuthError(status.error);
    if (!status.authenticated && (kind === 'unavailable' || kind === 'network')) return;
    this.status = status;
    this.celebrate = false;
    await this.render(true);
  }

  private applyPendingAdd(): void {
    const owner = this.pendingAdd;
    if (owner === null || !this.status) return;
    this.pendingAdd = null;
    if (this.status.authenticated && this.tokens) this.tokens.expandAdd(owner);
    else this.tokenInput()?.focus();
  }

  private tokenInput(): HTMLInputElement | null {
    return this.card.querySelector<HTMLInputElement>('input[name="token"]');
  }

  async load(refresh = false): Promise<void> {
    if (!this.status) this.card.replaceChildren(skeleton());
    this.card.setAttribute('aria-busy', 'true');
    const seq = ++this.loadSeq;
    const status = normalizeAuthStatus(await request('auth:status', { refresh }, AUTH_UNAVAILABLE, TIMEOUT.quick, AUTH_TIMEOUT));
    if (seq !== this.loadSeq) return;
    this.card.removeAttribute('aria-busy');
    if (!status.authenticated && !this.status) this.heroShown = true;
    this.status = status;
    this.celebrate = false;
    await this.render(true);
  }

  /** Re-render from the current status (also used after a language change). */
  async render(animate = false): Promise<void> {
    this.renderHero();
    const status = this.status;
    if (!status) {
      this.card.replaceChildren(skeleton());
      return;
    }
    const next = this.renderCard(status);
    if (animate) await swapContent(this.card, next);
    else this.card.replaceChildren(next);
    if (this.focusTokenInput) {
      this.focusTokenInput = false;
      this.tokenInput()?.focus();
    }
    this.applyPendingAdd();
  }

  private signedOut(): void {
    this.status = { authenticated: false };
    this.celebrate = false;
    this.focusTokenInput = true;
    void this.render(true);
  }

  private renderCard(status: AuthStatus): HTMLElement {
    const previous = this.tokens?.addState();
    this.tokens = null;
    if (status.authenticated) {
      if (status.tokens) {
        this.tokens = new TokensPanel(status, {
          onChange: (next) => {
            this.status = next;
            this.celebrate = false;
            syncApiMeter(this.card, next.rateLimit);
          },
          onSignedOut: () => this.signedOut(),
        });
        if (previous) this.tokens.restoreAddState(previous);
      }
      return renderAccountCard(status, {
        variant: 'page',
        celebrate: this.celebrate,
        body: this.tokens?.el,
        onSignedOut: () => this.signedOut(),
      });
    }
    const kind = classifyAuthError(status.error);
    if (kind === 'unavailable' || kind === 'network') {
      const retry = h('button', { class: 'btn btn-sm', attrs: { type: 'button' } }, icon('sync', 14), h('span', { class: 'btn-label', text: t('commonRetry', 'Try again') }));
      retry.addEventListener('click', () => {
        setButtonBusy(retry, true);
        void this.load(true);
      });
      return h(
        'div',
        { class: 'notice notice-danger account-problem', attrs: { role: 'alert' } },
        icon('alert', 16),
        h('span', { class: 'account-problem-text', text: authErrorMessage(status.error) }),
        retry
      );
    }
    const notice = status.error ? `${t('authStoredTokenFailed', 'Your saved token stopped working.')} ${authErrorMessage(status.error)}` : null;
    return renderConnectForm({
      variant: 'page',
      notice,
      onConnected: (next) => {
        this.status = next;
        this.celebrate = true;
        announce(connectedMessage(next));
        void this.render(true);
      },
    });
  }

  private renderHero(): void {
    const visible = this.heroShown || this.welcomeRoute;
    this.hero.hidden = !visible;
    if (!visible) {
      this.hero.replaceChildren();
      return;
    }
    const done = !!this.status?.authenticated;
    const step = (n: number, content: Node | string, state: 'done' | 'current' | 'upcoming'): HTMLLIElement =>
      h(
        'li',
        { class: `step is-${state}` },
        h('span', { class: 'step-mark', attrs: { 'aria-hidden': 'true' } }, state === 'done' ? checkDraw(14) : String(n)),
        h('span', { class: 'sr-only', text: state === 'done' ? `${t('welcomeStepDone', 'Done')}: ` : '' }),
        h('span', { class: 'step-text' }, content)
      );

    const list = h('ul', { class: 'hero-features list-reset anim-stagger', attrs: { role: 'list' } });
    features().forEach((f, i) => {
      const li = h(
        'li',
        { class: 'feature' },
        h('span', { class: 'feature-icon', attrs: { 'aria-hidden': 'true' } }, icon(f.icon, 16)),
        h('div', null, h('h3', { class: 'feature-title', text: f.title }), h('p', { class: 'feature-body', text: f.body }))
      );
      stagger(li, i + 1);
      list.appendChild(li);
    });

    this.hero.replaceChildren(
      h(
        'section',
        { class: `hero card${done ? ' is-done' : ''}`, attrs: { 'aria-labelledby': 'hero-title' } },
        h(
          'div',
          { class: 'hero-head' },
          h(
            'div',
            { class: 'hero-text' },
            h('h2', {
              class: 'hero-title',
              attrs: { id: 'hero-title' },
              text: done ? t('welcomeDoneTitle', 'You’re all set') : t('welcomeTitle', 'Welcome to Better GHub'),
            }),
            h('p', {
              class: 'hero-lead',
              text: done
                ? t('welcomeDoneLead', 'Open any pull request on GitHub to see it in action. Your inbox is in the toolbar.')
                : t('welcomeLead', 'Pull requests on github.com, with the context you usually click around for. Connect a token to get started.'),
            })
          ),
          h('img', { class: 'hero-logo', attrs: { src: '../icons/icon128.png', alt: '', width: 56, height: 56 } })
        ),
        list,
        h(
          'ol',
          { class: 'hero-steps list-reset', attrs: { role: 'list', 'aria-label': t('welcomeStepsLabel', 'Get started') } },
          step(1, externalLink(LINKS.fineGrained, t('welcomeStep1', 'Create a token on GitHub')), done ? 'done' : 'current'),
          step(2, t('welcomeStep2', 'Paste it below and connect'), done ? 'done' : 'current'),
          step(
            3,
            done ? externalLink('https://github.com/pulls', t('welcomeStep3Done', 'Open your pull requests')) : t('welcomeStep3', 'You’re all set'),
            done ? 'done' : 'upcoming'
          )
        )
      )
    );
  }
}
