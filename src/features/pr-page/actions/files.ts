// Better GHub - PR page: collapse / expand all file diffs (toggleFiles).

import { t } from '../../../i18n';
import { applyTarget, targetExpanded } from '../toggle-state';
import { collectFileToggles } from '../toggles';
import { withScrollAnchor } from './scroll';
import type { ActionContext } from './types';

export function toggleFiles(ctx: ActionContext): void {
  const items = collectFileToggles(document);
  if (!items.length) {
    ctx.toasts.show(t('prPageNoFiles', 'No file diffs found yet'), { variant: 'info', binding: ctx.binding });
    return;
  }
  const expand = targetExpanded(items);
  // Keep the file the reader is looking at in place while everything collapses around it.
  const changed = withScrollAnchor(
    items.map((i) => i.el),
    () => applyTarget(items, expand)
  );
  const count = String(changed);
  ctx.toasts.show(
    expand ? t('prPageFilesExpanded', 'Files expanded ($1)', count) : t('prPageFilesCollapsed', 'Files collapsed ($1)', count),
    { icon: expand ? 'unfold' : 'fold', binding: ctx.binding, id: 'toggle-files' }
  );
}
