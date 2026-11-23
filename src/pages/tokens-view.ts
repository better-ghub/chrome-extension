// Better GHub - Options: the stored tokens of the connected account, and the
// form that adds a token for another organization.
//
// Talks to the background only ('auth:setToken', 'auth:removeToken'); the
// token never leaves the input except inside that one message.

import { h, prefersReducedMotion } from '../core/dom';
import { icon } from '../core/icons';
import type { AuthStatus, TokenSummary } from '../core/messages';
import { t } from '../i18n';
import { authErrorMessage, createTokenForm, LINKS, moreOptions, permissionsHint, type TokenForm } from './auth-view';
import { AUTH_TIMEOUT, AUTH_UNAVAILABLE, normalizeAuthStatus, request, TIMEOUT } from './bg';
import { announce, attachInlineConfirm, btnLabel, toast, uid, wait } from './dom-ui';
import { formatNumber } from './format';
import { ERROR_TIMEOUT, ERROR_UNAVAILABLE } from './token';
import { coverageText, expiryInfo, normalizeOwner, tokenHint, tokenKindName, tokenPrefillUrl } from './tokens';

export interface TokensPanelOptions {
  /** A token was added or removed and the account is still connected. */
  onChange(status: AuthStatus): void;
  /** The last token was removed: the account is signed out. */
  onSignedOut(): void;
}

/** Add-form state worth keeping across a re-render (e.g. a language change). */
export interface AddFormState {
  expanded: boolean;
  org: string;
}

/** Row height collapse before a removed token leaves the list. */
const ROW_EXIT_MS = 220;

async function collapseRow(row: HTMLElement): Promise<void> {
  if (prefersReducedMotion() || !row.isConnected) return;
  row.style.height = `${row.offsetHeight}px`;
  void row.offsetHeight;
  row.classList.add('is-collapsing');
  row.style.height = '0px';
  await wait(ROW_EXIT_MS);
}

export class TokensPanel {
  readonly el: HTMLElement;
  private readonly list: HTMLUListElement;
  private readonly count: HTMLElement;
  private readonly note: HTMLElement;
  private readonly addToggle: HTMLButtonElement;
  private readonly addPanel: HTMLElement;
  private readonly orgInput: HTMLInputElement;
  private readonly orgWarning: HTMLElement;
  private readonly orgHintId: string;
  private readonly createLink: HTMLAnchorElement;
  private readonly createLabel: HTMLElement;
  private readonly tokenForm: TokenForm;
  private tokens: TokenSummary[];
  private readonly login: string;

  constructor(
    status: AuthStatus,
    private readonly opts: TokensPanelOptions
  ) {
    this.tokens = status.tokens ?? [];
    this.login = status.account?.login ?? '';

    const titleId = uid('tokens-title');
    this.count = h('span', { class: 'counter' });
    this.list = h('ul', { class: 'tokens-list list-reset', attrs: { role: 'list', 'aria-labelledby': titleId } });
    this.note = h('div', { class: 'tokens-note' });

    // ------------------------------------------------------ add form
    const panelId = uid('add-token');
    const addTitleId = uid('add-token-title');
    this.addToggle = h(
      'button',
      { class: 'btn tokens-add-toggle', attrs: { type: 'button', 'aria-expanded': 'false', 'aria-controls': panelId } },
      icon('key', 16),
      btnLabel(t('tokensAddToggle', 'Add a token for another organization'))
    );
    this.addToggle.addEventListener('click', () => this.expandAdd());

    const orgId = uid('org');
    this.orgHintId = uid('org-hint');
    const warningId = uid('org-warning');
    this.orgInput = h('input', {
      class: 'input',
      attrs: {
        id: orgId,
        name: 'organization',
        type: 'text',
        autocomplete: 'off',
        autocapitalize: 'off',
        spellcheck: 'false',
        maxlength: 120,
        placeholder: 'acme',
        'aria-describedby': this.orgHintId,
      },
    });
    this.orgWarning = h('p', {
      class: 'field-hint field-warning',
      attrs: { id: warningId, hidden: true },
      text: t('tokensOrgInvalid', 'Enter the organization’s GitHub name, like acme.'),
    });
    this.orgInput.addEventListener('input', () => this.syncCreateLink());

    this.createLabel = h('span');
    this.createLink = h(
      'a',
      { class: 'btn connect-create-btn', attrs: { href: tokenPrefillUrl(''), target: '_blank', rel: 'noopener noreferrer' } },
      icon('key', 16),
      this.createLabel,
      icon('link-external', 12, 'btn-trailing')
    );

    const cancel = h('button', { class: 'btn', attrs: { type: 'button' }, text: t('commonCancel', 'Cancel') });
    cancel.addEventListener('click', () => this.collapseAdd(true));
    this.tokenForm = createTokenForm({
      variant: 'page',
      submitLabel: t('tokensAddSubmit', 'Add token'),
      busyLabel: t('tokensAdding', 'Adding…'),
      accept: (s) => s.authenticated && !!s.account && !s.error,
      errorMessage: (s) => authErrorMessage(s.error, { login: this.login }),
      onAccepted: (s) => this.added(s),
      actions: [cancel],
    });

    this.addPanel = h(
      'div',
      { class: 'tokens-add-panel connect-page', attrs: { id: panelId, role: 'group', 'aria-labelledby': addTitleId, hidden: true } },
      h(
        'div',
        { class: 'tokens-add-intro' },
        h('h4', { class: 'tokens-add-title', attrs: { id: addTitleId }, text: t('tokensAddTitle', 'Add a token') }),
        h('p', {
          class: 'field-hint',
          text: t(
            'tokensAddWhy',
            'A fine-grained token can read private repositories of only one owner: you or one organization. Add one token per organization and Better GHub uses the right one for each repository.'
          ),
        })
      ),
      h(
        'div',
        { class: 'field tokens-org' },
        h(
          'label',
          { class: 'field-label', attrs: { for: orgId } },
          t('tokensOrgLabel', 'Organization'),
          ' ',
          h('span', { class: 'field-optional', text: t('tokensOptional', '(optional)') })
        ),
        this.orgInput,
        this.orgWarning,
        h('p', {
          class: 'field-hint',
          attrs: { id: this.orgHintId },
          text: t('tokensOrgHint', 'Prefills the new token on GitHub. Leave it empty for your own repositories.'),
        })
      ),
      h('div', { class: 'connect-create' }, this.createLink, permissionsHint()),
      this.tokenForm.form,
      moreOptions()
    );
    this.addPanel.addEventListener('keydown', (e) => {
      // Esc closes the form unless something inside handles it (inline confirm, a busy submit).
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (this.tokenForm.form.querySelector('.is-busy')) return;
      e.preventDefault();
      this.collapseAdd(true);
    });
    this.syncCreateLink();

    this.el = h(
      'section',
      { class: 'tokens', attrs: { 'aria-labelledby': titleId } },
      h(
        'div',
        { class: 'tokens-head' },
        h('h3', { class: 'tokens-title', attrs: { id: titleId }, text: t('tokensTitle', 'Tokens') }),
        this.count
      ),
      this.list,
      this.note,
      h('div', { class: 'tokens-add' }, this.addToggle, this.addPanel)
    );
    this.renderRows();
  }

  // ------------------------------------------------------------- list

  private renderRows(fresh: ReadonlySet<string> = new Set()): void {
    this.list.replaceChildren(
      ...this.tokens.map((token) => {
        const row = this.row(token);
        if (fresh.has(token.id)) row.classList.add('anim-row-in');
        return row;
      })
    );
    this.count.textContent = formatNumber(this.tokens.length);
    this.count.hidden = this.tokens.length < 2;
  }

  private rowFor(id: string): HTMLElement | null {
    return [...this.list.children].find((el): el is HTMLElement => (el as HTMLElement).dataset.tokenId === id) ?? null;
  }

  private row(token: TokenSummary): HTMLLIElement {
    const hint = tokenHint(token.hint);
    const expiry = expiryInfo(token.expiresAt);
    const isPublicOnly = token.owners !== null && !token.owners.length;

    const problems: HTMLElement[] = [];
    if (token.problem === 'invalid') {
      problems.push(
        h(
          'span',
          { class: 'badge badge-danger token-problem' },
          icon('x-circle', 12),
          t('tokensProblemInvalid', 'Revoked or expired — remove it')
        )
      );
    } else if (token.problem === 'sso') {
      problems.push(
        h(
          'a',
          {
            class: 'badge badge-attention token-problem',
            attrs: { href: token.ssoUrl || LINKS.classicList, target: '_blank', rel: 'noopener noreferrer' },
          },
          icon('shield-check', 12),
          t('tokensProblemSso', 'Authorize SSO'),
          icon('link-external', 12)
        )
      );
    }

    const remove = h(
      'button',
      {
        class: 'btn btn-sm btn-ghost btn-muted token-remove',
        attrs: { type: 'button', 'aria-label': t('tokensRemoveLabel', 'Remove token $1', hint || tokenKindName(token.kind)) },
      },
      icon('trash', 16),
      btnLabel(t('tokensRemove', 'Remove'))
    );
    const isLast = this.tokens.length === 1;
    const li = h(
      'li',
      {
        class: 'token-row',
        dataset: { tokenId: token.id, kind: token.kind, problem: token.problem ?? 'none' },
        attrs: { tabindex: -1 },
      },
      h('span', { class: 'token-icon', attrs: { 'aria-hidden': 'true' } }, icon('key', 16)),
      h(
        'div',
        { class: 'token-main' },
        h(
          'div',
          { class: 'token-head' },
          h('span', { class: `badge${token.kind === 'fine-grained' ? ' badge-brand' : ''}`, text: tokenKindName(token.kind) }),
          hint ? h('span', { class: 'token-hint', text: hint }) : null
        ),
        h('p', { class: `token-coverage${isPublicOnly ? ' is-public-only' : ''}`, text: coverageText(token) }),
        h(
          'p',
          { class: 'token-meta' },
          h(
            'span',
            {
              class: 'token-expiry',
              dataset: { tone: expiry.tone },
              attrs: expiry.date ? { 'data-tooltip': t('tokensExpiryDate', 'Expiration date: $1', expiry.date) } : undefined,
            },
            icon(expiry.tone === 'muted' ? 'clock' : 'alert', 12),
            h('span', { text: expiry.text })
          )
        ),
        problems.length ? h('div', { class: 'token-problems' }, problems) : null
      ),
      h('div', { class: 'token-actions' }, remove)
    );

    attachInlineConfirm(remove, {
      question: isLast
        ? t('tokensRemoveLastQuestion', 'This is your only token. Remove it and sign out?')
        : t('tokensRemoveQuestion', 'Remove this token?'),
      confirmLabel: isLast ? t('tokensRemoveAndSignOut', 'Remove and sign out') : t('tokensRemove', 'Remove'),
      busyLabel: t('tokensRemoving', 'Removing…'),
      onConfirm: () => this.remove(token, li),
    });
    return li;
  }

  private async remove(token: TokenSummary, row: HTMLElement): Promise<boolean> {
    const index = this.tokens.findIndex((x) => x.id === token.id);
    const status = normalizeAuthStatus(
      await request('auth:removeToken', { id: token.id }, AUTH_UNAVAILABLE, TIMEOUT.quick, AUTH_TIMEOUT)
    );
    const unreachable = status.error === ERROR_UNAVAILABLE || status.error === ERROR_TIMEOUT;
    if (unreachable || (status.authenticated && status.tokens?.some((x) => x.id === token.id))) {
      toast(t('tokensRemoveFailed', 'Couldn’t remove the token. Try again.'), 'danger');
      return false;
    }
    if (!status.authenticated) {
      announce(t('authSignedOut', 'Signed out'));
      this.opts.onSignedOut();
      return true;
    }
    await collapseRow(row);
    this.tokens = status.tokens ?? this.tokens.filter((x) => x.id !== token.id);
    this.note.replaceChildren();
    this.renderRows();
    // Focus what took the removed row's place, else the one before, else "Add".
    const rows = [...this.list.children] as HTMLElement[];
    const next = rows[Math.min(index, rows.length - 1)]?.querySelector<HTMLElement>('.token-remove');
    (next ?? this.addFocusTarget()).focus();
    announce(t('tokensRemoved', 'Token removed'));
    this.opts.onChange(status);
    return true;
  }

  private addFocusTarget(): HTMLElement {
    return this.addPanel.hidden ? this.addToggle : this.orgInput;
  }

  // --------------------------------------------------------- add form

  private syncCreateLink(): void {
    const owner = normalizeOwner(this.orgInput.value);
    const invalid = owner === null;
    this.orgWarning.hidden = !invalid;
    if (invalid) {
      this.orgInput.setAttribute('aria-invalid', 'true');
      this.orgInput.setAttribute('aria-describedby', `${this.orgWarning.id} ${this.orgHintId}`);
    } else {
      this.orgInput.removeAttribute('aria-invalid');
      this.orgInput.setAttribute('aria-describedby', this.orgHintId);
    }
    this.createLink.href = tokenPrefillUrl(owner ?? '');
    this.createLabel.textContent = owner
      ? t('tokensCreateFor', 'Create a token for $1', owner)
      : t('authCreateFineGrained', 'Create a fine-grained token');
  }

  /**
   * Reveal the add form. `owner` prefills the organization (then the token
   * input gets focus, since the organization is already known).
   */
  expandAdd(owner?: string, focus = true): void {
    const wasHidden = this.addPanel.hidden;
    this.addPanel.hidden = false;
    this.addToggle.hidden = true;
    this.addToggle.setAttribute('aria-expanded', 'true');
    this.note.replaceChildren();
    if (owner !== undefined) {
      this.orgInput.value = owner;
      this.syncCreateLink();
    }
    if (wasHidden) {
      this.addPanel.classList.remove('anim-rise-in');
      void this.addPanel.offsetWidth;
      this.addPanel.classList.add('anim-rise-in');
    }
    if (!focus) return;
    (owner ? this.tokenForm.input : this.orgInput).focus({ preventScroll: true });
    this.addPanel.scrollIntoView?.({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  collapseAdd(focusToggle: boolean): void {
    this.addPanel.hidden = true;
    this.addPanel.classList.remove('anim-rise-in');
    this.addToggle.hidden = false;
    this.addToggle.setAttribute('aria-expanded', 'false');
    this.tokenForm.reset();
    this.orgInput.value = '';
    this.syncCreateLink();
    if (focusToggle) this.addToggle.focus();
  }

  addState(): AddFormState {
    return { expanded: !this.addPanel.hidden, org: this.orgInput.value };
  }

  restoreAddState(state: AddFormState): void {
    if (!state.expanded) return;
    this.expandAdd(state.org, false);
    this.addPanel.classList.remove('anim-rise-in');
  }

  private added(status: AuthStatus): void {
    const before = new Set(this.tokens.map((x) => x.id));
    const wanted = normalizeOwner(this.orgInput.value) || '';
    this.tokens = status.tokens ?? this.tokens;
    const fresh = this.tokens.filter((x) => !before.has(x.id));
    this.collapseAdd(false);
    this.renderRows(new Set(fresh.map((x) => x.id)));
    this.renderMismatch(fresh[0], wanted);
    const row = fresh[0] ? this.rowFor(fresh[0].id) : null;
    (row ?? this.addToggle).focus();
    announce(fresh[0] ? t('tokensAddedCoverage', 'Token added. $1', coverageText(fresh[0])) : t('tokensAdded', 'Token added'));
    this.opts.onChange(status);
  }

  /**
   * The new token was meant for `wanted` but doesn't reach its private
   * repositories (yet): usually the organization still has to approve it.
   */
  private renderMismatch(token: TokenSummary | undefined, wanted: string): void {
    this.note.replaceChildren();
    if (!token || !wanted || token.owners === null) return;
    const covers = token.owners.some((o) => o.toLowerCase() === wanted.toLowerCase());
    if (covers || (!token.owners.length && !token.publicOnly)) return;
    this.note.append(
      h(
        'div',
        { class: 'notice notice-attention', attrs: { role: 'note' } },
        icon('alert', 16),
        h('span', {
          text: t(
            'tokensOwnerMismatch',
            'The new token can’t read private repositories of $1 yet. If $1 requires approval for fine-grained tokens, an organization owner has to approve it.',
            wanted
          ),
        })
      )
    );
  }
}
