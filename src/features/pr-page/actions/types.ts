// Better GHub - PR page: context passed to every shortcut action.

import type { PageContext } from '../../../core/page';
import type { ShortcutBinding } from '../../../shortcuts';
import type { Toaster } from '../toast';

/** Per-mount state for next/previous unresolved thread. */
export interface ThreadNavigator {
  step(dir: 1 | -1, ctx: ActionContext): void;
  /** Expand, scroll to and highlight one thread. `focus: false` leaves focus where it is. */
  reveal(thread: Element, opts?: { focus?: boolean }): void;
}

/** Per-mount state for "mark viewed & next" / "next unviewed" (rapid presses step from the last target). */
export interface ReviewNavigator {
  markViewedNext(ctx: ActionContext): void;
  nextUnviewed(ctx: ActionContext): void;
}

export interface ActionContext {
  /** Fresh page info (the mount survives PR tab switches, so never cache the tab). */
  page: PageContext;
  /** Binding that triggered the action (shown as key caps in toasts); null when run from UI. */
  binding: ShortcutBinding | null;
  toasts: Toaster;
  threads: ThreadNavigator;
  review: ReviewNavigator;
  toggleHelp(): void;
  toggleThreadsPanel(): void;
  /** Opens the file finder; false when there are no files to list. */
  openFileFinder?(): boolean;
  /** Clicks GitHub's "Load more" until the whole conversation is loaded. */
  loadAllTimeline?(): void;
  /** Expands/collapses the review checklist; false when none applies to this PR. */
  toggleChecklist?(): boolean;
  /** Navigates to the diff of the commits pushed since the last visit (toast when there are none). */
  showChangesSinceVisit?(): void;
}
