// Better GHub - PR page: translated labels and key-cap rendering.

import { t } from '../../i18n';
import { h } from '../../core/dom';
import type { PRTab } from '../../core/page';
import {
  bindingKeys,
  getDefinition,
  isMacPlatform,
  type ShortcutAction,
  type ShortcutBinding,
  type ShortcutDefinition,
  type ShortcutScope,
} from '../../shortcuts';

export function actionLabel(action: ShortcutAction): string {
  const def = getDefinition(action);
  return t(def.labelKey, def.label);
}

export const GROUP_LABELS: Record<ShortcutDefinition['group'], () => string> = {
  view: () => t('prPageGroupView', 'View'),
  navigate: () => t('prPageGroupNavigate', 'Navigate'),
  copy: () => t('prPageGroupCopy', 'Copy'),
  compose: () => t('prPageGroupCompose', 'Write'),
  help: () => t('prPageGroupHelp', 'Help'),
};

/** GitHub's own tab names (GitHub's UI is English-only, so they stay as shown on the page). */
export function tabName(tab: PRTab): string {
  switch (tab) {
    case 'conversation':
      return t('prPageTabConversation', 'Conversation');
    case 'commits':
      return t('prPageTabCommits', 'Commits');
    case 'checks':
      return t('prPageTabChecks', 'Checks');
    case 'files':
      return t('prPageTabFiles', 'Files changed');
  }
}

export function inScope(scope: readonly ShortcutScope[], tab: PRTab | undefined): boolean {
  if (scope.includes('pr')) return true;
  return !!tab && (scope as readonly string[]).includes(tab);
}

/** Short "where does this work" hint for actions limited to some tabs. */
export function scopeHint(scope: readonly ShortcutScope[]): string {
  const conv = scope.includes('conversation');
  const files = scope.includes('files');
  if (conv && files) return t('prPageScopeThreads', 'Conversation & Files changed');
  if (files) return t('prPageScopeFiles', 'Files changed tab');
  return t('prPageScopeConversation', 'Conversation tab');
}

const SPOKEN_MAC: Record<string, string> = { '⌃': 'Control', '⌥': 'Option', '⇧': 'Shift', '⌘': 'Command' };

/** Screen-reader friendly binding, e.g. "Option Shift F". */
export function spokenBinding(b: ShortcutBinding, mac = isMacPlatform()): string {
  return bindingKeys(b, mac)
    .map((k) => SPOKEN_MAC[k] ?? k)
    .join(' ');
}

/** `<kbd>` caps for a binding, with a visually hidden spoken version for assistive tech. */
export function keycaps(b: ShortcutBinding, extraClass = ''): HTMLElement {
  return h(
    'span',
    { class: `bghub-kbd-group${extraClass ? ` ${extraClass}` : ''}` },
    h('span', { class: 'bghub-sr-only', text: spokenBinding(b) }),
    bindingKeys(b).map((k) =>
      // macOS modifier glyphs render tiny in monospace fonts; give them the UI font.
      h('kbd', { class: k in SPOKEN_MAC ? 'bghub-kbd bghub-kbd--glyph' : 'bghub-kbd', attrs: { 'aria-hidden': 'true' }, text: k })
    )
  );
}
