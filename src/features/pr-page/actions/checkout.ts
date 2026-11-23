// Better GHub - PR page: copy a command that checks the PR out locally (copyCheckout).

import { copyText } from '../../../core/dom';
import { checkoutCommand } from '../../../core/generated-patterns';
import type { Settings } from '../../../core/settings';
import { liveSettings } from '../../../content/state';
import { t } from '../../../i18n';
import type { ActionContext } from './types';

export { checkoutCommand };

export async function copyCheckout(ctx: ActionContext, kind: Settings['checkoutCommand'] = liveSettings().checkoutCommand): Promise<void> {
  const { number } = ctx.page;
  if (!number) return;
  const command = checkoutCommand(number, kind);
  if (!(await copyText(command))) {
    ctx.toasts.show(t('prPageCopyFailed', "Couldn't copy to the clipboard"), { variant: 'warning', binding: ctx.binding });
    return;
  }
  ctx.toasts.show(t('prPageCopiedCheckout', 'Copied checkout command'), { icon: 'terminal', code: command, binding: ctx.binding, id: 'copy' });
}
