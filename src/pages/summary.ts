// Better GHub - Daily stand-up summary of the inbox as Markdown (pure formatter).

import type { InboxItem } from '../core/messages';
import { t } from '../i18n';
import { isSnoozed, sortItems } from './inbox';

export type SummaryStatus = 'ready' | 'checks-failing' | 'changes-requested' | 'approved-waiting' | 'approved' | 'waiting' | 'draft';

export function summaryStatus(item: InboxItem): SummaryStatus {
  if (item.isDraft) return 'draft';
  if (item.ready) return 'ready';
  if (item.checks === 'FAILURE' || item.checks === 'ERROR') return 'checks-failing';
  if (item.reviewDecision === 'CHANGES_REQUESTED') return 'changes-requested';
  if (item.reviewDecision === 'APPROVED') return item.checks === 'PENDING' || item.checks === 'EXPECTED' ? 'approved-waiting' : 'approved';
  return 'waiting';
}

function statusText(status: SummaryStatus): string {
  switch (status) {
    case 'ready':
      return t('summaryReady', 'ready to merge');
    case 'checks-failing':
      return t('summaryChecksFailing', 'checks failing');
    case 'changes-requested':
      return t('summaryChangesRequested', 'changes requested');
    case 'approved-waiting':
      return t('summaryApprovedWaiting', 'approved (waiting on checks)');
    case 'approved':
      return t('summaryApproved', 'approved');
    case 'draft':
      return t('summaryDraft', 'draft');
    default:
      return t('summaryWaiting', 'waiting for review');
  }
}

/** Single-line, Markdown-safe title. */
function cleanTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim().replace(/([\\[\]])/g, '\\$1');
}

export function summaryLine(item: InboxItem): string {
  return `- [${item.repo}#${item.number}](${item.url}) ${cleanTitle(item.title)} — ${statusText(summaryStatus(item))}`;
}

/**
 * Markdown summary: "My pull requests" (authored) and "Reviewing" (review
 * requested / re-review). Snoozed items are left out, pinned ones come first.
 * Returns '' when there is nothing to report.
 */
export function buildSummary(items: readonly InboxItem[], now = Date.now()): string {
  const active = sortItems(items.filter((i) => !isSnoozed(i, now)));
  const mine = active.filter((i) => i.reasons.includes('authored'));
  const reviewing = active.filter((i) => i.reasons.some((r) => r === 'review-requested' || r === 'rereview'));
  const sections: string[] = [];
  if (mine.length) sections.push([`### ${t('summaryMine', 'My pull requests')}`, ...mine.map(summaryLine)].join('\n'));
  if (reviewing.length) sections.push([`### ${t('summaryReviewing', 'Reviewing')}`, ...reviewing.map(summaryLine)].join('\n'));
  return sections.join('\n\n');
}

/** Copy text to the clipboard; resolves false when the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
