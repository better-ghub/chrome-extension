// Better GHub - PR page: hide-whitespace and split/unified toggles (URL based).

import { t } from '../../../i18n';
import { currentMode, otherMode, toggleWhitespaceHref, whitespaceHidden, withMode } from '../diff-params-model';
import type { ActionContext } from './types';

/** Full navigation to the modified URL (the diff params are server-side). */
function navigate(href: string): void {
  location.assign(href);
}

export function toggleWhitespace(ctx: ActionContext, go: (href: string) => void = navigate): void {
  const hidden = whitespaceHidden(location.href);
  ctx.toasts.show(
    hidden ? t('prPageWhitespaceShown', 'Showing whitespace changes') : t('prPageWhitespaceHidden', 'Hiding whitespace changes'),
    { icon: 'diff', binding: ctx.binding, id: 'diff-view' }
  );
  go(toggleWhitespaceHref(location.href));
}

export function toggleSplit(ctx: ActionContext, go: (href: string) => void = navigate): void {
  const next = otherMode(currentMode(location.href));
  ctx.toasts.show(
    next === 'split' ? t('prPageSplitView', 'Switching to split view') : t('prPageUnifiedView', 'Switching to unified view'),
    { icon: 'diff', binding: ctx.binding, id: 'diff-view' }
  );
  go(withMode(location.href, next));
}
