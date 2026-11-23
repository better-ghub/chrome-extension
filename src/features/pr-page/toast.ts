// Better GHub - PR page: toast notifications.
//
// The host is a `popover="manual"` element, so toasts render in the browser's
// top layer: no z-index fights with GitHub's sticky headers or overlays.
// Toasts are announced through a separate, always-rendered live region (a
// region that is display:none while the popover is closed would not be read).
//
// The host is a refcounted singleton: settings changes remount every feature
// synchronously (unmount → mount), and a toast shown just before that (e.g.
// "Floating button hidden") must survive. When the last user's signal aborts
// and nobody re-attaches in the same task, everything is removed.

import { h, prefersReducedMotion } from '../../core/dom';
import { icon, type IconName } from '../../core/icons';
import type { ShortcutBinding } from '../../shortcuts';
import { keycaps } from './labels';

export type ToastVariant = 'success' | 'info' | 'warning';

export interface ToastOptions {
  variant?: ToastVariant;
  icon?: IconName;
  /** Monospace detail shown after the message (branch name, …). */
  code?: string;
  /** Shortcut that triggered the toast — rendered as key caps. */
  binding?: ShortcutBinding | null;
  action?: { label: string; run(): void };
  /** Toasts with the same id update in place instead of stacking. */
  id?: string;
  duration?: number;
}

export interface Toaster {
  show(message: string, opts?: ToastOptions): void;
}

interface Entry {
  id?: string;
  el: HTMLElement;
  timer?: ReturnType<typeof setTimeout>;
  remaining: number;
  started: number;
}

const MAX_TOASTS = 3;
const DEFAULT_DURATION = 2200;
const ACTION_DURATION = 5000;
const DEFAULT_ICONS: Record<ToastVariant, IconName> = { success: 'check-circle', info: 'info', warning: 'alert' };

let host: HTMLElement | null = null;
let live: HTMLElement | null = null;
let entries: Entry[] = [];
let users = 0;

function popoverSupported(el: HTMLElement): boolean {
  return typeof el.showPopover === 'function';
}

function ensureHost(): HTMLElement {
  if (host?.isConnected) return host;
  host = h('div', { class: 'bghub-toast-host', attrs: { 'data-bghub': '' } });
  if (popoverSupported(host)) host.setAttribute('popover', 'manual');
  else host.classList.add('bghub-toast-host--fallback');
  live = h('div', { class: 'bghub-sr-only', attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', 'data-bghub': '' } });
  // Children of <html> (not <body>) survive Turbo's body swaps.
  document.documentElement.append(host, live);
  return host;
}

function modalOpen(): boolean {
  try {
    return !!document.querySelector(':modal');
  } catch {
    return false;
  }
}

/** Show the host, re-inserting it on top of the top layer if a modal opened after it. */
function raise(el: HTMLElement): void {
  if (!popoverSupported(el)) return;
  const open = el.matches(':popover-open');
  if (open && !modalOpen()) return;
  if (open) el.hidePopover();
  el.showPopover();
}

function announce(text: string): void {
  if (!live) return;
  live.textContent = '';
  // Clear + re-set so repeating the same message is announced again.
  setTimeout(() => {
    if (live) live.textContent = text;
  }, 60);
}

function schedule(entry: Entry): void {
  clearTimeout(entry.timer);
  entry.started = Date.now();
  entry.timer = setTimeout(() => dismiss(entry), entry.remaining);
}

function pause(entry: Entry): void {
  if (entry.timer === undefined) return;
  clearTimeout(entry.timer);
  entry.timer = undefined;
  entry.remaining = Math.max(800, entry.remaining - (Date.now() - entry.started));
}

/** Remove an element and slide the remaining toasts into place (FLIP). */
function removeWithFlip(el: HTMLElement): void {
  const rest = entries.map((e) => e.el);
  const before = rest.map((s) => s.getBoundingClientRect().top);
  el.remove();
  if (!entries.length && host && popoverSupported(host) && host.matches(':popover-open')) host.hidePopover();
  if (prefersReducedMotion()) return;
  rest.forEach((s, i) => {
    const dy = before[i] - s.getBoundingClientRect().top;
    if (Math.abs(dy) > 0.5 && typeof s.animate === 'function') {
      s.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 180, easing: 'cubic-bezier(0.3, 0.8, 0.6, 1)' });
    }
  });
}

function dismiss(entry: Entry): void {
  clearTimeout(entry.timer);
  entries = entries.filter((e) => e !== entry);
  const el = entry.el;
  if (prefersReducedMotion() || !el.isConnected) return removeWithFlip(el);
  el.classList.add('bghub-leaving');
  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    removeWithFlip(el);
  };
  el.addEventListener('animationend', finish, { once: true });
  setTimeout(finish, 200);
}

function content(message: string, opts: ToastOptions, entryRef: () => Entry | undefined): Node[] {
  const variant = opts.variant ?? 'success';
  const action = opts.action;
  return [
    h('span', { class: 'bghub-toast-icon' }, icon(opts.icon ?? DEFAULT_ICONS[variant], 16)),
    h('span', { class: 'bghub-toast-text' }, message, opts.code ? h('code', { class: 'bghub-toast-code', text: opts.code }) : null),
    action
      ? h('button', {
          class: 'bghub-toast-action',
          attrs: { type: 'button' },
          text: action.label,
          on: {
            click: () => {
              const entry = entryRef();
              if (entry) dismiss(entry);
              action.run();
            },
          },
        })
      : null,
    opts.binding ? keycaps(opts.binding, 'bghub-toast-keys') : null,
  ].filter((n): n is HTMLElement => n !== null);
}

function show(message: string, opts: ToastOptions = {}): void {
  const root = ensureHost();
  const variant = opts.variant ?? 'success';
  const duration = opts.duration ?? (opts.action ? ACTION_DURATION : DEFAULT_DURATION);
  const existing = opts.id ? entries.find((e) => e.id === opts.id) : undefined;
  announce(opts.code ? `${message} ${opts.code}` : message);

  if (existing) {
    existing.el.className = `bghub-toast bghub-toast--${variant}`;
    existing.el.replaceChildren(...content(message, opts, () => existing));
    // Restart the "bump" animation so repeated presses are visibly acknowledged.
    existing.el.classList.remove('bghub-toast--bump');
    void existing.el.offsetWidth;
    existing.el.classList.add('bghub-toast--bump');
    existing.remaining = duration;
    schedule(existing);
    raise(root);
    return;
  }

  const entry: Entry = { id: opts.id, el: h('div', { class: `bghub-toast bghub-toast--${variant}` }), remaining: duration, started: 0 };
  entry.el.append(...content(message, opts, () => entry));
  entry.el.addEventListener('mouseenter', () => pause(entry));
  entry.el.addEventListener('mouseleave', () => schedule(entry));
  entry.el.addEventListener('focusin', () => pause(entry));
  entry.el.addEventListener('focusout', () => schedule(entry));

  while (entries.length >= MAX_TOASTS) dismiss(entries[0]);
  entries.push(entry);
  root.append(entry.el);
  raise(root);
  schedule(entry);
}

function destroy(): void {
  for (const e of entries) clearTimeout(e.timer);
  entries = [];
  host?.remove();
  live?.remove();
  host = live = null;
}

/** Get the shared toaster for the lifetime of `signal`. */
export function attachToaster(signal: AbortSignal): Toaster {
  users++;
  signal.addEventListener(
    'abort',
    () => {
      users--;
      queueMicrotask(() => {
        if (users === 0) destroy();
      });
    },
    { once: true }
  );
  // A late caller (e.g. copy-branch waiting on the API) must not rebuild the
  // toast host on whatever page the user navigated to in the meantime.
  return {
    show: (message, opts) => {
      if (!signal.aborted) show(message, opts);
    },
  };
}

/** Test helper: currently visible toast elements. */
export function _toastElements(): HTMLElement[] {
  return entries.map((e) => e.el);
}
