// Better GHub - Small action menu (WAI-ARIA menu button pattern).
//
// The trigger has aria-haspopup="menu"; opening moves focus to the first item.
// Arrow keys / Home / End move between items, Enter/Space activate, Esc and
// Tab close and return focus to the trigger. Clicking outside, window blur or
// losing the trigger closes it; scrolling/resizing re-anchors it. Positioned
// `fixed` so scroll containers can't clip it.

import { h } from '../core/dom';
import { uid } from './dom-ui';

export interface MenuItem {
  label: string;
  /** Decorative leading icon. */
  icon?: SVGElement | null;
  onSelect(): void;
}

export interface MenuOptions {
  /** Accessible name of the menu. */
  label: string;
}

let current: { close(focusTrigger: boolean): void } | null = null;
const closeListeners = new Set<() => void>();

export function isMenuOpen(): boolean {
  return current !== null;
}

/**
 * Run `cb` once the open menu closes (right away when none is open). Views
 * use it to hold back a re-render that would otherwise destroy the menu's
 * trigger while the user is choosing an item.
 */
export function whenMenuClosed(cb: () => void): void {
  if (!current) cb();
  else closeListeners.add(cb);
}

/** Close the open menu, if any. */
export function closeMenu(focusTrigger = false): void {
  current?.close(focusTrigger);
}

/** Wire `trigger` as a menu button whose items are built on every open. */
export function attachMenu(trigger: HTMLButtonElement, items: () => MenuItem[], opts: MenuOptions): void {
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.addEventListener('click', () => {
    if (trigger.getAttribute('aria-expanded') === 'true') closeMenu(true);
    else openMenu(trigger, items(), opts);
  });
  trigger.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    openMenu(trigger, items(), opts, e.key === 'ArrowUp' ? 'last' : 'first');
  });
}

export function openMenu(trigger: HTMLElement, items: MenuItem[], opts: MenuOptions, focus: 'first' | 'last' = 'first'): void {
  closeMenu(false);
  const id = uid('menu');
  const buttons = items.map((item) => {
    const btn = h(
      'button',
      { class: 'menu-item', attrs: { type: 'button', role: 'menuitem', tabindex: -1 } },
      item.icon ?? null,
      h('span', { text: item.label })
    );
    btn.addEventListener('click', () => {
      close(false);
      item.onSelect();
    });
    btn.addEventListener('pointermove', () => {
      if (document.activeElement !== btn) btn.focus({ preventScroll: true });
    });
    return btn;
  });
  const menu = h('div', { class: 'menu', attrs: { id, role: 'menu', 'aria-label': opts.label } }, buttons);

  const move = (delta: number | 'first' | 'last'): void => {
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (delta === 'first') next = 0;
    else if (delta === 'last') next = buttons.length - 1;
    else next = (index + delta + buttons.length) % buttons.length;
    buttons[next]?.focus({ preventScroll: true });
  };

  menu.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowDown':
        move(1);
        break;
      case 'ArrowUp':
        move(-1);
        break;
      case 'Home':
        move('first');
        break;
      case 'End':
        move('last');
        break;
      case 'Escape':
      case 'Tab':
        close(true);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  });

  const onPointerDown = (e: Event): void => {
    const target = e.target as Node | null;
    if (target && (menu.contains(target) || trigger.contains(target))) return;
    close(false);
  };
  const onViewportChange = (e: Event): void => {
    if (e.type === 'scroll' && menu.contains(e.target as Node)) return;
    if (e.type === 'blur') {
      close(false);
      return;
    }
    // Layout shifts (content swapped in above, a list re-rendered) also fire
    // scroll/resize. Follow the trigger instead of closing; close only when
    // the trigger is gone or scrolled out of view.
    if (!trigger.isConnected || !inViewport(trigger)) {
      close(false);
      return;
    }
    position(menu, trigger);
  };

  function close(focusTrigger: boolean): void {
    if (current !== handle) return;
    current = null;
    document.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('scroll', onViewportChange, true);
    window.removeEventListener('resize', onViewportChange);
    window.removeEventListener('blur', onViewportChange);
    menu.remove();
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-controls');
    if (focusTrigger && trigger.isConnected) trigger.focus();
    // After the selected item's handler has started (it runs right after close()).
    const waiting = [...closeListeners];
    closeListeners.clear();
    for (const cb of waiting) queueMicrotask(cb);
  }
  const handle = { close };
  current = handle;

  document.body.appendChild(menu);
  position(menu, trigger);
  trigger.setAttribute('aria-expanded', 'true');
  trigger.setAttribute('aria-controls', id);
  document.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('scroll', onViewportChange, true);
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('blur', onViewportChange);
  move(focus);
}

function inViewport(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
}

/** Below the trigger, right-aligned; flipped above when there is no room. */
function position(menu: HTMLElement, trigger: HTMLElement): void {
  const margin = 4;
  const r = trigger.getBoundingClientRect();
  const { offsetWidth: w, offsetHeight: hgt } = menu;
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = document.documentElement.clientHeight || window.innerHeight;
  let top = r.bottom + margin;
  if (top + hgt > vh - margin && r.top - margin - hgt >= margin) top = r.top - margin - hgt;
  const left = Math.min(Math.max(margin, r.right - w), Math.max(margin, vw - w - margin));
  menu.style.top = `${Math.max(margin, top)}px`;
  menu.style.left = `${left}px`;
}
