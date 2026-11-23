// Better GHub - Account / token UI shared by the popup and the Options page.
//
// Talks to the background only ('auth:setToken', 'auth:logout'); the token
// never leaves the input except inside that one message.

import { h } from '../core/dom';
import { icon } from '../core/icons';
import type { AuthStatus, RateLimitSnapshot, TokenSummary } from '../core/messages';
import { t } from '../i18n';
import { AUTH_TIMEOUT, AUTH_UNAVAILABLE, normalizeAuthStatus, request, TIMEOUT } from './bg';
import {
  announce,
  attachInlineConfirm,
  avatar,
  btnLabel,
  checkDraw,
  isBusy,
  setButtonBusy,
  toast,
  uid,
} from './dom-ui';
import { formatNumber, resetsIn } from './format';
import { checkTokenFormat, classifyAuthError, type TokenFormatIssue } from './token';
import { differentAccountLogin, tokenNeedsAttention, tokensSummary } from './tokens';

export const LINKS = {
  /** Fine-grained PAT, prefilled with a name and read-only pull request access. */
  fineGrained:
    'https://github.com/settings/personal-access-tokens/new?name=Better%20GHub&description=Pull%20request%20insights%20on%20github.com&pull_requests=read',
  classic: 'https://github.com/settings/tokens/new?description=Better%20GHub&scopes=repo',
  fineGrainedList: 'https://github.com/settings/personal-access-tokens',
  classicList: 'https://github.com/settings/tokens',
} as const;

export type AuthVariant = 'popup' | 'page';

export function externalLink(href: string, ...children: (Node | string)[]): HTMLAnchorElement {
  return h(
    'a',
    { class: 'link-external', attrs: { href, target: '_blank', rel: 'noopener noreferrer' } },
    ...children,
    icon('link-external', 12)
  );
}

// ---------------------------------------------------------------- messages

export function tokenIssueMessage(issue: Exclude<TokenFormatIssue, null>): string {
  switch (issue) {
    case 'empty':
      return t('authErrorEmpty', 'Paste your personal access token first.');
    case 'whitespace':
      return t('authErrorWhitespace', 'The token contains spaces or line breaks. Copy it again from GitHub.');
    case 'not-pat':
      return t('authErrorNotPat', 'That is an app or OAuth token. Create a personal access token instead.');
    case 'prefix':
      return t('authErrorPrefix', 'This doesn’t look like a GitHub token. It should start with github_pat_ or ghp_.');
    case 'characters':
      return t('authErrorCharacters', 'The token contains characters GitHub never uses. Copy it again from GitHub.');
    case 'length':
      return t('authErrorLength', 'The token looks incomplete. Make sure you copied all of it.');
  }
}

export interface AuthErrorContext {
  /** Login of the account the stored tokens belong to (adding a token). */
  login?: string | null;
}

/** Friendly message for a background auth error code (or legacy error text). */
export function authErrorMessage(error: string | undefined, ctx: AuthErrorContext = {}): string {
  const code = error?.trim().toLowerCase();
  if (code === 'duplicate') return t('authErrorDuplicate', 'This token is already added.');
  const other = differentAccountLogin(error);
  if (other !== undefined) {
    if (other && ctx.login) return t('authErrorDifferentAccount', 'This token belongs to @$1, not @$2.', [other, ctx.login]);
    if (ctx.login) {
      return t('authErrorDifferentAccountYou', 'This token belongs to a different GitHub account. Use a token created by @$1.', ctx.login);
    }
    return t('authErrorDifferentAccountGeneric', 'This token belongs to a different GitHub account.');
  }
  if (code === 'format') return tokenIssueMessage('prefix');
  if (code === 'forbidden') return t('authErrorPermissions', 'GitHub refused access. Check the token’s permissions and organization (SSO) approval.');
  if (code === 'unknown') return t('authErrorGeneric', 'Couldn’t verify the token. Try again.');
  switch (classifyAuthError(error)) {
    case 'invalid':
      return t('authErrorInvalid', 'GitHub didn’t accept this token. It may have expired or been revoked.');
    case 'network':
      return t('authErrorNetwork', 'Couldn’t reach GitHub. Check your connection and try again.');
    case 'rate-limited':
      return t('authErrorRateLimited', 'GitHub’s rate limit was hit. Try again in a few minutes.');
    case 'permissions':
      return t('authErrorPermissions', 'GitHub refused access. Check the token’s permissions and organization (SSO) approval.');
    case 'unavailable':
      return t('authErrorUnavailable', 'Better GHub’s background service isn’t responding. Reload the extension and try again.');
    default:
      return error
        ? t('authErrorUnknown', 'Couldn’t verify the token: $1', error)
        : t('authErrorGeneric', 'Couldn’t verify the token. Try again.');
  }
}

// ----------------------------------------------------------- connect form

export interface ConnectFormOptions {
  variant: AuthVariant;
  /** Called with the authenticated status after GitHub accepted the token. */
  onConnected(status: AuthStatus): void;
  /** Problem with the stored token (shown above the form). */
  notice?: string | null;
}

export function permissionsHint(): HTMLElement {
  return h('p', {
    class: 'field-hint',
    text: t(
      'authPermissionsHint',
      'Give it access to the repositories you work in, with Pull requests: Read and Metadata: Read. Contents: Read is optional.'
    ),
  });
}

export function moreOptions(): HTMLDetailsElement {
  return h(
    'details',
    { class: 'disclosure connect-more' },
    h('summary', null, icon('chevron-right', 12), t('authMoreOptions', 'Classic tokens and security')),
    h(
      'div',
      { class: 'disclosure-body' },
      h(
        'p',
        null,
        h('strong', { text: t('authClassicTitle', 'Classic token') }),
        ' — ',
        t(
          'authClassicBody',
          'One classic token covers every organization you belong to, so you don’t need a token per organization. But its repo scope is much broader: it grants write access to all your repositories.'
        ),
        ' ',
        externalLink(LINKS.classic, t('authCreateClassic', 'Create a classic token'))
      ),
      h(
        'p',
        null,
        h('strong', { text: t('authSecurityTitle', 'Security') }),
        ' — ',
        t(
          'authSecurityBody',
          'Your token is stored only in this browser and sent only to api.github.com. Signing out removes it here; revoke it on GitHub to disable it everywhere.'
        )
      )
    )
  );
}

export interface TokenFormOptions {
  variant: AuthVariant;
  submitLabel: string;
  busyLabel: string;
  /** Whether the background's answer means the token was accepted. */
  accept(status: AuthStatus): boolean;
  /** Message for a rejected token. */
  errorMessage(status: AuthStatus): string;
  onAccepted(status: AuthStatus): void;
  /** Extra buttons placed after the submit button (e.g. Cancel). */
  actions?: HTMLElement[];
}

export interface TokenForm {
  form: HTMLFormElement;
  input: HTMLInputElement;
  /** Empty the input, hide errors and the revealed token. */
  reset(): void;
}

/**
 * Token input + submit. Validates the format locally, sends 'auth:setToken'
 * and shows a specific inline error. Used for the first token (connect) and
 * for adding more tokens.
 */
export function createTokenForm(opts: TokenFormOptions): TokenForm {
  const inputId = uid('token');
  const hintId = uid('token-hint');
  const errorId = uid('token-error');

  const input = h('input', {
    class: 'input input-mono',
    attrs: {
      id: inputId,
      name: 'token',
      type: 'password',
      autocomplete: 'off',
      autocapitalize: 'off',
      autocorrect: 'off',
      spellcheck: 'false',
      placeholder: 'github_pat_…',
      'aria-describedby': hintId,
      'data-1p-ignore': 'true',
      'data-lpignore': 'true',
    },
  });

  const reveal = h(
    'button',
    {
      class: 'btn btn-ghost btn-icon input-action',
      attrs: {
        type: 'button',
        'aria-pressed': 'false',
        'aria-controls': inputId,
        'aria-label': t('authShowToken', 'Show token'),
        'data-tooltip': t('authShowToken', 'Show token'),
        'data-tooltip-align': 'end',
      },
    },
    icon('eye', 16)
  );
  const setRevealed = (show: boolean): void => {
    input.type = show ? 'text' : 'password';
    reveal.setAttribute('aria-pressed', String(show));
    const label = show ? t('authHideToken', 'Hide token') : t('authShowToken', 'Show token');
    reveal.setAttribute('data-tooltip', label);
    reveal.replaceChildren(icon(show ? 'eye-closed' : 'eye', 16));
  };
  reveal.addEventListener('click', () => {
    setRevealed(input.type === 'password');
    input.focus();
  });

  const error = h('p', { class: 'field-error', attrs: { id: errorId, hidden: true } });
  const submit = h('button', { class: 'btn btn-primary btn-block', attrs: { type: 'submit' } }, btnLabel(opts.submitLabel));

  const showError = (message: string): void => {
    error.replaceChildren(icon('alert', 14), h('span', { text: message }));
    error.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', `${errorId} ${hintId}`);
    announce(message);
  };
  const clearError = (): void => {
    if (error.hidden) return;
    error.hidden = true;
    error.replaceChildren();
    input.removeAttribute('aria-invalid');
    input.setAttribute('aria-describedby', hintId);
  };
  input.addEventListener('input', clearError);

  const actions = opts.actions?.length ? h('div', { class: 'form-actions' }, submit, ...opts.actions) : submit;

  const form = h(
    'form',
    { class: 'connect-form', attrs: { novalidate: true } },
    h(
      'div',
      { class: 'field' },
      h('label', { class: 'field-label', attrs: { for: inputId }, text: t('authTokenLabel', 'Personal access token') }),
      h('div', { class: 'input-group' }, input, reveal),
      error,
      h('p', {
        class: `field-hint${opts.variant === 'popup' ? ' sr-only' : ''}`,
        attrs: { id: hintId },
        text: t('authTokenHint', 'Starts with github_pat_ (fine-grained) or ghp_ (classic).'),
      })
    ),
    actions
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isBusy(submit)) return;
    const { token, issue } = checkTokenFormat(input.value);
    if (issue) {
      showError(tokenIssueMessage(issue));
      input.focus();
      return;
    }
    clearError();
    setButtonBusy(submit, true, opts.busyLabel);
    input.readOnly = true;
    reveal.disabled = true;
    const status = normalizeAuthStatus(await request('auth:setToken', { token }, AUTH_UNAVAILABLE, TIMEOUT.setToken, AUTH_TIMEOUT));
    setButtonBusy(submit, false);
    input.readOnly = false;
    reveal.disabled = false;
    if (opts.accept(status)) {
      input.value = '';
      setRevealed(false);
      opts.onAccepted(status);
      return;
    }
    showError(opts.errorMessage(status));
    input.focus();
    input.select();
  });

  return {
    form,
    input,
    reset: () => {
      input.value = '';
      setRevealed(false);
      clearError();
    },
  };
}

/** Signed-out view: short onboarding + token form. */
export function renderConnectForm(opts: ConnectFormOptions): HTMLElement {
  const { form } = createTokenForm({
    variant: opts.variant,
    submitLabel: t('authConnect', 'Connect'),
    busyLabel: t('authConnecting', 'Connecting…'),
    accept: (status) => status.authenticated && !!status.account,
    errorMessage: (status) => authErrorMessage(status.error),
    onAccepted: (status) => opts.onConnected(status),
  });

  const notice = opts.notice
    ? h('div', { class: 'notice notice-attention', attrs: { role: 'note' } }, icon('alert', 16), h('span', { text: opts.notice }))
    : null;

  if (opts.variant === 'popup') {
    return h(
      'div',
      { class: 'connect connect-popup anim-rise-in' },
      h(
        'div',
        { class: 'connect-intro' },
        h('div', { class: 'connect-badge', attrs: { 'aria-hidden': 'true' } }, icon('git-pull-request', 20)),
        h('h2', { class: 'connect-title', text: t('authConnectTitle', 'Connect your GitHub account') }),
        h('p', {
          class: 'connect-lead',
          text: t(
            'authConnectLead',
            'See review requests and your pull requests at a glance, with checks, reviews and unresolved threads.'
          ),
        })
      ),
      notice,
      h(
        'div',
        { class: 'connect-create' },
        h(
          'a',
          { class: 'btn btn-block', attrs: { href: LINKS.fineGrained, target: '_blank', rel: 'noopener noreferrer' } },
          icon('key', 16),
          t('authCreateToken', 'Create a token on GitHub'),
          icon('link-external', 12, 'btn-trailing')
        ),
        permissionsHint()
      ),
      form,
      moreOptions()
    );
  }

  return h(
    'div',
    { class: 'connect connect-page' },
    notice,
    h(
      'div',
      { class: 'connect-create' },
      h(
        'a',
        { class: 'btn connect-create-btn', attrs: { href: LINKS.fineGrained, target: '_blank', rel: 'noopener noreferrer' } },
        icon('key', 16),
        t('authCreateFineGrained', 'Create a fine-grained token'),
        icon('link-external', 12, 'btn-trailing')
      ),
      permissionsHint()
    ),
    form,
    moreOptions()
  );
}

// ------------------------------------------------------------ API meter

export function meterTone(remaining: number, limit: number): 'brand' | 'attention' | 'danger' {
  const ratio = limit > 0 ? remaining / limit : 0;
  if (ratio <= 0.05) return 'danger';
  if (ratio <= 0.2) return 'attention';
  return 'brand';
}

/** Remaining API budget bar; null when the background has no snapshot yet. */
export function renderApiMeter(rl: RateLimitSnapshot | undefined, now = Date.now()): HTMLElement | null {
  if (!rl || rl.limit === null || rl.remaining === null || rl.limit <= 0) return null;
  const remaining = Math.max(0, Math.min(rl.remaining, rl.limit));
  const ratio = remaining / rl.limit;
  const labelId = uid('api-label');
  const value = t('apiRemaining', '$1 / $2', [formatNumber(remaining), formatNumber(rl.limit)]);
  const reset = resetsIn(rl.reset, now);
  const fill = h('div', { class: 'meter-fill' });
  const el = h(
    'div',
    { class: 'meter', dataset: { tone: meterTone(remaining, rl.limit) } },
    h(
      'div',
      { class: 'meter-head' },
      h('span', { class: 'meter-label', attrs: { id: labelId }, text: t('apiBudget', 'API budget') }),
      h(
        'span',
        { class: 'meter-value tabular' },
        h('span', { text: value }),
        reset ? h('span', { class: 'text-muted', text: ` · ${t('apiResets', 'resets $1', reset)}` }) : null
      )
    ),
    h(
      'div',
      {
        class: 'meter-track',
        attrs: {
          role: 'meter',
          'aria-labelledby': labelId,
          'aria-valuemin': 0,
          'aria-valuemax': rl.limit,
          'aria-valuenow': remaining,
          'aria-valuetext': t('apiMeterText', '$1 of $2 requests left this hour', [formatNumber(remaining), formatNumber(rl.limit)]),
        },
      },
      fill
    )
  );
  // Two frames: let the element mount at scaleX(0) so the fill animates in.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      fill.style.transform = `scaleX(${ratio})`;
    })
  );
  return el;
}

/**
 * Update the meter inside `container` in place (the bar animates from its
 * current value), or insert one after the account row when there was none.
 */
export function syncApiMeter(container: HTMLElement, rl: RateLimitSnapshot | undefined): void {
  const next = renderApiMeter(rl);
  if (!next) return;
  const old = container.querySelector<HTMLElement>('.meter');
  if (!old) {
    (container.querySelector('.account-tokens') ?? container.querySelector('.account-row'))?.after(next);
    return;
  }
  const oldFill = old.querySelector<HTMLElement>('.meter-fill');
  const newFill = next.querySelector<HTMLElement>('.meter-fill');
  if (oldFill && newFill) newFill.style.transform = oldFill.style.transform;
  old.replaceWith(next);
}

// ---------------------------------------------------------- account card

export interface AccountCardOptions {
  variant: AuthVariant;
  onSignedOut(): void;
  /** Play the success check on the avatar (right after connecting). */
  celebrate?: boolean;
  /** Page variant: content placed between the API meter and the footer (the token list). */
  body?: Node | null;
  /** Popup variant: "Manage" next to the token summary. Defaults to following the link. */
  onManageTokens?: () => void;
}

export function tokenKindLabel(kind: AuthStatus['tokenKind']): string | null {
  if (kind === 'fine-grained') return t('authKindFineGrained', 'Fine-grained token');
  if (kind === 'classic') return t('authKindClassic', 'Classic token');
  return null;
}

/**
 * Popup: "2 tokens · acme, octo-org" with an attention dot when a token has a
 * problem or expires soon, and a link to manage tokens in the options page.
 */
export function renderTokenSummary(tokens: TokenSummary[], onManage?: () => void, now = Date.now()): HTMLElement {
  const attention = tokens.some((token) => tokenNeedsAttention(token, now));
  const manage = h('a', {
    class: 'account-tokens-manage',
    attrs: {
      href: '../options/options.html#account',
      target: '_blank',
      rel: 'noopener',
      'aria-label': t('tokensManageLabel', 'Manage tokens'),
    },
    text: t('tokensManage', 'Manage'),
  });
  if (onManage) {
    manage.addEventListener('click', (e) => {
      e.preventDefault();
      onManage();
    });
  }
  const attentionText = t('tokensAttention', 'A token needs attention');
  return h(
    'div',
    { class: `account-tokens${attention ? ' has-attention' : ''}` },
    icon('key', 14, 'account-tokens-icon'),
    h('span', { class: 'account-tokens-text', text: tokensSummary(tokens) }),
    attention
      ? h(
          'span',
          {
            class: 'account-tokens-alert',
            attrs: { 'data-tooltip': attentionText, 'data-tooltip-align': 'end' },
          },
          h('span', { class: 'dot dot-attention', attrs: { 'aria-hidden': 'true' } }),
          h('span', { class: 'sr-only', text: attentionText })
        )
      : null,
    manage
  );
}

export function renderAccountCard(status: AuthStatus, opts: AccountCardOptions): HTMLElement {
  const account = status.account;
  if (!account) return h('div');
  const isPopup = opts.variant === 'popup';
  const size = isPopup ? 36 : 48;
  const tokens = status.tokens;

  const avatarWrap = h('div', { class: 'account-avatar' }, avatar(account.avatarUrl, size));
  if (opts.celebrate) {
    avatarWrap.appendChild(h('span', { class: 'account-check', attrs: { 'aria-hidden': 'true' } }, checkDraw(12)));
  }

  const signOut = h(
    'button',
    { class: `btn btn-sm ${isPopup ? 'btn-ghost btn-muted' : 'btn-danger'}`, attrs: { type: 'button' } },
    icon('sign-out', 16),
    btnLabel(t('authSignOut', 'Sign out'))
  );
  attachInlineConfirm(signOut, {
    question: isPopup ? undefined : t('authSignOutQuestion', 'Sign out of Better GHub?'),
    confirmLabel: t('authSignOut', 'Sign out'),
    busyLabel: t('authSigningOut', 'Signing out…'),
    onConfirm: async () => {
      const res = await request('auth:logout', {}, { ok: false }, TIMEOUT.quick);
      if (!res || res.ok !== true) {
        toast(t('authSignOutFailed', 'Couldn’t sign out. Try again.'), 'danger');
        return false;
      }
      announce(t('authSignedOut', 'Signed out'));
      opts.onSignedOut();
      return true;
    },
  });

  // With a token list the kinds are shown per token instead.
  const kind = tokens ? null : tokenKindLabel(status.tokenKind);
  const identity = h(
    'div',
    { class: 'account-identity' },
    h('div', { class: 'account-name', text: account.name || account.login }),
    h(
      'div',
      { class: 'account-sub' },
      h('a', {
        class: 'account-login',
        attrs: { href: account.htmlUrl, target: '_blank', rel: 'noopener noreferrer' },
        text: `@${account.login}`,
      }),
      !isPopup && kind ? h('span', { class: 'badge badge-brand', text: kind }) : null
    )
  );

  const meter = renderApiMeter(status.rateLimit);
  const card = h(
    'div',
    { class: `account account-${opts.variant}` },
    h('div', { class: 'account-row' }, avatarWrap, identity, h('div', { class: 'account-actions' }, signOut)),
    isPopup && tokens?.length ? renderTokenSummary(tokens, opts.onManageTokens) : null,
    meter,
    isPopup ? null : (opts.body ?? null)
  );

  if (!isPopup) {
    const allClassic = tokens?.length ? tokens.every((x) => x.kind === 'classic') : status.tokenKind === 'classic';
    const manage = allClassic ? LINKS.classicList : LINKS.fineGrainedList;
    card.appendChild(
      h(
        'div',
        { class: 'account-foot' },
        h('p', {
          class: 'field-hint',
          text: t('authRevokeHint', 'Signing out removes every token from this browser. To disable a token everywhere, revoke it on GitHub.'),
        }),
        externalLink(manage, t('authRevoke', 'Revoke on GitHub'))
      )
    );
  }
  return card;
}

/** "Connected as @login" message for the live region after a successful connect. */
export function connectedMessage(status: AuthStatus): string {
  return t('authConnectedAs', 'Connected as @$1', status.account?.login ?? '');
}
