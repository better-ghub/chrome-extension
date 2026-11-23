// Better GHub - Pull request list feature: activity chips under every row,
// a summary bar above the list, and a one-time notice when no token is set.

import type { Feature } from '../../core/router';
import { observe, waitFor } from '../../core/dom';
import { sendToBackground } from '../../core/messages';
import { liveSettings } from '../../content/state';
import { NOTICE_DISMISSED_KEY, PRListController } from './controller';
import { LIST_SELECTOR, viewerLogin } from './list-dom';

async function noticeDismissed(): Promise<boolean> {
  try {
    const items = await chrome.storage.local.get(NOTICE_DISMISSED_KEY);
    return items[NOTICE_DISMISSED_KEY] === true;
  } catch {
    return false;
  }
}

export const prListFeature: Feature = {
  id: 'pr-list',
  matches: (page) => page.kind === 'pr-list',
  enabled: () => liveSettings().prListEnabled,
  async mount({ page, signal }) {
    const [auth, dismissed] = await Promise.all([
      sendToBackground('auth:status', {}, { authenticated: false }),
      noticeDismissed(),
    ]);
    if (signal.aborted || (!auth.authenticated && dismissed)) return;

    // GitHub renders the list client-side; give it time on slow connections.
    const list = await waitFor(LIST_SELECTOR, { signal, timeout: 15_000 });
    if (!list || signal.aborted || !page.owner || !page.repo) return;

    const controller = new PRListController({
      signal,
      owner: page.owner,
      repo: page.repo,
      authenticated: auth.authenticated,
      noticeDismissed: dismissed,
      viewer: viewerLogin() || auth.account?.login || '',
      withLabels: liveSettings().suggestedLabelsEnabled,
      staleDays: liveSettings().staleDays,
    });
    controller.scan();
    // Filters, pagination and React re-renders replace rows (and sometimes the
    // whole list) without a route change: re-apply on DOM changes. `main`
    // survives those swaps; the list element itself may not.
    observe(document.querySelector('main') ?? document.body, () => controller.scan(), signal);
  },
};
