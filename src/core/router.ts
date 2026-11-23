// Better GHub - SPA router for content-script features.
//
// GitHub navigates with Turbo + React (pushState) — a full page load happens
// rarely. Content scripts are injected once per real page load, so every
// feature must (re)mount itself on soft navigations. The router detects URL
// changes and gives each feature a fresh AbortSignal per page; features clean
// up everything (listeners, observers, injected nodes) when it aborts.
//
// Note: content scripts run in an isolated JS world, so monkey-patching
// history.pushState here would NOT see GitHub's own calls. We rely on DOM
// events (turbo:*, popstate), the Navigation API when present, and a cheap
// <title>/body observer as the catch-all.

import { parsePage, type PageContext } from './page';
import { debug } from '../debug';

export interface FeatureContext {
  page: PageContext;
  /** Aborts when the user navigates away or the feature is disabled. */
  signal: AbortSignal;
}

export interface Feature {
  id: string;
  /** Cheap, synchronous URL check. */
  matches(page: PageContext): boolean;
  /** Whether the feature is enabled in settings (re-evaluated on every route + settings change). */
  enabled?(): boolean;
  mount(ctx: FeatureContext): void | Promise<void>;
  /**
   * Remount policy on navigation between two matching URLs. Default: remount
   * when the pathname changes. Return false to keep the current mount.
   */
  shouldRemount?(prev: PageContext, next: PageContext): boolean;
}

interface Mounted {
  feature: Feature;
  page: PageContext;
  controller: AbortController;
}

const mounted = new Map<string, Mounted>();
let features: Feature[] = [];
let lastHref = '';
let started = false;

function unmount(id: string): void {
  const m = mounted.get(id);
  if (!m) return;
  m.controller.abort();
  mounted.delete(id);
  debug(`Better GHub: unmounted ${id}`);
}

function mount(feature: Feature, page: PageContext): void {
  const controller = new AbortController();
  mounted.set(feature.id, { feature, page, controller });
  debug(`Better GHub: mounting ${feature.id} on ${page.kind}`);
  try {
    const result = feature.mount({ page, signal: controller.signal });
    if (result instanceof Promise) {
      result.catch((err) => console.error(`Better GHub: feature ${feature.id} failed`, err));
    }
  } catch (err) {
    console.error(`Better GHub: feature ${feature.id} failed`, err);
  }
}

/** Re-evaluate every feature against the current URL. Safe to call often. */
export function reconcile(force = false): void {
  const href = location.href;
  if (!force && href === lastHref) return;
  lastHref = href;
  const page = parsePage(href);

  for (const feature of features) {
    const wanted = feature.matches(page) && (feature.enabled?.() ?? true);
    const current = mounted.get(feature.id);
    if (!wanted) {
      if (current) unmount(feature.id);
      continue;
    }
    if (current) {
      const remount = force
        ? true
        : feature.shouldRemount
          ? feature.shouldRemount(current.page, page)
          : current.page.url.pathname !== page.url.pathname;
      if (!remount) {
        current.page = page;
        continue;
      }
      unmount(feature.id);
    }
    mount(feature, page);
  }
}

/** Remount everything (e.g. after a settings or auth change). */
export function remountAll(): void {
  reconcile(true);
}

export function startRouter(list: Feature[]): void {
  features = list;
  if (started) {
    remountAll();
    return;
  }
  started = true;

  const check = (): void => {
    // Let Turbo/React finish swapping content before features look at the DOM.
    requestAnimationFrame(() => reconcile());
  };

  for (const ev of ['turbo:load', 'turbo:render', 'pjax:end', 'popstate', 'pageshow']) {
    (ev === 'popstate' || ev === 'pageshow' ? window : document).addEventListener(ev, check);
  }

  const nav = (window as unknown as { navigation?: EventTarget }).navigation;
  nav?.addEventListener?.('navigatesuccess', check);

  // Catch-all: React route changes always touch the DOM; compare href cheaply.
  const mo = new MutationObserver(() => {
    if (location.href !== lastHref) check();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  reconcile(true);
}
