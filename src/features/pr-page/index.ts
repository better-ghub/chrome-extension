// Better GHub - PR page feature: keyboard shortcuts, toasts, cheat sheet,
// floating hint, unresolved-threads panel, "mark as seen" for the inbox, and
// (on diff views) generated-file collapsing + review progress.
//
// Mounted once per PR, not per tab: switching Conversation ↔ Files keeps the
// listener, hint and toast host alive (no hint re-entrance, no toast loss).
// Everything tab-dependent reads the URL at the moment it runs; diff-only UI
// gets its own child lifecycle (files-tab.ts).

import { sendToBackground } from '../../core/messages';
import { parsePage, prUrl, type PageContext } from '../../core/page';
import type { Feature } from '../../core/router';
import { liveSettings } from '../../content/state';
import type { ShortcutAction } from '../../shortcuts';
import { createReviewNavigator, createThreadNavigator, runAction, type ActionContext } from './actions';
import { createCheatsheet } from './cheatsheet';
import { mountChecklist } from './checklist';
import { createFileFinder } from './file-finder';
import { mountFilesTab, watchFilesTab } from './files-tab';
import { mountHint, type Hint } from './hint';
import { createLoadAll, mountLoadAllButton } from './load-all';
import { mountPendingReview } from './pending-review';
import { bindingsFrom, installKeyboard } from './keyboard';
import { beginVisit } from './session';
import { createThreadsPanel } from './threads-panel';
import { attachToaster } from './toast';
import { startVisitTracking } from './visits';

function samePr(a: PageContext, b: PageContext): boolean {
  return a.owner === b.owner && a.repo === b.repo && a.number === b.number;
}

/** The page as it is now (tab may have changed since mount). */
function currentPage(mounted: PageContext): PageContext {
  const now = parsePage(location.href);
  return now.kind === 'pr' && samePr(now, mounted) ? now : mounted;
}

export const prPageFeature: Feature = {
  id: 'pr-page',
  matches: (page) => page.kind === 'pr',
  shouldRemount: (prev, next) => !samePr(prev, next),

  mount({ page, signal }) {
    const url = prUrl(page);
    if (!url) return;
    const firstVisit = beginVisit(url, signal);
    if (firstVisit) {
      void sendToBackground('inbox:markSeen', { urls: [url] }, { ok: false, unseenCount: 0 });
    }

    const settings = liveSettings();
    const toasts = attachToaster(signal);
    let hint: Hint | null = null;
    const sheet = createCheatsheet({ signal, toasts, onOpenChange: (open) => hint?.setExpanded(open) });
    const threads = createThreadNavigator(signal);
    const review = createReviewNavigator(signal);
    const finder = createFileFinder({ signal });
    const visits = startVisitTracking(page, signal, toasts);
    const panel = createThreadsPanel({ signal, reveal: (el) => threads.reveal(el, { focus: false }) });

    const loadAll = createLoadAll(signal);
    const checklist = mountChecklist(page, signal);

    const context = (binding: ActionContext['binding']): ActionContext => ({
      page: currentPage(page),
      binding,
      toasts,
      threads,
      review,
      toggleHelp: sheet.toggle,
      toggleThreadsPanel: panel.toggle,
      openFileFinder: finder.open,
      showChangesSinceVisit: () => visits.showChanges(binding),
      loadAllTimeline: () => void loadAll.run({ toasts, binding }),
      toggleChecklist: checklist.toggle,
    });
    const runFromUi = (action: ShortcutAction): void => runAction(action, context(null));

    installKeyboard({ signal, sheet, run: (action, binding) => runAction(action, context(binding)) });

    if (settings.shortcutsEnabled && settings.shortcutHintEnabled) {
      hint = mountHint({
        signal,
        binding: bindingsFrom(settings.shortcutBindings).showHelp,
        animate: firstVisit,
        onClick: sheet.toggle,
      });
    }

    mountPendingReview({ page, signal, toasts, fresh: firstVisit });
    mountLoadAllButton(signal, loadAll, toasts);

    watchFilesTab(signal, (tabSignal, key) => mountFilesTab({ signal: tabSignal, key, toasts, run: runFromUi }));
  },
};
