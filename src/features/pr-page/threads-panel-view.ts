// Better GHub - PR page: rendering of the unresolved-threads panel list.
// Page data goes in as text nodes / attributes only.

import { h } from '../../core/dom';
import { icon } from '../../core/icons';
import { t } from '../../i18n';
import type { ThreadItem } from './threads-model';

/** Same threads with the same visible content → no rebuild (keeps focus and scroll untouched). */
export function sameItems(a: readonly ThreadItem[], b: readonly ThreadItem[]): boolean {
  return (
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i];
      return x.el === y.el && x.path === y.path && x.excerpt === y.excerpt && x.author === y.author && x.outdated === y.outdated && x.avatar === y.avatar;
    })
  );
}

function renderItem(item: ThreadItem, index: number, current: boolean, onJump: (item: ThreadItem) => void): HTMLElement {
  const path = item.path || t('prPagePanelNoPath', 'Review thread');
  return h(
    'li',
    { class: 'bghub-tp-row' },
    h(
      'button',
      {
        class: 'bghub-tp-item',
        // Roving tabindex: only the first item is in the tab order.
        attrs: { type: 'button', tabindex: index === 0 ? 0 : -1, 'aria-current': current ? 'true' : null, title: item.path || null },
        dataset: { index: String(index) },
        on: { click: () => onJump(item) },
      },
      h(
        'span',
        { class: 'bghub-tp-meta' },
        // Truncated from the left (CSS): the file name is the informative end.
        h('span', { class: 'bghub-tp-path' }, h('bdi', { attrs: { dir: 'ltr' }, text: path })),
        item.outdated ? h('span', { class: 'bghub-chip bghub-chip--attention bghub-tp-outdated', text: t('prPagePanelOutdated', 'Outdated') }) : null
      ),
      h(
        'span',
        { class: 'bghub-tp-comment' },
        item.avatar ? h('img', { class: 'bghub-tp-avatar', attrs: { src: item.avatar, alt: '', width: 16, height: 16, loading: 'lazy', referrerpolicy: 'no-referrer' } }) : null,
        item.author ? h('span', { class: 'bghub-tp-author', text: item.author }) : null,
        h('span', { class: 'bghub-tp-excerpt', text: item.excerpt })
      )
    )
  );
}

export function renderItems(items: readonly ThreadItem[], active: Element | null, onJump: (item: ThreadItem) => void): HTMLElement {
  if (!items.length) {
    return h(
      'div',
      { class: 'bghub-tp-empty' },
      h('span', { class: 'bghub-tp-empty-icon' }, icon('check-circle', 24)),
      h('p', { text: t('prPagePanelEmpty', 'No unresolved threads') })
    );
  }
  return h(
    'ul',
    { class: 'bghub-tp-list', attrs: { 'aria-label': t('prPagePanelTitle', 'Unresolved threads') } },
    items.map((item, i) => renderItem(item, i, item.el === active, onJump))
  );
}
