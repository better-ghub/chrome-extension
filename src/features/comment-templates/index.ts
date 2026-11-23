// Better GHub - Comment templates feature.
//
// One window-level keydown listener (capture phase, like the PR keyboard
// layer). Unlike every other shortcut it deliberately fires while the user is
// typing, but only inside a GitHub markdown comment textarea. It lives in its
// own feature (not pr-page) so it also works on issues and discussions.

import { bindingsFrom } from '../pr-page/keyboard';
import { liveSettings } from '../../content/state';
import type { Feature } from '../../core/router';
import { matchesBinding } from '../../shortcuts';
import { isCommentTextarea } from './model';
import { createTemplatePicker } from './picker';

function eventTarget(e: KeyboardEvent): unknown {
  return (typeof e.composedPath === 'function' ? e.composedPath()[0] : null) ?? e.target;
}

export const commentTemplatesFeature: Feature = {
  id: 'comment-templates',
  matches: (page) => page.url.hostname === 'github.com' && page.kind !== 'dashboard',
  enabled: () => liveSettings().commentTemplatesEnabled && liveSettings().shortcutsEnabled,
  // The listener reads live settings and the DOM; navigation needs no remount.
  shouldRemount: () => false,

  mount({ signal }) {
    const picker = createTemplatePicker({ signal });
    window.addEventListener(
      'keydown',
      (e) => {
        const settings = liveSettings();
        if (!settings.commentTemplatesEnabled || !settings.shortcutsEnabled) return;
        if (e.repeat || e.isComposing) return;
        if (!matchesBinding(e, bindingsFrom(settings.shortcutBindings).commentTemplates)) return;
        const target = eventTarget(e);
        if (!isCommentTextarea(target)) return;
        // Stops macOS Option from typing a character and GitHub's hotkeys from seeing it.
        e.preventDefault();
        e.stopPropagation();
        if (picker.isOpen()) return;
        picker.open(target, { snippets: settings.commentSnippets, conventional: settings.conventionalCommentsEnabled });
      },
      { capture: true, signal }
    );
  },
};
