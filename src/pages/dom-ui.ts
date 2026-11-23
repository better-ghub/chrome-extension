// Better GHub - Small DOM components for the extension pages.
//
// Pairs with shared/ui.css. Everything takes API data as text/attributes only;
// the only markup strings are our own static icons.

import { h, prefersReducedMotion } from '../core/dom';
import { icon, type IconName } from '../core/icons';
import { bindingKeys, isMacPlatform, type ShortcutBinding } from '../shortcuts';
import { t } from '../i18n';

const SVG_NS = 'http://www.w3.org/2000/svg';

let idCounter = 0;
/** Unique DOM id with a readable prefix. */
export function uid(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Check mark that draws itself (stroke animation, see .check-draw). */
export function checkDraw(size = 16, className = ''): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `check-draw${className ? ` ${className}` : ''}`);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M3.25 8.5 6.5 11.75 12.75 4.75');
  path.setAttribute('pathLength', '1');
  svg.appendChild(path);
  return svg;
}

export function spinner(): HTMLSpanElement {
  return h('span', { class: 'spinner', attrs: { 'aria-hidden': 'true' } });
}

/** Label span used by buttons whose text changes while busy. */
export function btnLabel(text: string): HTMLSpanElement {
  return h('span', { class: 'btn-label', text });
}

/**
 * Busy state for a button: inline spinner + optional busy label. Uses
 * aria-disabled (not `disabled`) so keyboard focus stays on the button.
 */
export function setButtonBusy(btn: HTMLButtonElement, busy: boolean, busyLabel?: string): void {
  const label = btn.querySelector<HTMLElement>('.btn-label');
  if (busy) {
    if (btn.classList.contains('is-busy')) return;
    btn.dataset.idleLabel = label?.textContent ?? '';
    btn.classList.add('is-busy');
    btn.setAttribute('aria-disabled', 'true');
    const firstIcon = btn.querySelector(':scope > svg');
    if (firstIcon) firstIcon.setAttribute('hidden', '');
    btn.prepend(spinner());
    if (label && busyLabel) label.textContent = busyLabel;
  } else {
    btn.classList.remove('is-busy');
    btn.removeAttribute('aria-disabled');
    btn.querySelector(':scope > .spinner')?.remove();
    btn.querySelector(':scope > svg[hidden]')?.removeAttribute('hidden');
    if (label && btn.dataset.idleLabel !== undefined) label.textContent = btn.dataset.idleLabel;
  }
}

export function isBusy(btn: HTMLElement): boolean {
  return btn.classList.contains('is-busy');
}

/** Key caps for a binding: <kbd>⌥</kbd><kbd>C</kbd>. */
export function keyCaps(binding: ShortcutBinding, mac = isMacPlatform()): HTMLSpanElement {
  return h(
    'span',
    { class: 'kbd-group' },
    bindingKeys(binding, mac).map((k) => h('kbd', { class: 'kbd', text: k }))
  );
}

/**
 * Fragment from a translated message where $1..$9 become the given nodes —
 * lets translators move placeholders without string concatenation.
 */
export function fillTemplate(message: string, ...nodes: (Node | string)[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  const re = /\$(\d)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(message))) {
    if (m.index > last) frag.append(message.slice(last, m.index));
    const node = nodes[Number(m[1]) - 1];
    frag.append(node ?? m[0]);
    last = re.lastIndex;
  }
  if (last < message.length) frag.append(message.slice(last));
  return frag;
}

/** GitHub avatar URL at a given pixel size (2x for crisp rendering). */
export function sizedAvatarUrl(url: string, px: number): string {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('githubusercontent.com')) u.searchParams.set('s', String(px * 2));
    return u.toString();
  } catch {
    return url;
  }
}

/** Decorative avatar (alt="") that falls back to a neutral person glyph. */
export function avatar(url: string | null | undefined, size: number, className = ''): HTMLElement {
  const fallback = (): HTMLElement =>
    h(
      'span',
      {
        class: `avatar avatar-fallback ${className}`.trim(),
        style: { width: `${size}px`, height: `${size}px` },
        attrs: { 'aria-hidden': 'true' },
      },
      icon('person', Math.round(size * 0.55))
    );
  if (!url) return fallback();
  const img = h('img', {
    class: `avatar ${className}`.trim(),
    attrs: {
      src: sizedAvatarUrl(url, size),
      alt: '',
      width: size,
      height: size,
      decoding: 'async',
      referrerpolicy: 'no-referrer',
    },
  });
  img.addEventListener('error', () => img.replaceWith(fallback()), { once: true });
  return img;
}

// --------------------------------------------------------- live feedback

/** Screen-reader-only polite announcement (one shared live region). */
export function announce(message: string): void {
  let region = document.getElementById('bghub-announcer');
  if (!region) {
    region = h('div', { class: 'sr-only', attrs: { id: 'bghub-announcer', role: 'status', 'aria-live': 'polite' } });
    document.body.appendChild(region);
  }
  const target = region;
  target.textContent = '';
  // Next frame so identical consecutive messages are announced again.
  requestAnimationFrame(() => {
    target.textContent = message;
  });
}

/** Small "Saved ✓" status next to a control (role=status). */
export class SavedIndicator {
  readonly el: HTMLSpanElement;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  private clearTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.el = h('span', { class: 'saved', attrs: { role: 'status' } });
  }

  /** Success flashes briefly; errors stay until the next flash. */
  flash(message = t('commonSaved', 'Saved'), tone: 'success' | 'error' = 'success'): void {
    clearTimeout(this.hideTimer);
    clearTimeout(this.clearTimer);
    this.el.classList.remove('is-visible');
    this.el.classList.toggle('is-error', tone === 'error');
    this.el.replaceChildren(tone === 'success' ? checkDraw(14) : icon('alert', 14), h('span', { text: message }));
    void this.el.offsetWidth; // restart the enter transition
    this.el.classList.add('is-visible');
    if (tone === 'error') return;
    this.hideTimer = setTimeout(() => {
      this.el.classList.remove('is-visible');
      this.clearTimer = setTimeout(() => this.el.replaceChildren(), 200);
    }, 1800);
  }

  clear(): void {
    clearTimeout(this.hideTimer);
    clearTimeout(this.clearTimer);
    this.el.classList.remove('is-visible', 'is-error');
    this.el.replaceChildren();
  }
}

let toastRegion: HTMLElement | null = null;

/** Transient message at the bottom of the page (for feedback with no inline home). */
export function toast(message: string, tone: 'default' | 'success' | 'danger' = 'default', ms = 4000): void {
  if (!toastRegion || !toastRegion.isConnected) {
    toastRegion = h('div', { class: 'toast-region', attrs: { role: 'status', 'aria-live': 'polite' } });
    document.body.appendChild(toastRegion);
  }
  const glyph: IconName | null = tone === 'danger' ? 'alert' : tone === 'success' ? 'check-circle-fill' : null;
  const el = h('div', { class: 'toast', dataset: { tone } }, glyph ? icon(glyph, 16) : null, h('span', { text: message }));
  toastRegion.appendChild(el);
  setTimeout(() => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), prefersReducedMotion() ? 0 : 160);
  }, ms);
}

// ---------------------------------------------------------- transitions

/**
 * Replace a container's content with a short cross-fade (out 90ms, in 150ms).
 * Instant under prefers-reduced-motion or when the container is empty.
 */
export async function swapContent(container: HTMLElement, ...next: Node[]): Promise<void> {
  if (prefersReducedMotion() || !container.firstChild) {
    container.replaceChildren(...next);
    return;
  }
  container.classList.remove('is-fading-in');
  container.classList.add('is-fading-out');
  await wait(90);
  container.replaceChildren(...next);
  container.classList.remove('is-fading-out');
  void container.offsetWidth;
  container.classList.add('is-fading-in');
  setTimeout(() => container.classList.remove('is-fading-in'), 200);
}

/** Cap stagger indices so long lists don't take forever to appear. */
export function stagger(el: HTMLElement, index: number, max = 10): void {
  el.style.setProperty('--i', String(Math.min(index, max)));
}

// ------------------------------------------------------- inline confirm

export interface ConfirmOptions {
  /** Visible question shown before the buttons (optional in tight spaces). */
  question?: string;
  confirmLabel: string;
  cancelLabel?: string;
  busyLabel?: string;
  /** Return false to stay open (e.g. the action failed). */
  onConfirm: () => Promise<boolean | void> | boolean | void;
  small?: boolean;
}

/** Ignore confirm clicks this soon after opening (guards accidental double clicks). */
const CONFIRM_GUARD_MS = 350;

/**
 * Two-step confirmation in place of window.confirm(): clicking `trigger`
 * swaps it for [question] [Cancel] [Confirm]. Esc, Cancel or moving focus
 * away restores the trigger.
 */
export function attachInlineConfirm(trigger: HTMLButtonElement, opts: ConfirmOptions): void {
  trigger.addEventListener('click', () => {
    if (trigger.hidden) return;
    const size = opts.small === false ? '' : ' btn-sm';
    const cancel = h('button', { class: `btn${size}`, attrs: { type: 'button' } }, opts.cancelLabel ?? t('commonCancel', 'Cancel'));
    const confirm = h(
      'button',
      { class: `btn btn-danger-solid${size}`, attrs: { type: 'button' } },
      btnLabel(opts.confirmLabel)
    );
    const group = h(
      'span',
      { class: 'confirm-group', attrs: { role: 'group', 'aria-label': opts.question ?? opts.confirmLabel } },
      opts.question ? h('span', { class: 'confirm-question', text: opts.question }) : null,
      cancel,
      confirm
    );
    const openedAt = performance.now();
    let busy = false;

    const close = (focusTrigger: boolean): void => {
      if (!group.isConnected) return;
      group.remove();
      trigger.hidden = false;
      if (focusTrigger) trigger.focus();
    };

    cancel.addEventListener('click', () => close(true));
    group.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      }
    });
    group.addEventListener('focusout', (e) => {
      const next = e.relatedTarget as Node | null;
      if (busy || (next && group.contains(next))) return;
      // Let a click on Cancel/Confirm land first.
      setTimeout(() => {
        if (!busy && !group.contains(document.activeElement)) close(false);
      }, 0);
    });
    confirm.addEventListener('click', async () => {
      if (busy || performance.now() - openedAt < CONFIRM_GUARD_MS) return;
      busy = true;
      setButtonBusy(confirm, true, opts.busyLabel);
      cancel.disabled = true;
      let ok: boolean | void = false;
      try {
        ok = await opts.onConfirm();
      } finally {
        busy = false;
      }
      if (!group.isConnected) return; // the view was replaced (e.g. signed out)
      setButtonBusy(confirm, false);
      cancel.disabled = false;
      if (ok !== false) close(true);
      else confirm.focus();
    });

    trigger.hidden = true;
    trigger.after(group);
    confirm.focus();
  });
}
