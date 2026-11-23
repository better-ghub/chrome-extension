// Better GHub - PR page: shortcut action dispatcher.

import type { PRTab } from '../../../core/page';
import { debug } from '../../../debug';
import { t } from '../../../i18n';
import { getDefinition, type ShortcutAction } from '../../../shortcuts';
import { actionLabel, inScope } from '../labels';
import { copyCheckout } from './checkout';
import { toggleComments } from './comments';
import { copyBranch, copyMarkdownLink } from './copy';
import { toggleSplit, toggleWhitespace } from './diff-view';
import { toggleFiles } from './files';
import { openFinder } from './finder';
import { toggleGenerated } from './generated';
import { gotoTab } from './goto';
import { showChangesSinceVisit } from './visits';
import type { ActionContext } from './types';

export type { ActionContext, ReviewNavigator, ThreadNavigator } from './types';
export { createThreadNavigator } from './navigate-threads';
export { createReviewNavigator } from './review';

const GOTO_ACTION: Record<PRTab, ShortcutAction> = {
  conversation: 'gotoConversation',
  commits: 'gotoCommits',
  checks: 'gotoChecks',
  files: 'gotoFiles',
};

/** "Collapse files works on the Files changed tab" + a button that goes there. */
function explainScope(action: ShortcutAction, ctx: ActionContext): void {
  const def = getDefinition(action);
  const filesOnly = !def.scope.includes('conversation');
  const target: PRTab = filesOnly ? 'files' : 'conversation';
  const label = actionLabel(action);
  const message = filesOnly
    ? t('prPageWorksOnFiles', '“$1” works on the Files changed tab', label)
    : t('prPageWorksOnThreads', '“$1” works on the Conversation and Files changed tabs', label);
  ctx.toasts.show(message, {
    variant: 'warning',
    binding: ctx.binding,
    id: 'scope',
    action: { label: actionLabel(GOTO_ACTION[target]), run: () => gotoTab({ ...ctx, binding: null }, target) },
  });
}

export function runAction(action: ShortcutAction, ctx: ActionContext): void {
  if (!inScope(getDefinition(action).scope, ctx.page.prTab)) return explainScope(action, ctx);
  debug(`Better GHub: shortcut ${action}`);
  switch (action) {
    case 'toggleComments':
      return toggleComments(ctx);
    case 'toggleFiles':
      return toggleFiles(ctx);
    case 'toggleGenerated':
      return toggleGenerated(ctx);
    case 'toggleThreadsPanel':
      return ctx.toggleThreadsPanel();
    case 'loadAllTimeline':
      return ctx.loadAllTimeline?.();
    case 'toggleChecklist':
      if (!ctx.toggleChecklist?.()) {
        ctx.toasts.show(t('prChecklistNone', 'No review checklist for this repository. Add one in the extension options.'), { variant: 'info', binding: ctx.binding, id: 'checklist' });
      }
      return;
    case 'toggleWhitespace':
      return toggleWhitespace(ctx);
    case 'toggleSplitView':
      return toggleSplit(ctx);
    case 'findFile':
      return openFinder(ctx);
    case 'changesSinceVisit':
      return showChangesSinceVisit(ctx);
    case 'markViewedNext':
      return ctx.review.markViewedNext(ctx);
    case 'nextUnviewed':
      return ctx.review.nextUnviewed(ctx);
    case 'nextUnresolved':
      return ctx.threads.step(1, ctx);
    case 'prevUnresolved':
      return ctx.threads.step(-1, ctx);
    case 'gotoConversation':
      return gotoTab(ctx, 'conversation');
    case 'gotoCommits':
      return gotoTab(ctx, 'commits');
    case 'gotoChecks':
      return gotoTab(ctx, 'checks');
    case 'gotoFiles':
      return gotoTab(ctx, 'files');
    case 'copyBranch':
      return void copyBranch(ctx);
    case 'copyMarkdownLink':
      return void copyMarkdownLink(ctx);
    case 'copyCheckout':
      return void copyCheckout(ctx);
    case 'commentTemplates':
      // Handled by the comment-templates feature (it must also work inside text fields).
      return;
    case 'showHelp':
      return ctx.toggleHelp();
  }
}
