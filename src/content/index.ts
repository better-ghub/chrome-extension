// Better GHub - Content script entry (runs on every github.com page).
//
// One script for the whole site + a SPA router, instead of one script per URL
// pattern: GitHub navigates client-side, so per-URL content scripts were never
// injected after soft navigations (e.g. PR list → PR page).

import '../styles/content.css';
import { reloadI18n, initI18n } from '../i18n';
import { remountAll, startRouter } from '../core/router';
import { extensionAlive, type TabBroadcast } from '../core/messages';
import { initLiveSettings, subscribeSettings } from './state';
import { prPageFeature } from '../features/pr-page';
import { prListFeature } from '../features/pr-list';
import { dashboardFeature } from '../features/dashboard';
import { commentTemplatesFeature } from '../features/comment-templates';

declare global {
  interface Window {
    __bghubLoaded?: boolean;
  }
}

async function boot(): Promise<void> {
  // Guard against double injection (e.g. extension reload + manual re-inject).
  if (window.__bghubLoaded) return;
  window.__bghubLoaded = true;

  await Promise.all([initLiveSettings(), initI18n()]);

  startRouter([prPageFeature, prListFeature, dashboardFeature, commentTemplatesFeature]);

  subscribeSettings((_s, changed) => {
    if (changed.includes('language')) {
      void reloadI18n().then(remountAll);
    } else {
      remountAll();
    }
  });

  chrome.runtime.onMessage.addListener((msg: TabBroadcast) => {
    if (msg?.type === 'auth:changed' || msg?.type === 'cache:cleared') remountAll();
    return false;
  });
}

if (extensionAlive()) {
  void boot().catch((err) => console.error('Better GHub: failed to start', err));
}
