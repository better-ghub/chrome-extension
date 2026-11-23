// Better GHub - Notify open github.com tabs (and extension pages) of changes.

import type { TabBroadcast } from '../core/messages';

export async function broadcast(msg: TabBroadcast): Promise<void> {
  try {
    // Host permissions for github.com make tabs.query({url}) work without the
    // broad "tabs" permission.
    const tabs = await chrome.tabs.query({ url: 'https://github.com/*' });
    await Promise.all(
      tabs.map((tab) => (tab.id === undefined ? undefined : chrome.tabs.sendMessage(tab.id, msg).catch(() => undefined)))
    );
  } catch {
    /* no tabs / API unavailable */
  }
  // Popup / options pages (rejects when none is open).
  try {
    await chrome.runtime.sendMessage(msg);
  } catch {
    /* nobody listening */
  }
}
