// Better GHub - Click-toggled popover for injected UI (top layer, keyboard friendly).
//
// Unlike the shared tooltip, content can be interactive (links): focus moves
// into the panel on open, Esc closes and returns focus to the trigger, and a
// click or focus outside closes it.

import { h } from '../core/dom';

const GAP = 6;
const MARGIN = 8;

export interface PopoverContext {
  /** Call after the content changed size (e.g. async content arrived). */
  reposition(): void;
  close(): void;
}

let panel: HTMLDivElement | null = null;
let current: HTMLElement | null = null;

function supportsPopover(node: HTMLElement): boolean {
  return typeof node.showPopover === 'function';
}

function position(): void {
  if (!panel || !current) return;
  const r = current.getBoundingClientRect();
  const box = panel.getBoundingClientRect();
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = window.innerHeight;
  let top = r.bottom + GAP;
  if (top + box.height > vh - MARGIN && r.top - GAP - box.height >= MARGIN) top = r.top - GAP - box.height;
  const left = Math.min(Math.max(MARGIN, r.left), Math.max(MARGIN, vw - box.width - MARGIN));
  panel.style.top = `${Math.round(top)}px`;
  panel.style.left = `${Math.round(left)}px`;
}

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key !== 'Escape' || !current) return;
  ev.stopPropagation();
  const trigger = current;
  closePopover();
  trigger.focus();
}

function onPointerDown(ev: Event): void {
  const target = ev.target as Node | null;
  if (target && (panel?.contains(target) || current?.contains(target))) return;
  closePopover();
}

function onFocusIn(ev: FocusEvent): void {
  const target = ev.target as Node | null;
  if (target && (panel?.contains(target) || current?.contains(target))) return;
  closePopover();
}

export function closePopover(): void {
  if (!current) return;
  current.setAttribute('aria-expanded', 'false');
  current = null;
  document.removeEventListener('keydown', onKeydown, true);
  document.removeEventListener('pointerdown', onPointerDown, true);
  document.removeEventListener('focusin', onFocusIn, true);
  window.removeEventListener('resize', position);
  window.removeEventListener('scroll', position, true);
  if (!panel) return;
  if (supportsPopover(panel)) {
    if (panel.matches(':popover-open')) panel.hidePopover();
  } else {
    panel.hidden = true;
  }
  panel.replaceChildren();
}

function open(trigger: HTMLElement, build: (ctx: PopoverContext) => Node, label: string): void {
  closePopover();
  if (!panel?.isConnected) {
    panel = h('div', { class: 'bghub-popover', attrs: { role: 'dialog', tabindex: '-1', popover: 'manual' } });
    if (!supportsPopover(panel)) panel.hidden = true;
    document.body.appendChild(panel);
  }
  current = trigger;
  trigger.setAttribute('aria-expanded', 'true');
  panel.setAttribute('aria-label', label);
  panel.replaceChildren(build({ reposition: position, close: closePopover }));
  if (supportsPopover(panel)) panel.showPopover();
  else panel.hidden = false;
  position();
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('focusin', onFocusIn, true);
  window.addEventListener('resize', position, { passive: true });
  window.addEventListener('scroll', position, { capture: true, passive: true });
  (panel.querySelector<HTMLElement>('a[href]') ?? panel).focus({ preventScroll: true });
}

/**
 * Make `trigger` (a <button type="button">) toggle a popover whose content is
 * built on every open. Cleans up when `signal` aborts.
 */
export function attachPopover(trigger: HTMLElement, build: (ctx: PopoverContext) => Node, label: string, signal: AbortSignal): void {
  if (signal.aborted) return;
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.addEventListener(
    'click',
    (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (current === trigger) closePopover();
      else open(trigger, build, label);
    },
    { signal }
  );
  signal.addEventListener('abort', () => { if (current === trigger) closePopover(); }, { once: true });
}
