// Better GHub - PR page: open the file finder (findFile).

import { t } from '../../../i18n';
import type { ActionContext } from './types';

export function openFinder(ctx: ActionContext): void {
  if (ctx.openFileFinder?.()) return;
  ctx.toasts.show(t('prPageFinderNoFiles', 'No changed files found on this page'), { variant: 'info', binding: ctx.binding, id: 'finder' });
}
