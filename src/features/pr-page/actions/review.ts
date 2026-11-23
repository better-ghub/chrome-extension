// Better GHub - PR page: "mark viewed & next" (markViewedNext) and "next unviewed" (nextUnviewed).

import { t } from '../../../i18n';
import type { ShortcutBinding } from '../../../shortcuts';
import { basename, collectDiffFiles, isRendered, type DiffFile } from '../files-model';
import { pickCurrentIndex, pickNextUnviewed, progressCounts, type FileGeometry, type FileState } from '../progress-model';
import type { Toaster } from '../toast';
import { createHighlighter, focusWithoutScroll, jumpOffset, scrollToElement } from './scroll';
import type { ActionContext, ReviewNavigator } from './types';

/** Rapid presses act on the last target even while smooth scrolling is still moving the page. */
const TRUST_MS = 1500;
const HIGHLIGHT_MS = 1400;

function geometry(f: DiffFile): FileGeometry {
  if (!isRendered(f.el)) return { top: 0, bottom: 0, hidden: true };
  const r = f.el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom };
}

function states(files: readonly DiffFile[]): FileState[] {
  return files.map((f) => ({ viewed: f.viewed ? f.viewed.checked : null, hidden: !isRendered(f.el) }));
}

function viewportHeight(): number {
  return window.innerHeight > 0 ? window.innerHeight : 800;
}

/** The file-name link reads best for screen readers; the file itself otherwise. */
function focusTarget(file: DiffFile): HTMLElement {
  return file.header?.querySelector<HTMLElement>('a[href^="#diff-"], .file-info a[title]') ?? file.el;
}

/** "All 30 files viewed" ("1 file viewed" for a one-file PR). */
export function allViewedText(total: number): string {
  return total === 1 ? t('prPageAllViewedOne', '1 file viewed') : t('prPageAllViewed', 'All $1 files viewed', String(total));
}

let lastAllViewed = 0;
const ALL_VIEWED_DEDUPE_MS = 1500;

/**
 * "All 30 files viewed". The progress pill reports completion too (it sees the
 * checkbox change a frame after Alt+V), so `passive` calls skip a fresh toast.
 */
export function announceAllViewed(toasts: Toaster, total: number, binding: ShortcutBinding | null, passive = false): void {
  if (passive && Date.now() - lastAllViewed < ALL_VIEWED_DEDUPE_MS) return;
  lastAllViewed = Date.now();
  toasts.show(allViewedText(total), { icon: 'sparkle-fill', binding, id: 'review' });
}

function signInFirst(ctx: ActionContext): void {
  ctx.toasts.show(t('prPageViewedSignIn', 'Sign in to GitHub to mark files as viewed'), { variant: 'warning', icon: 'eye', binding: ctx.binding, id: 'review' });
}

export function createReviewNavigator(signal: AbortSignal): ReviewNavigator {
  let last: Element | null = null;
  let trustUntil = 0;
  const highlighter = createHighlighter('bghub-file-focus', HIGHLIGHT_MS, signal);

  /** Current file index and whether we are "on" it (vs. it merely being the first file on screen). */
  const current = (files: readonly DiffFile[]): { index: number; reached: boolean } => {
    if (last && Date.now() < trustUntil) {
      const i = files.findIndex((f) => f.el === last);
      if (i !== -1) return { index: i, reached: true };
    }
    const geo = files.map(geometry);
    const index = pickCurrentIndex(geo, viewportHeight(), jumpOffset());
    return { index, reached: index !== -1 && geo[index].top <= viewportHeight() / 3 };
  };

  const jump = (file: DiffFile): void => {
    if (file.toggle && !file.toggle.expanded) file.toggle.set(true);
    last = file.el;
    trustUntil = Date.now() + TRUST_MS;
    // Measure on the next frame: marking a file viewed collapses it first.
    requestAnimationFrame(() => {
      if (signal.aborted || !file.el.isConnected) return;
      scrollToElement(file.el);
      focusWithoutScroll(focusTarget(file));
      highlighter.light(file.header ?? file.el);
    });
  };

  /** Shared preamble: the files, or a toast explaining why there is nothing to do. */
  const prepare = (ctx: ActionContext): { files: DiffFile[]; list: FileState[] } | null => {
    const files = collectDiffFiles(document);
    if (!files.length) {
      ctx.toasts.show(t('prPageNoFiles', 'No file diffs found yet'), { variant: 'info', binding: ctx.binding, id: 'review' });
      return null;
    }
    const list = states(files);
    if (!list.some((s) => s.viewed !== null)) {
      signInFirst(ctx);
      return null;
    }
    return { files, list };
  };

  const goNext = (ctx: ActionContext, files: DiffFile[], list: FileState[], from: number, marked: DiffFile | null): void => {
    const { viewed, total } = progressCounts(list);
    const next = pickNextUnviewed(list, from);
    if (next === -1) return announceAllViewed(ctx.toasts, total, ctx.binding);
    jump(files[next]);
    const message = marked
      ? t('prPageMarkedViewed', 'Marked $1 as viewed · $2/$3', [basename(marked.path), String(viewed), String(total)])
      : t('prPageNextUnviewed', 'Next unviewed: $1 · $2 left', [basename(files[next].path), String(total - viewed)]);
    ctx.toasts.show(message, { icon: marked ? 'check-circle' : 'eye', variant: marked ? 'success' : 'info', binding: ctx.binding, id: 'review' });
  };

  return {
    markViewedNext(ctx) {
      const found = prepare(ctx);
      if (!found) return;
      const { files, list } = found;
      const { index } = current(files);
      const file = index === -1 ? null : files[index];
      let marked: DiffFile | null = null;
      if (file?.viewed && !file.viewed.checked) {
        file.viewed.set(true);
        list[index] = { ...list[index], viewed: true };
        marked = file;
      }
      goNext(ctx, files, list, index, marked);
    },
    nextUnviewed(ctx) {
      const found = prepare(ctx);
      if (!found) return;
      const { index, reached } = current(found.files);
      // A file still below the top third hasn't been read yet: it is "after" the scroll position.
      goNext(ctx, found.files, found.list, reached || index === -1 ? index : index - 1, null);
    },
  };
}
