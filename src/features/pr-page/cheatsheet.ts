// Better GHub - PR page: keyboard shortcut cheat sheet.
//
// A native <dialog> opened with showModal(): it lives in the top layer, the
// browser traps focus and restores it on close, and Esc closes it. Content is
// re-rendered on every open so it always reflects the current bindings and tab.

import { h } from '../../core/dom';
import { icon } from '../../core/icons';
import { sendToBackground } from '../../core/messages';
import { parsePage, type PRTab } from '../../core/page';
import { setSettings } from '../../core/settings';
import { liveSettings } from '../../content/state';
import { t } from '../../i18n';
import { formatBinding, normalizeBindings, SHORTCUT_DEFINITIONS, type ShortcutBindings, type ShortcutDefinition } from '../../shortcuts';
import { actionLabel, GROUP_LABELS, inScope, keycaps, scopeHint } from './labels';
import type { Toaster } from './toast';

export interface Cheatsheet {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
}

interface CheatsheetOptions {
  signal: AbortSignal;
  toasts: Toaster;
  onOpenChange?(open: boolean): void;
}

const GROUP_ORDER: ShortcutDefinition['group'][] = ['view', 'navigate', 'copy', 'compose', 'help'];
let uid = 0;

function renderRow(def: ShortcutDefinition, bindings: ShortcutBindings, tab: PRTab | undefined): HTMLElement {
  const active = inScope(def.scope, tab);
  const binding = bindings[def.action];
  return h(
    'li',
    { class: `bghub-cs-row${active ? '' : ' bghub-cs-row--inactive'}`, dataset: { action: def.action } },
    h(
      'span',
      { class: 'bghub-cs-label' },
      h('span', { text: actionLabel(def.action) }),
      active ? null : h('span', { class: 'bghub-cs-scope', text: scopeHint(def.scope) })
    ),
    binding ? keycaps(binding) : h('span', { class: 'bghub-cs-unset', text: t('prPageNotSet', 'Not set') })
  );
}

export function renderGroups(bindings: ShortcutBindings, tab: PRTab | undefined, idPrefix: string): HTMLElement {
  return h(
    'div',
    { class: 'bghub-cs-groups' },
    GROUP_ORDER.map((group) => {
      const defs = SHORTCUT_DEFINITIONS.filter((d) => d.group === group);
      if (!defs.length) return null;
      const headingId = `${idPrefix}-${group}`;
      return h(
        'section',
        { class: `bghub-cs-group bghub-cs-group--${group}`, attrs: { 'aria-labelledby': headingId } },
        h('h3', { class: 'bghub-cs-group-title', attrs: { id: headingId }, text: GROUP_LABELS[group]() }),
        h('ul', { class: 'bghub-cs-list' }, defs.map((d) => renderRow(d, bindings, tab)))
      );
    })
  );
}

export function createCheatsheet({ signal, toasts, onOpenChange }: CheatsheetOptions): Cheatsheet {
  const id = `bghub-cs-${++uid}`;
  // Focusable panel: on open we focus the dialog itself (screen readers announce
  // its title) rather than letting showModal() pick the close button.
  const dialog = h('dialog', { class: 'bghub-cheatsheet', attrs: { 'aria-labelledby': `${id}-title`, tabindex: -1, 'data-bghub': '' } });
  const isOpen = (): boolean => dialog.hasAttribute('open');

  const close = (): void => {
    if (!isOpen()) return;
    if (typeof dialog.close === 'function') dialog.close();
    else {
      dialog.removeAttribute('open');
      onOpenChange?.(false);
    }
  };

  const customize = (): void => {
    close();
    void sendToBackground('ui:openOptions', { section: 'shortcuts' }, { ok: false }).then((res) => {
      if (!res.ok) toasts.show(t('prPageOptionsFailed', "Couldn't open the extension options"), { variant: 'warning' });
    });
  };

  const hideHint = (): void => {
    // Close first: the settings change remounts the feature, which would cut the exit animation short.
    close();
    const help = normalizeBindings(liveSettings().shortcutBindings).showHelp;
    void setSettings({ shortcutHintEnabled: false });
    toasts.show(
      help
        ? t('prPageHintHidden', 'Floating button hidden. Press $1 to see shortcuts.', formatBinding(help))
        : t('prPageHintHiddenNoKey', 'Floating button hidden. You can turn it back on in the options.'),
      { variant: 'info', icon: 'eye' }
    );
  };

  const render = (): void => {
    const settings = liveSettings();
    const tab = parsePage(location.href).prTab;
    dialog.replaceChildren(
      h(
        'header',
        { class: 'bghub-cs-header' },
        h('span', { class: 'bghub-cs-header-icon' }, icon('command-palette', 16)),
        h('h2', { class: 'bghub-cs-title', attrs: { id: `${id}-title` }, text: t('prPageCheatsheetTitle', 'Keyboard shortcuts') }),
        h('span', { class: 'bghub-chip bghub-chip--done bghub-cs-brand', text: t('extensionName', 'Better GHub') }),
        h('button', { class: 'bghub-cs-close', attrs: { type: 'button', 'aria-label': t('prPageClose', 'Close') }, on: { click: close } }, icon('x', 16))
      ),
      h('div', { class: 'bghub-cs-body' }, renderGroups(normalizeBindings(settings.shortcutBindings), tab, id)),
      h(
        'footer',
        { class: 'bghub-cs-footer' },
        h('span', { class: 'bghub-cs-tip' }, icon('info', 16), t('prPageTypingNote', 'Shortcuts pause while you type.')),
        h(
          'span',
          { class: 'bghub-cs-actions' },
          settings.shortcutHintEnabled
            ? h('button', { class: 'bghub-cs-btn bghub-cs-btn--invisible', attrs: { type: 'button' }, text: t('prPageHideHint', 'Hide floating button'), on: { click: hideHint } })
            : null,
          h('button', { class: 'bghub-cs-btn', attrs: { type: 'button' }, on: { click: customize } }, icon('gear', 16), t('prPageCustomize', 'Customize'))
        )
      )
    );
  };

  const open = (): void => {
    if (isOpen() || signal.aborted) return;
    render();
    if (!dialog.isConnected) document.documentElement.append(dialog);
    try {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } catch {
      dialog.setAttribute('open', '');
    }
    dialog.focus({ preventScroll: true });
    onOpenChange?.(true);
  };

  dialog.addEventListener('close', () => onOpenChange?.(false), { signal });

  // Backdrop click closes. Clicks on ::backdrop are dispatched to the dialog
  // itself; require press AND release outside the panel so a text selection
  // dragged out of the panel doesn't close it.
  let downOutside = false;
  const outside = (e: MouseEvent): boolean => {
    if (e.target !== dialog) return false;
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  dialog.addEventListener('pointerdown', (e) => {
    downOutside = outside(e);
  }, { signal });
  dialog.addEventListener('click', (e) => {
    if (downOutside && outside(e)) close();
  }, { signal });
  // Back/forward while open → the sheet would describe the wrong tab.
  window.addEventListener('popstate', close, { signal });

  signal.addEventListener(
    'abort',
    () => {
      close();
      // Let the exit transition finish before removing the node.
      setTimeout(() => dialog.remove(), 250);
    },
    { once: true }
  );

  return { open, close, isOpen, toggle: () => (isOpen() ? close() : open()) };
}
