// Better GHub - PR page: jump to the changes since the last visit (changesSinceVisit).

import { t } from '../../../i18n';
import type { ActionContext } from './types';

export function showChangesSinceVisit(ctx: ActionContext): void {
  if (ctx.showChangesSinceVisit) return ctx.showChangesSinceVisit();
  ctx.toasts.show(t('prPageNoChangesSince', 'No new changes since your last visit'), { variant: 'info', binding: ctx.binding, id: 'since' });
}
