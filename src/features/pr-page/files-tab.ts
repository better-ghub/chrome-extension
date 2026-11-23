// Better GHub - PR page: Files changed tab lifecycle inside the per-PR mount.
//
// The PR feature stays mounted across tab switches, so UI that only belongs
// to a diff view (generated-file collapsing, review progress) gets its own
// child AbortSignal: started when a diff view appears (/files, /changes,
// /files/<range>, /commits/<sha>), aborted when the reader leaves it or
// switches to another diff of the same PR.

import { observe } from '../../core/dom';
import { parsePage } from '../../core/page';
import { liveSettings } from '../../content/state';
import type { ShortcutAction, ShortcutBinding } from '../../shortcuts';
import { announceAllViewed } from './actions/review';
import { startAutoCollapse } from './generated';
import { bindingsFrom } from './keyboard';
import { mountProgress } from './progress';
import type { Toaster } from './toast';

/** Identity of the diff on screen, or null when the URL is not a diff view. */
export function diffKey(href: string): string | null {
  const page = parsePage(href);
  return page.kind === 'pr' && page.prTab === 'files' ? page.url.pathname + page.url.search : null;
}

export function watchFilesTab(signal: AbortSignal, start: (tabSignal: AbortSignal, key: string) => void): void {
  let child: AbortController | null = null;
  let key: string | null = null;
  const check = (): void => {
    if (signal.aborted) return;
    const next = diffKey(location.href);
    if (next === key) return;
    child?.abort();
    child = null;
    key = next;
    if (next === null) return;
    child = new AbortController();
    try {
      start(child.signal, next);
    } catch (err) {
      console.error('Better GHub: diff view setup failed', err);
    }
  };
  signal.addEventListener('abort', () => child?.abort(), { once: true });
  // Turbo / history events catch most tab switches; the observer is the catch-all.
  const soon = (): void => void requestAnimationFrame(check);
  for (const type of ['turbo:load', 'turbo:render']) document.addEventListener(type, soon, { signal });
  window.addEventListener('popstate', soon, { signal });
  observe(document.documentElement, check, signal);
  check();
}

interface FilesTabOptions {
  signal: AbortSignal;
  key: string;
  toasts: Toaster;
  /** Run a shortcut action from UI (no triggering binding). */
  run(action: ShortcutAction): void;
}

export function mountFilesTab({ signal, key, toasts, run }: FilesTabOptions): void {
  const settings = liveSettings();
  const binding = (action: ShortcutAction) => (): ShortcutBinding | null => bindingsFrom(liveSettings().shortcutBindings)[action];
  if (settings.autoCollapseGenerated) {
    startAutoCollapse({
      signal,
      toasts,
      pageKey: key,
      patterns: settings.generatedPatterns,
      binding: binding('toggleGenerated'),
      expandAll: () => run('toggleGenerated'),
    });
  }
  if (settings.reviewProgressEnabled) {
    mountProgress({
      signal,
      binding: binding('nextUnviewed'),
      onNext: () => run('nextUnviewed'),
      onComplete: (total) => announceAllViewed(toasts, total, null, true),
    });
  }
}
