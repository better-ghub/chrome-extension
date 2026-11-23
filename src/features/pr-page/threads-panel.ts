// Better GHub - PR page: unresolved threads side panel (Alt+T).
//
// A non-modal `popover="manual"` panel in the top layer (right edge): it stays
// open while the reader jumps between threads, replies or scrolls. Arrow keys
// move between items (roving tabindex), Enter/click jumps (focus stays in the
// panel), Esc closes and returns focus to where it was. While open it rebuilds
// whenever GitHub re-renders threads (resolve, new comments, tab switch).

import { h, observe } from '../../core/dom';
import { icon } from '../../core/icons';
import { parsePage } from '../../core/page';
import { t } from '../../i18n';
import { buildThreadItems } from './threads-model';
import { renderItems, sameItems } from './threads-panel-view';
import type { ThreadItem } from './threads-model';

export interface ThreadsPanel {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
}

interface PanelOptions {
  signal: AbortSignal;
  /** Expand + scroll + highlight a thread without moving focus. */
  reveal(thread: Element): void;
}

let uid = 0;

function popoverSupported(el: HTMLElement): boolean {
  return typeof el.showPopover === 'function';
}

function onThreadTab(): boolean {
  const tab = parsePage(location.href).prTab;
  return tab === 'conversation' || tab === 'files';
}

export function createThreadsPanel({ signal, reveal }: PanelOptions): ThreadsPanel {
  const id = `bghub-tp-${++uid}`;
  const count = h('span', { class: 'bghub-chip bghub-tp-count' });
  const body = h('div', { class: 'bghub-tp-body' });
  const panel = h(
    'section',
    { class: 'bghub-tp', attrs: { role: 'dialog', 'aria-labelledby': `${id}-title`, 'data-bghub': '' } },
    h(
      'header',
      { class: 'bghub-tp-header' },
      h('span', { class: 'bghub-tp-header-icon' }, icon('comment-discussion', 16)),
      h('h2', { class: 'bghub-tp-title', attrs: { id: `${id}-title` }, text: t('prPagePanelTitle', 'Unresolved threads') }),
      count,
      h('button', { class: 'bghub-tp-close', attrs: { type: 'button', 'aria-label': t('prPageClose', 'Close') }, on: { click: () => close() } }, icon('x', 16))
    ),
    body,
    h(
      'footer',
      { class: 'bghub-tp-footer', attrs: { 'aria-hidden': 'true' } },
      h('span', null, h('kbd', { class: 'bghub-kbd', text: '↑' }), h('kbd', { class: 'bghub-kbd', text: '↓' }), t('prPagePanelKeysMove', 'move')),
      h('span', null, h('kbd', { class: 'bghub-kbd', text: '↵' }), t('prPagePanelKeysJump', 'jump')),
      h('span', null, h('kbd', { class: 'bghub-kbd', text: 'Esc' }), t('prPagePanelKeysClose', 'close'))
    )
  );
  if (popoverSupported(panel)) panel.setAttribute('popover', 'manual');
  else {
    panel.classList.add('bghub-tp--fallback');
    panel.hidden = true;
  }

  let items: ThreadItem[] = [];
  let active: Element | null = null;
  let previousFocus: Element | null = null;
  let session: AbortController | null = null;

  const isOpen = (): boolean => session !== null;
  const buttons = (): HTMLButtonElement[] => Array.from(body.querySelectorAll<HTMLButtonElement>('.bghub-tp-item'));

  const jump = (item: ThreadItem): void => {
    active = item.el;
    const index = String(items.indexOf(item));
    for (const b of buttons()) {
      if (b.dataset.index === index) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    }
    reveal(item.el);
  };

  const render = (force = false): void => {
    const next = buildThreadItems(document);
    if (!force && sameItems(items, next)) return;
    const focused = body.contains(document.activeElement) ? items[Number((document.activeElement as HTMLElement).dataset.index)]?.el : null;
    items = next;
    count.textContent = String(items.length);
    count.setAttribute('aria-label', t('prPagePanelCount', '$1 unresolved', String(items.length)));
    body.replaceChildren(renderItems(items, active, jump));
    // Keep focus on the same thread across rebuilds (or the nearest item).
    if (focused !== null && focused !== undefined) {
      const list = buttons();
      const idx = Math.max(0, items.findIndex((i) => i.el === focused));
      (list[Math.min(idx, list.length - 1)] ?? panel.querySelector<HTMLElement>('.bghub-tp-close'))?.focus();
    }
  };

  const move = (to: number): void => {
    const list = buttons();
    if (list.length) list[(to + list.length) % list.length].focus();
  };

  // Roving tabindex: whichever item has focus is the one Tab returns to.
  body.addEventListener('focusin', (e) => {
    const list = buttons();
    if (!list.includes(e.target as HTMLButtonElement)) return;
    for (const b of list) b.tabIndex = b === e.target ? 0 : -1;
  }, { signal });

  panel.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    const index = buttons().indexOf(target as HTMLButtonElement);
    let handled = true;
    if (e.key === 'Escape') close();
    else if (index !== -1 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) move(index + (e.key === 'ArrowDown' ? 1 : -1));
    else if (index !== -1 && e.key === 'Home') move(0);
    else if (index !== -1 && e.key === 'End') move(-1);
    else handled = false;
    if (handled) {
      // Keep GitHub's own hotkeys (and page scrolling) out of it.
      e.preventDefault();
      e.stopPropagation();
    }
  }, { signal });

  function open(): void {
    if (isOpen() || signal.aborted) return;
    session = new AbortController();
    previousFocus = document.activeElement;
    render(true);
    if (!panel.isConnected) document.documentElement.append(panel);
    if (popoverSupported(panel)) panel.showPopover();
    else panel.hidden = false;
    (buttons()[0] ?? panel.querySelector<HTMLElement>('.bghub-tp-close'))?.focus();
    observe(document.documentElement, () => (onThreadTab() ? render() : close()), session.signal, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-resolved'],
    });
  }

  function close(): void {
    if (!session) return;
    session.abort();
    session = null;
    const hadFocus = panel.contains(document.activeElement);
    if (popoverSupported(panel)) {
      if (panel.matches(':popover-open')) panel.hidePopover();
    } else panel.hidden = true;
    // Return focus only if it was ours to give back (not after a click elsewhere on the page).
    if (hadFocus && previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    previousFocus = null;
  }

  signal.addEventListener(
    'abort',
    () => {
      close();
      setTimeout(() => panel.remove(), 250); // let the exit transition finish
    },
    { once: true }
  );

  return { open, close, isOpen, toggle: () => (isOpen() ? close() : open()) };
}
