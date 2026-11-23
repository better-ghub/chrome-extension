// Better GHub - PR page: collapse / expand all generated files (toggleGenerated).
// Works whether or not auto-collapse is on; same convergent rule as toggleFiles.

import { liveSettings } from '../../../content/state';
import { t } from '../../../i18n';
import { collectDiffFiles } from '../files-model';
import { matchesGenerated } from '../../../core/generated-patterns';
import { applyTarget, nonNull, targetExpanded, type Toggle } from '../toggle-state';
import { withScrollAnchor } from './scroll';
import type { ActionContext } from './types';

/** Toggles of every file whose path matches `patterns`, in document order. */
export function collectGeneratedToggles(root: ParentNode, patterns: readonly string[]): Toggle[] {
  return collectDiffFiles(root)
    .filter((f) => matchesGenerated(f.path, patterns))
    .map((f) => f.toggle)
    .filter(nonNull);
}

export function toggleGenerated(ctx: ActionContext, patterns: readonly string[] = liveSettings().generatedPatterns): void {
  const items = collectGeneratedToggles(document, patterns);
  if (!items.length) {
    ctx.toasts.show(t('prPageNoGenerated', 'No generated files in this diff'), { variant: 'info', binding: ctx.binding, id: 'generated' });
    return;
  }
  const expand = targetExpanded(items);
  const changed = withScrollAnchor(
    items.map((i) => i.el),
    () => applyTarget(items, expand)
  );
  const count = String(changed);
  ctx.toasts.show(
    expand
      ? t('prPageGeneratedExpanded', 'Generated files expanded ($1)', count)
      : t('prPageGeneratedCollapsed', 'Generated files collapsed ($1)', count),
    { icon: expand ? 'unfold' : 'fold', binding: ctx.binding, id: 'generated' }
  );
}
