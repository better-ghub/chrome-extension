// Better GHub - PR page: collapse / expand all review threads (toggleComments).

import { t } from '../../../i18n';
import { applyTarget, targetExpanded } from '../toggle-state';
import { collectCommentToggles } from '../toggles';
import { withScrollAnchor } from './scroll';
import type { ActionContext } from './types';

export function toggleComments(ctx: ActionContext): void {
  const tab = ctx.page.prTab;
  const items = collectCommentToggles(document, tab);
  if (!items.length) {
    ctx.toasts.show(t('prPageNoThreads', 'No review threads on this page'), { variant: 'info', binding: ctx.binding });
    return;
  }
  const expand = targetExpanded(items);
  const changed = withScrollAnchor(
    items.map((i) => i.el),
    () => applyTarget(items, expand)
  );
  const count = String(changed);
  let message: string;
  if (tab === 'files') {
    message = expand
      ? t('prPageCommentsShown', 'Inline comments shown ($1)', count)
      : t('prPageCommentsHidden', 'Inline comments hidden ($1)', count);
  } else {
    message = expand
      ? t('prPageThreadsExpanded', 'Review threads expanded ($1)', count)
      : t('prPageThreadsCollapsed', 'Review threads collapsed ($1)', count);
  }
  ctx.toasts.show(message, { icon: expand ? 'unfold' : 'fold', binding: ctx.binding, id: 'toggle-comments' });
}
