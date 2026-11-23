// Better GHub - One shared tooltip for all injected UI.
//
// - Popover API (`popover="manual"`) puts it in the browser top layer, above
//   GitHub's sticky headers and overlays with no z-index games.
// - 400 ms hover delay, instant on keyboard focus, instant when moving from
//   one trigger to the next while a tooltip is showing.
// - 100 ms hide grace so the pointer can move onto the tooltip, and Esc hides
//   it without moving focus (WCAG 1.4.13 hoverable / dismissible / persistent).
// - Triggers are real <button>s; aria-describedby is set only while open.

import { h } from '../core/dom';

const SHOW_DELAY = 400;
const HIDE_GRACE = 100;
const WARM_WINDOW = 300;
const GAP = 6;
const MARGIN = 8;
const TOOLTIP_ID = 'bghub-tooltip';

type Content = () => Node | string;

let el: HTMLDivElement | null = null;
let owner: HTMLElement | null = null;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let watchTimer: ReturnType<typeof setInterval> | undefined;
let lastHiddenAt = 0;
const users = new Set<AbortSignal>();
const contents = new WeakMap<HTMLElement, Content>();
const ownerSignal = new WeakMap<HTMLElement, AbortSignal>();

function supportsPopover(node: HTMLElement): boolean {
  return typeof node.showPopover === 'function';
}

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key === 'Escape' && owner) hide();
}

function onViewportChange(): void {
  if (owner) position(owner);
}

function ensureEl(): HTMLDivElement {
  if (el?.isConnected) return el;
  el = h('div', {
    class: 'bghub-tooltip',
    attrs: { id: TOOLTIP_ID, role: 'tooltip', popover: 'manual' },
    on: { pointerenter: () => clearTimeout(hideTimer), pointerleave: () => scheduleHide() },
  });
  if (!supportsPopover(el)) el.hidden = true;
  document.body.appendChild(el);
  document.addEventListener('keydown', onKeydown, true);
  window.addEventListener('scroll', onViewportChange, { capture: true, passive: true });
  window.addEventListener('resize', onViewportChange, { passive: true });
  return el;
}

function destroyEl(): void {
  hide();
  document.removeEventListener('keydown', onKeydown, true);
  window.removeEventListener('scroll', onViewportChange, { capture: true });
  window.removeEventListener('resize', onViewportChange);
  el?.remove();
  el = null;
}

function position(trigger: HTMLElement): void {
  if (!el) return;
  const r = trigger.getBoundingClientRect();
  const tip = el.getBoundingClientRect();
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = window.innerHeight;
  let top = r.bottom + GAP;
  let side = 'bottom';
  if (top + tip.height > vh - MARGIN && r.top - GAP - tip.height >= MARGIN) {
    top = r.top - GAP - tip.height;
    side = 'top';
  }
  const left = Math.min(Math.max(MARGIN, r.left + r.width / 2 - tip.width / 2), Math.max(MARGIN, vw - tip.width - MARGIN));
  el.style.top = `${Math.round(top)}px`;
  el.style.left = `${Math.round(left)}px`;
  el.dataset.side = side;
}

function show(trigger: HTMLElement): void {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  const content = contents.get(trigger);
  if (!content || !trigger.isConnected) return;
  const tip = ensureEl();
  if (owner && owner !== trigger) owner.removeAttribute('aria-describedby');
  owner = trigger;
  tip.replaceChildren(content());
  if (supportsPopover(tip)) {
    if (!tip.matches(':popover-open')) tip.showPopover();
  } else {
    tip.hidden = false;
  }
  trigger.setAttribute('aria-describedby', TOOLTIP_ID);
  position(trigger);
  clearInterval(watchTimer);
  // Triggers can vanish under us (React re-render, our own re-render).
  watchTimer = setInterval(() => {
    if (owner && !owner.isConnected) hide();
  }, 250);
}

export function hide(): void {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  clearInterval(watchTimer);
  if (!owner) return;
  owner.removeAttribute('aria-describedby');
  owner = null;
  lastHiddenAt = Date.now();
  if (!el) return;
  if (supportsPopover(el)) {
    if (el.matches(':popover-open')) el.hidePopover();
  } else {
    el.hidden = true;
  }
}

function scheduleHide(): void {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hide, HIDE_GRACE);
}

function scheduleShow(trigger: HTMLElement): void {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  const warm = owner !== null || Date.now() - lastHiddenAt < WARM_WINDOW;
  if (warm) show(trigger);
  else showTimer = setTimeout(() => show(trigger), SHOW_DELAY);
}

/**
 * Attach the shared tooltip to `trigger` (a <button type="button">). `content`
 * is built on every show, so it can be cheap and always current. Everything is
 * removed when `signal` aborts; the tooltip element itself goes away when the
 * last user's signal aborts.
 */
export function attachTooltip(trigger: HTMLElement, content: Content, signal: AbortSignal): void {
  if (signal.aborted) return;
  contents.set(trigger, content);
  if (!users.has(signal)) {
    users.add(signal);
    signal.addEventListener('abort', () => {
      users.delete(signal);
      if (owner && signal === ownerSignal.get(owner)) hide();
      if (!users.size) destroyEl();
    }, { once: true });
  }
  ownerSignal.set(trigger, signal);
  const opts = { signal };
  trigger.addEventListener('pointerenter', (ev) => {
    if (ev.pointerType !== 'touch') scheduleShow(trigger);
  }, opts);
  trigger.addEventListener('pointerleave', () => {
    clearTimeout(showTimer);
    if (owner === trigger) scheduleHide();
  }, opts);
  trigger.addEventListener('focus', () => show(trigger), opts);
  trigger.addEventListener('blur', () => {
    if (owner === trigger) hide();
  }, opts);
  trigger.addEventListener('click', () => {
    if (owner !== trigger) show(trigger);
  }, opts);
}
