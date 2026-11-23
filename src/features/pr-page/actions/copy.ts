// Better GHub - PR page: copy head branch / Markdown link.

import { copyText } from '../../../core/dom';
import { sendToBackground } from '../../../core/messages';
import { prUrl } from '../../../core/page';
import { debug } from '../../../debug';
import { t } from '../../../i18n';
import { findHeadRef, findTitle, headRefFromApi, markdownLink, type HeadRef } from '../pr-info';
import type { ActionContext } from './types';

async function headRefViaApi(ctx: ActionContext): Promise<HeadRef | null> {
  const { owner, repo, number } = ctx.page;
  if (!owner || !repo || !number) return null;
  debug('Better GHub: head ref not in DOM, asking the API');
  const res = await sendToBackground('api:rest', { path: `/repos/${owner}/${repo}/pulls/${number}` }, { ok: false });
  return res.ok ? headRefFromApi(res.data, owner) : null;
}

function copyFailed(ctx: ActionContext): void {
  ctx.toasts.show(t('prPageCopyFailed', "Couldn't copy to the clipboard"), { variant: 'warning', binding: ctx.binding });
}

export async function copyBranch(ctx: ActionContext): Promise<void> {
  const ref = findHeadRef(document, ctx.page.owner) ?? (await headRefViaApi(ctx));
  if (!ref) {
    ctx.toasts.show(t('prPageBranchNotFound', "Couldn't find the head branch"), { variant: 'warning', binding: ctx.binding });
    return;
  }
  if (!(await copyText(ref.branch))) return copyFailed(ctx);
  ctx.toasts.show(t('prPageCopiedBranch', 'Copied branch'), { icon: 'git-branch', code: ref.display, binding: ctx.binding, id: 'copy' });
}

export async function copyMarkdownLink(ctx: ActionContext): Promise<void> {
  const { number } = ctx.page;
  const url = prUrl(ctx.page);
  if (!number || !url) return;
  const title = findTitle(document, number) ?? `${ctx.page.owner}/${ctx.page.repo}#${number}`;
  if (!(await copyText(markdownLink(title, number, url)))) return copyFailed(ctx);
  ctx.toasts.show(t('prPageCopiedLink', 'Copied Markdown link to #$1', String(number)), { icon: 'link', binding: ctx.binding, id: 'copy' });
}
