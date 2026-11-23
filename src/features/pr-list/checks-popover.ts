// Better GHub - Failed-jobs popover opened from the PR list's "Checks failing" chip.

import { h } from '../../core/dom';
import { icon } from '../../core/icons';
import { checksTabUrl, loadChecks, type ChecksSummary, type GraphqlSender } from '../../core/checks-model';
import { sendToBackground } from '../../core/messages';
import { t } from '../../i18n';
import { tPlural } from '../../ui/format';
import type { PopoverContext } from '../../ui/popover';

export const MAX_FAILED_SHOWN = 8;

export const sendGraphql: GraphqlSender = (query, variables, owner) =>
  sendToBackground('api:graphql', { query, variables, owner }, { ok: false, error: 'unavailable' });

function jobRow(job: ChecksSummary['failed'][number], fallbackUrl: string): HTMLElement {
  return h(
    'li',
    { class: 'bghub-checks-row' },
    icon('x-circle-fill', 14, 'bghub-checks-icon'),
    h(
      'a',
      { class: 'bghub-checks-link', attrs: { href: job.url ?? fallbackUrl } },
      job.workflow ? h('span', { class: 'bghub-checks-workflow', text: `${job.workflow} / ` }) : null,
      h('span', { text: job.name })
    )
  );
}

export function renderChecksBody(summary: ChecksSummary, prUrl: string): Node {
  const tab = checksTabUrl(prUrl);
  const shown = summary.failed.slice(0, MAX_FAILED_SHOWN);
  const rest = summary.failed.length - shown.length;
  return h(
    'div',
    null,
    summary.failed.length
      ? h(
          'div',
          null,
          h('div', { class: 'bghub-tooltip-title', text: tPlural('checksFailedCount', summary.failed.length, '$1 failed check', '$1 failed checks') }),
          h('ul', { class: 'bghub-checks-list' }, shown.map((j) => jobRow(j, tab))),
          rest > 0 ? h('div', { class: 'bghub-tooltip-muted', text: t('checksMore', '+$1 more', String(rest)) }) : null
        )
      : h('div', { text: t('checksNoneFailed', 'No failed checks found. They may have been re-run.') }),
    h('a', { class: 'bghub-checks-all', attrs: { href: tab } }, t('checksOpenTab', 'Open Checks tab'), icon('link-external', 12))
  );
}

/** Popover content: shows a loading line, then the failed jobs (fetched once per PR, cached). */
export function checksPopoverContent(prUrl: string, send: GraphqlSender = sendGraphql) {
  return (ctx: PopoverContext): Node => {
    const box = h('div', { class: 'bghub-checks-pop' }, h('div', { class: 'bghub-tooltip-muted', text: t('checksLoading', 'Loading checks…') }));
    void loadChecks(prUrl, send).then((summary) => {
      if (!box.isConnected) return;
      box.replaceChildren(
        summary
          ? renderChecksBody(summary, prUrl)
          : h(
              'div',
              null,
              h('div', { text: t('checksLoadFailed', 'Couldn’t load check details.') }),
              h('a', { class: 'bghub-checks-all', attrs: { href: checksTabUrl(prUrl) } }, t('checksOpenTab', 'Open Checks tab'), icon('link-external', 12))
            )
      );
      ctx.reposition();
    });
    return box;
  };
}
