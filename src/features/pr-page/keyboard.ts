// Better GHub - PR page: the single keydown listener.
//
// Capture phase on window, so we see the key before GitHub's own hotkey
// handlers (which listen on document) and can stop it from reaching them.

import type { Settings } from '../../core/settings';
import { liveSettings } from '../../content/state';
import { actionForEvent, isEditableTarget, normalizeBindings, type ShortcutAction, type ShortcutBinding, type ShortcutBindings } from '../../shortcuts';

type ShortcutSettings = Pick<Settings, 'shortcutsEnabled' | 'shortcutBindings'>;

/** GitHub (and Primer) overlays: while focus is inside one, keys belong to it. */
const FOREIGN_OVERLAY = [
  'dialog[open]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[aria-modal="true"]',
  'details-dialog',
  'modal-dialog',
  '[role="menu"]',
  '[role="listbox"]',
  '.Overlay',
  'command-palette',
].join(', ');

/** Elements we own; the cheat sheet handles its own keys. */
const OWN_UI = '[data-bghub]';

let cachedRaw: unknown = Symbol('none');
let cachedBindings: ShortcutBindings | null = null;

/** normalizeBindings() memoised on the raw stored value (keydown is hot). */
export function bindingsFrom(raw: unknown): ShortcutBindings {
  if (raw !== cachedRaw || !cachedBindings) {
    cachedRaw = raw;
    cachedBindings = normalizeBindings(raw);
  }
  return cachedBindings;
}

function eventElement(e: KeyboardEvent): Element | null {
  const first = typeof e.composedPath === 'function' ? e.composedPath()[0] : null;
  const el = first ?? e.target ?? document.activeElement;
  return el instanceof Element ? el : null;
}

export function inForeignOverlay(e: KeyboardEvent): boolean {
  const el = eventElement(e);
  const overlay = el?.closest(FOREIGN_OVERLAY);
  return !!overlay && !overlay.closest(OWN_UI);
}

/** The action a keydown should run on a PR page, or null when it must be left alone. */
export function resolveShortcut(e: KeyboardEvent, settings: ShortcutSettings): ShortcutAction | null {
  if (!settings.shortcutsEnabled) return null;
  if (isEditableTarget(e) || inForeignOverlay(e)) return null;
  const action = actionForEvent(e, bindingsFrom(settings.shortcutBindings));
  // Owned by the comment-templates feature, which has its own listener.
  return action === 'commentTemplates' ? null : action;
}

/**
 * GitHub's diffs bundle tracks "Alt is held" from document keydown/keyup of the
 * Alt key, and treats any click on a `.js-toggle-outdated-comments` button
 * while that flag is set as "Alt+click: toggle ALL outdated threads". With our
 * Alt-based shortcuts, every programmatic thread toggle would trigger that
 * legacy path (which also throws on the new <review-thread-collapsible>).
 * A synthetic Alt keyup resets GitHub's flag before we click anything.
 */
export function releaseGitHubAltFlag(): void {
  document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', code: 'AltLeft', bubbles: true }));
}

interface KeyboardOptions {
  signal: AbortSignal;
  run(action: ShortcutAction, binding: ShortcutBinding | null): void;
  /** While the cheat sheet is open only its own toggle key is handled (Esc is native). */
  sheet: { isOpen(): boolean; close(): void };
  getSettings?: () => ShortcutSettings;
}

export function installKeyboard({ signal, run, sheet, getSettings = liveSettings }: KeyboardOptions): void {
  const consume = (e: KeyboardEvent): void => {
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener(
    'keydown',
    (e) => {
      const settings = getSettings();
      if (!settings.shortcutsEnabled) return;
      if (sheet.isOpen()) {
        if (actionForEvent(e, bindingsFrom(settings.shortcutBindings)) === 'showHelp') {
          consume(e);
          sheet.close();
        }
        return;
      }
      const action = resolveShortcut(e, settings);
      if (!action) return;
      consume(e);
      if (e.altKey) releaseGitHubAltFlag();
      run(action, bindingsFrom(settings.shortcutBindings)[action]);
    },
    { capture: true, signal }
  );
}
