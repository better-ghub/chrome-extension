// Better GHub - Slim bar above the PR list: summary counts, the no-token
// notice, or a status message; plus the page-level screen-reader status.

import { h } from '../../core/dom';
import { icon, type IconName } from '../../core/icons';
import { t } from '../../i18n';
import { tPlural } from '../../ui/format';
import type { ListSummary } from './analyze';

export interface BarAction {
  label: string;
  onClick: () => void;
}

export interface BarLink {
  label: string;
  /** Opens in a new tab. */
  href: string;
}

export class TopBar {
  /** Inserted right before the list: [sr-only status][visible bar]. */
  readonly root: HTMLElement;
  private readonly status: HTMLElement;
  private readonly bar: HTMLElement;
  private contentKey = '';

  constructor(signal: AbortSignal) {
    this.status = h('div', { class: 'bghub-sr-only', attrs: { role: 'status', 'aria-live': 'polite' } });
    this.bar = h('div', { class: 'bghub-prl-bar', attrs: { hidden: true } });
    this.root = h('div', { class: 'bghub-prl-top' }, this.status, this.bar);
    signal.addEventListener('abort', () => this.root.remove(), { once: true });
  }

  /** Keep the bar directly above the (possibly re-rendered) list. */
  place(list: Element): void {
    if (this.root.nextElementSibling !== list) list.before(this.root);
  }

  announce(text: string): void {
    if (this.status.textContent !== text) this.status.textContent = text;
  }

  private set(key: string, build: () => (Node | null)[], className = '', groupLabel = ''): void {
    if (key === this.contentKey) return;
    this.contentKey = key;
    this.bar.className = `bghub-prl-bar${className ? ` ${className}` : ''}`;
    this.bar.replaceChildren(...build().filter((n): n is Node => !!n));
    this.bar.hidden = !key;
    if (groupLabel) {
      this.bar.setAttribute('role', 'group');
      this.bar.setAttribute('aria-label', groupLabel);
    } else {
      this.bar.removeAttribute('role');
      this.bar.removeAttribute('aria-label');
    }
  }

  clear(): void {
    this.set('', () => []);
  }

  private button(a: BarAction, cls = 'bghub-prl-btn'): HTMLButtonElement {
    return h('button', { class: cls, attrs: { type: 'button' }, text: a.label, on: { click: a.onClick } });
  }

  notice(text: string, connect: BarAction, onDismiss: () => void): void {
    this.alert({ icon: 'info', text, action: connect, onDismiss });
  }

  /** Dismissible notice: [icon] [text or external link] [action] [×]. */
  alert(o: { icon: IconName; text?: string; link?: BarLink; action?: BarAction; onDismiss: () => void }): void {
    const key = `alert:${o.icon}:${o.text ?? ''}:${o.link?.href ?? ''}:${o.link?.label ?? ''}:${o.action?.label ?? ''}`;
    this.set(key, () => [
      icon(o.icon, 16, 'bghub-prl-bar-icon'),
      h(
        'span',
        { class: 'bghub-prl-bar-text' },
        o.text ?? null,
        o.link
          ? h(
              'a',
              {
                class: 'bghub-prl-bar-link',
                attrs: { href: o.link.href, target: '_blank', rel: 'noopener noreferrer' },
              },
              o.link.label,
              ' ',
              icon('link-external', 12)
            )
          : null
      ),
      o.action ? this.button(o.action) : null,
      h(
        'button',
        {
          class: 'bghub-prl-dismiss',
          attrs: { type: 'button', 'aria-label': t('prlDismiss', 'Dismiss') },
          on: { click: o.onDismiss },
        },
        icon('x', 16)
      ),
    ], 'bghub-prl-notice');
  }

  message(iconName: IconName, text: string, action?: BarAction): void {
    this.set(`msg:${iconName}:${text}`, () => [
      icon(iconName, 16, 'bghub-prl-bar-icon'),
      h('span', { class: 'bghub-prl-bar-text', text }),
      action ? this.button(action) : null,
    ], 'bghub-prl-bar--message');
  }

  summary(s: ListSummary, reviewQueueHref: string): void {
    const parts: [IconName, Node | string][] = [];
    if (s.needYourReview) {
      parts.push([
        'eye',
        h('a', {
          class: 'bghub-prl-bar-link',
          attrs: { href: reviewQueueHref },
          text: tPlural('prlSumReview', s.needYourReview, '$1 needs your review', '$1 need your review'),
        }),
      ]);
    }
    if (s.ready) parts.push(['check-circle', tPlural('prlSumReady', s.ready, '$1 ready to merge', '$1 ready to merge')]);
    if (s.conflicts) parts.push(['alert', tPlural('prlSumConflicts', s.conflicts, '$1 has conflicts', '$1 have conflicts')]);
    if (s.unresolvedThreads) {
      parts.push(['comment-discussion', tPlural('prlSumThreads', s.unresolvedThreads, '$1 unresolved thread', '$1 unresolved threads')]);
    }
    if (!parts.length) {
      this.clear();
      return;
    }
    const key = `sum:${s.needYourReview}:${s.ready}:${s.conflicts}:${s.unresolvedThreads}:${reviewQueueHref}`;
    this.set(
      key,
      () =>
        parts.flatMap(([name, content], i) => [
          i ? h('span', { class: 'bghub-prl-bar-sep', attrs: { 'aria-hidden': 'true' }, text: '·' }) : null,
          h('span', { class: `bghub-prl-bar-item bghub-prl-bar-item--${name}` }, icon(name, 16), content),
        ]),
      'bghub-prl-bar--summary',
      t('prlSummaryLabel', 'Pull request activity summary')
    );
  }
}
