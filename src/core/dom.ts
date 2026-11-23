// Better GHub - Tiny DOM toolkit (no framework).

type Child = Node | string | number | null | undefined | false;

export interface HProps {
  class?: string;
  /** Plain attributes (aria-*, role, href, type, ...). `false`/null/undefined skip the attribute. */
  attrs?: Record<string, string | number | boolean | null | undefined>;
  dataset?: Record<string, string>;
  style?: Partial<Record<string, string>>;
  text?: string;
  /** Trusted static markup only (icons). Never pass user/API data here. */
  html?: string;
  on?: { [K in keyof HTMLElementEventMap]?: (ev: HTMLElementEventMap[K]) => void };
}

/**
 * Hyperscript-style element factory.
 *   h('button', { class: 'bghub-btn', attrs: { type: 'button' }, on: { click } }, 'Save')
 * Strings become text nodes, so API data passed as children is always escaped.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: HProps | null = null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    if (props.class) el.className = props.class;
    if (props.attrs) {
      for (const [k, v] of Object.entries(props.attrs)) {
        if (v === false || v === null || v === undefined) continue;
        el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    if (props.dataset) Object.assign(el.dataset, props.dataset);
    if (props.style) {
      for (const [k, v] of Object.entries(props.style)) {
        if (v === undefined) continue;
        if (k.startsWith('--')) el.style.setProperty(k, v);
        else (el.style as unknown as Record<string, string>)[k] = v;
      }
    }
    if (props.html !== undefined) el.innerHTML = props.html;
    if (props.text !== undefined) el.textContent = props.text;
    if (props.on) {
      for (const [type, handler] of Object.entries(props.on)) {
        if (handler) el.addEventListener(type, handler as EventListener);
      }
    }
  }
  appendChildren(el, children);
  return el;
}

export function appendChildren(parent: Node, children: (Child | Child[])[]): void {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    parent.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): ((...args: A) => void) & { cancel(): void } {
  let t: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: A): void => {
    if (t !== undefined) clearTimeout(t);
    t = setTimeout(() => {
      t = undefined;
      fn(...args);
    }, ms);
  };
  wrapped.cancel = (): void => {
    if (t !== undefined) clearTimeout(t);
    t = undefined;
  };
  return wrapped;
}

/**
 * Debounced MutationObserver that disconnects when `signal` aborts.
 * Use it to re-apply idempotent enhancements after React/Turbo re-renders.
 */
export function observe(
  target: Node,
  callback: () => void,
  signal: AbortSignal,
  options: MutationObserverInit = { childList: true, subtree: true },
  delay = 120
): void {
  if (signal.aborted) return;
  const run = debounce(() => {
    if (!signal.aborted) callback();
  }, delay);
  const mo = new MutationObserver((records) => {
    if (records.some(isPageMutation)) run();
  });
  mo.observe(target, options);
  signal.addEventListener('abort', () => {
    mo.disconnect();
    run.cancel();
  });
}

/**
 * Whether a mutation record comes from the page rather than from our own UI.
 * Anything happening inside our nodes (text updates of a toast or progress
 * pill, re-rendered chips) is ours; so is inserting/removing our own nodes
 * into GitHub's elements. Re-scanning on those would only waste work (and could
 * loop when a scan re-renders our UI).
 */
export function isPageMutation(r: MutationRecord): boolean {
  if (isOwnNode(r.target)) return false;
  if (r.type !== 'childList') return true;
  const nodes = [...r.addedNodes, ...r.removedNodes];
  return nodes.length === 0 || nodes.some((n) => !isOwnNode(n));
}

/** Our injected nodes carry a `bghub-` class or a data-bghub attribute. */
export function isOwnNode(n: Node): boolean {
  if (!(n instanceof Element)) return n.parentElement ? isOwnNode(n.parentElement) : false;
  return !!n.closest('[data-bghub], [class^="bghub-"], [class*=" bghub-"]');
}

/** Resolve with the first element matching `selector` (or null on timeout/abort). */
export function waitFor<T extends Element = Element>(
  selector: string,
  opts: { root?: ParentNode; timeout?: number; signal?: AbortSignal } = {}
): Promise<T | null> {
  const root = opts.root ?? document;
  const found = root.querySelector<T>(selector);
  if (found) return Promise.resolve(found);
  return new Promise((resolve) => {
    let done = false;
    const finish = (el: T | null): void => {
      if (done) return;
      done = true;
      mo.disconnect();
      clearTimeout(timer);
      resolve(el);
    };
    const mo = new MutationObserver(() => {
      const el = root.querySelector<T>(selector);
      if (el) finish(el);
    });
    mo.observe(root instanceof Document ? root.documentElement : (root as Node), { childList: true, subtree: true });
    const timer = setTimeout(() => finish(null), opts.timeout ?? 10000);
    opts.signal?.addEventListener('abort', () => finish(null));
  });
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Remove an element after its exit animation (class `bghub-leaving`), or immediately with reduced motion. */
export function removeAnimated(el: Element, fallbackMs = 220): void {
  if (!el.isConnected) return;
  if (prefersReducedMotion()) {
    el.remove();
    return;
  }
  el.classList.add('bghub-leaving');
  let removed = false;
  const done = (): void => {
    if (removed) return;
    removed = true;
    el.remove();
  };
  el.addEventListener('animationend', done, { once: true });
  setTimeout(done, fallbackMs + 80);
}

/** Copy text to the clipboard from a content script (user-gesture context). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for pages/browsers where the async clipboard API is blocked.
    const ta = h('textarea', { attrs: { 'aria-hidden': 'true' }, style: { position: 'fixed', top: '-1000px', opacity: '0' } });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}
