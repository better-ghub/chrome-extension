// Better GHub - Dashboard widget ("Your pull requests" on github.com home).

import type { Feature } from '../../core/router';
import { observe } from '../../core/dom';
import { sendToBackground } from '../../core/messages';
import { liveSettings } from '../../content/state';
import { findAnchor, resolveAnchor } from './anchor';
import { DashboardCard } from './card';

function loggedIn(): boolean {
  // Logged out, "/" is the marketing page: nothing to enhance.
  return !!document.querySelector<HTMLMetaElement>('meta[name="user-login"]')?.content;
}

export const dashboardFeature: Feature = {
  id: 'dashboard',
  matches: (page) => page.kind === 'dashboard',
  enabled: () => liveSettings().dashboardEnabled,
  async mount({ signal }) {
    if (!loggedIn()) return;
    const auth = await sendToBackground('auth:status', {}, { authenticated: false });
    if (!auth.authenticated || signal.aborted) return;

    const anchor = await findAnchor(signal);
    if (!anchor || signal.aborted) return;

    const card = new DashboardCard(signal);
    anchor.insert(card.el);
    void card.load(false);

    // The dashboard feed re-renders client-side; put the card back if it was
    // dropped (one re-insert per mutation burst, no polling).
    let reinserts = 0;
    observe(document.querySelector('main') ?? document.body, () => {
      if (card.closed || card.el.isConnected || reinserts >= 5) return;
      const again = resolveAnchor();
      if (!again) return;
      reinserts++;
      again.insert(card.el);
    }, signal);
  },
};
