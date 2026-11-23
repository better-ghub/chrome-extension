// Better GHub - Keyboard shortcut registry & helpers
//
// Single source of truth for: the list of shortcut actions, their default
// bindings, storage (de)serialisation, event matching, the "is the user typing?"
// guard and human-readable formatting. Shared by the content script (which
// executes actions) and the Options page (which lets the user remap them).
//
// Matching is done on KeyboardEvent.code (the physical key), NOT on
// KeyboardEvent.key. On macOS, Option+C produces key === 'ç' and Option+Shift+F
// produces key === 'Ï', so key-based matching silently never fires for Alt
// combos on a Mac. `code` ('KeyC', 'KeyF', 'Digit1', 'Slash') is stable across
// modifiers and platforms.

import { readSettingItems, writeSettingItems } from './core/settings-storage';

export interface ShortcutBinding {
  /** KeyboardEvent.code of the main key, e.g. 'KeyC', 'Digit1', 'Slash'. */
  code: string;
  /** Lower-cased KeyboardEvent.key captured when recorded (display fallback only). */
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

export type ShortcutAction =
  | 'toggleComments'
  | 'toggleFiles'
  | 'nextUnresolved'
  | 'prevUnresolved'
  | 'copyBranch'
  | 'copyMarkdownLink'
  | 'copyCheckout'
  | 'markViewedNext'
  | 'nextUnviewed'
  | 'toggleGenerated'
  | 'toggleWhitespace'
  | 'toggleSplitView'
  | 'findFile'
  | 'changesSinceVisit'
  | 'toggleThreadsPanel'
  | 'loadAllTimeline'
  | 'toggleChecklist'
  | 'gotoConversation'
  | 'gotoCommits'
  | 'gotoChecks'
  | 'gotoFiles'
  | 'commentTemplates'
  | 'showHelp';

/** `null` means the user explicitly unbound the action. */
export type ShortcutBindings = Record<ShortcutAction, ShortcutBinding | null>;

export type ShortcutScope = 'conversation' | 'files' | 'pr';

export interface ShortcutDefinition {
  action: ShortcutAction;
  /** i18n key for the label shown in the cheat sheet / options. */
  labelKey: string;
  /** English fallback label. */
  label: string;
  /** Where the action does something useful. 'pr' = any PR tab. */
  scope: ShortcutScope[];
  group: 'view' | 'navigate' | 'copy' | 'compose' | 'help';
  defaultBinding: ShortcutBinding;
}

// Settings storage keys (flat, matching the existing settings convention).
export const SHORTCUTS_STORAGE_KEY = 'shortcutBindings';
export const SHORTCUTS_ENABLED_KEY = 'shortcutsEnabled';

const alt = (code: string, key: string, shift = false): ShortcutBinding => ({
  code,
  key,
  ctrl: false,
  shift,
  alt: true,
  meta: false,
});

/**
 * Registry. Order = display order in the cheat sheet and Options page.
 * Defaults are Alt-based to stay clear of GitHub's single-key shortcuts and of
 * typing. Alt+F alone opens the browser menu on Windows/Linux, hence Alt+Shift+F.
 */
export const SHORTCUT_DEFINITIONS: readonly ShortcutDefinition[] = [
  {
    action: 'toggleComments',
    labelKey: 'shortcutToggleComments',
    label: 'Collapse / expand all review threads',
    scope: ['conversation', 'files'],
    group: 'view',
    defaultBinding: alt('KeyC', 'c'),
  },
  {
    action: 'toggleFiles',
    labelKey: 'shortcutToggleFiles',
    label: 'Collapse / expand all files',
    scope: ['files'],
    group: 'view',
    defaultBinding: alt('KeyF', 'f', true),
  },
  {
    action: 'toggleGenerated',
    labelKey: 'shortcutToggleGenerated',
    label: 'Collapse / expand generated files',
    scope: ['files'],
    group: 'view',
    defaultBinding: alt('KeyG', 'g', true),
  },
  {
    action: 'toggleWhitespace',
    labelKey: 'shortcutToggleWhitespace',
    label: 'Hide / show whitespace changes',
    scope: ['files'],
    group: 'view',
    defaultBinding: alt('KeyW', 'w'),
  },
  {
    action: 'toggleSplitView',
    labelKey: 'shortcutToggleSplitView',
    label: 'Switch between split and unified diff',
    scope: ['files'],
    group: 'view',
    defaultBinding: alt('KeyS', 's'),
  },
  {
    action: 'toggleThreadsPanel',
    labelKey: 'shortcutToggleThreadsPanel',
    label: 'Show / hide the unresolved threads panel',
    scope: ['conversation', 'files'],
    group: 'view',
    defaultBinding: alt('KeyT', 't'),
  },
  {
    action: 'loadAllTimeline',
    labelKey: 'shortcutLoadAllTimeline',
    label: 'Load all hidden conversation items',
    scope: ['conversation'],
    group: 'view',
    defaultBinding: alt('KeyH', 'h'),
  },
  {
    action: 'toggleChecklist',
    labelKey: 'shortcutToggleChecklist',
    label: 'Show / hide the review checklist',
    scope: ['pr'],
    group: 'view',
    defaultBinding: alt('KeyR', 'r', true),
  },
  {
    action: 'markViewedNext',
    labelKey: 'shortcutMarkViewedNext',
    label: 'Mark file as viewed and go to the next one',
    scope: ['files'],
    group: 'navigate',
    defaultBinding: alt('KeyV', 'v'),
  },
  {
    action: 'findFile',
    labelKey: 'shortcutFindFile',
    label: 'Find a changed file',
    scope: ['files'],
    group: 'navigate',
    defaultBinding: alt('KeyP', 'p'),
  },
  {
    action: 'changesSinceVisit',
    labelKey: 'shortcutChangesSinceVisit',
    label: 'Show changes since your last visit',
    scope: ['pr'],
    group: 'navigate',
    // Bare Alt+D focuses the address bar on Windows/Linux.
    defaultBinding: alt('KeyD', 'd', true),
  },
  {
    action: 'nextUnviewed',
    labelKey: 'shortcutNextUnviewed',
    label: 'Jump to the next unviewed file',
    scope: ['files'],
    group: 'navigate',
    defaultBinding: alt('KeyN', 'n'),
  },
  {
    action: 'nextUnresolved',
    labelKey: 'shortcutNextUnresolved',
    label: 'Jump to next unresolved thread',
    scope: ['conversation', 'files'],
    group: 'navigate',
    defaultBinding: alt('KeyJ', 'j'),
  },
  {
    action: 'prevUnresolved',
    labelKey: 'shortcutPrevUnresolved',
    label: 'Jump to previous unresolved thread',
    scope: ['conversation', 'files'],
    group: 'navigate',
    defaultBinding: alt('KeyK', 'k'),
  },
  {
    action: 'gotoConversation',
    labelKey: 'shortcutGotoConversation',
    label: 'Go to Conversation',
    scope: ['pr'],
    group: 'navigate',
    defaultBinding: alt('Digit1', '1'),
  },
  {
    action: 'gotoCommits',
    labelKey: 'shortcutGotoCommits',
    label: 'Go to Commits',
    scope: ['pr'],
    group: 'navigate',
    defaultBinding: alt('Digit2', '2'),
  },
  {
    action: 'gotoChecks',
    labelKey: 'shortcutGotoChecks',
    label: 'Go to Checks',
    scope: ['pr'],
    group: 'navigate',
    defaultBinding: alt('Digit3', '3'),
  },
  {
    action: 'gotoFiles',
    labelKey: 'shortcutGotoFiles',
    label: 'Go to Files changed',
    scope: ['pr'],
    group: 'navigate',
    defaultBinding: alt('Digit4', '4'),
  },
  {
    action: 'copyBranch',
    labelKey: 'shortcutCopyBranch',
    label: 'Copy head branch name',
    scope: ['pr'],
    group: 'copy',
    defaultBinding: alt('KeyB', 'b'),
  },
  {
    action: 'copyMarkdownLink',
    labelKey: 'shortcutCopyMarkdownLink',
    label: 'Copy PR as Markdown link',
    scope: ['pr'],
    group: 'copy',
    defaultBinding: alt('KeyL', 'l'),
  },
  {
    action: 'copyCheckout',
    labelKey: 'shortcutCopyCheckout',
    label: 'Copy checkout command',
    scope: ['pr'],
    group: 'copy',
    defaultBinding: alt('KeyG', 'g'),
  },
  {
    action: 'commentTemplates',
    labelKey: 'shortcutCommentTemplates',
    label: 'Insert a comment template',
    scope: ['pr'],
    group: 'compose',
    // The only shortcut that also works while typing, and only in a GitHub comment box.
    defaultBinding: alt('Semicolon', ';'),
  },
  {
    action: 'showHelp',
    labelKey: 'shortcutShowHelp',
    label: 'Show keyboard shortcuts',
    scope: ['pr'],
    group: 'help',
    defaultBinding: alt('Slash', '/'),
  },
];

export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = SHORTCUT_DEFINITIONS.map((d) => d.action);

export function getDefinition(action: ShortcutAction): ShortcutDefinition {
  const def = SHORTCUT_DEFINITIONS.find((d) => d.action === action);
  if (!def) throw new Error(`Unknown shortcut action: ${action}`);
  return def;
}

const MODIFIER_KEYS = new Set(['control', 'shift', 'alt', 'meta', 'os', 'altgraph', 'capslock', 'fn', 'fnlock', 'hyper', 'super', 'symbol']);
const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS|CapsLock|Fn)(Left|Right)?$/;

function cloneBinding(b: ShortcutBinding): ShortcutBinding {
  return { code: b.code, key: b.key.toLowerCase(), ctrl: b.ctrl, shift: b.shift, alt: b.alt, meta: b.meta };
}

/** Best-effort physical code for a legacy key-only binding (pre-0.4 storage format). */
export function codeFromKey(key: string): string | null {
  const k = key.toLowerCase();
  if (/^[a-z]$/.test(k)) return `Key${k.toUpperCase()}`;
  if (/^[0-9]$/.test(k)) return `Digit${k}`;
  const map: Record<string, string> = {
    '/': 'Slash',
    '\\': 'Backslash',
    '.': 'Period',
    ',': 'Comma',
    ';': 'Semicolon',
    "'": 'Quote',
    '[': 'BracketLeft',
    ']': 'BracketRight',
    '-': 'Minus',
    '=': 'Equal',
    '`': 'Backquote',
    ' ': 'Space',
    enter: 'Enter',
    escape: 'Escape',
    tab: 'Tab',
    arrowup: 'ArrowUp',
    arrowdown: 'ArrowDown',
    arrowleft: 'ArrowLeft',
    arrowright: 'ArrowRight',
  };
  return map[k] ?? null;
}

function isBool(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

/** Validate + upgrade one stored binding. Returns undefined when unusable. */
function parseBinding(v: unknown): ShortcutBinding | null | undefined {
  if (v === null) return null; // explicitly unbound
  if (!v || typeof v !== 'object') return undefined;
  const b = v as Record<string, unknown>;
  if (!isBool(b.ctrl) || !isBool(b.shift) || !isBool(b.alt) || !isBool(b.meta)) return undefined;
  const key = typeof b.key === 'string' ? b.key.toLowerCase() : '';
  let code = typeof b.code === 'string' && b.code ? b.code : '';
  if (!code) {
    // Legacy (pre-0.4) bindings stored only `key`. Upgrade when we can map it.
    const derived = key ? codeFromKey(key) : null;
    if (!derived) return undefined;
    code = derived;
  }
  if (MODIFIER_CODES.test(code)) return undefined;
  return { code, key: key || keyFromCode(code).toLowerCase(), ctrl: b.ctrl, shift: b.shift, alt: b.alt, meta: b.meta };
}

/** Fresh, mutable copy of the default bindings. */
export function defaultBindings(): ShortcutBindings {
  const out = {} as ShortcutBindings;
  for (const def of SHORTCUT_DEFINITIONS) out[def.action] = cloneBinding(def.defaultBinding);
  return out;
}

/**
 * Merge a raw (possibly partial/untrusted/legacy) value from storage over the
 * defaults. Understands the pre-0.4 shape `{ toggleAll, toggleFiles }` too.
 */
export function normalizeBindings(raw: unknown): ShortcutBindings {
  const merged = defaultBindings();
  if (!raw || typeof raw !== 'object') return merged;
  const r = { ...(raw as Record<string, unknown>) };
  // Legacy name from <= 0.3.x
  if ('toggleAll' in r && !('toggleComments' in r)) r.toggleComments = r.toggleAll;
  for (const action of SHORTCUT_ACTIONS) {
    if (!(action in r)) continue;
    const parsed = parseBinding(r[action]);
    if (parsed !== undefined) merged[action] = parsed;
  }
  return merged;
}

/** Storage shape: only what differs from the defaults is meaningful, but we store the full map for simplicity. */
export function serializeBindings(b: ShortcutBindings): Record<string, ShortcutBinding | null> {
  const out: Record<string, ShortcutBinding | null> = {};
  for (const action of SHORTCUT_ACTIONS) out[action] = b[action] ? cloneBinding(b[action] as ShortcutBinding) : null;
  return out;
}

/** Read the current bindings from storage, merged over defaults. */
export async function loadBindings(): Promise<ShortcutBindings> {
  try {
    const stored = await readSettingItems([SHORTCUTS_STORAGE_KEY]);
    return normalizeBindings(stored[SHORTCUTS_STORAGE_KEY]);
  } catch {
    return defaultBindings();
  }
}

export async function saveBindings(b: ShortcutBindings): Promise<void> {
  await writeSettingItems({ [SHORTCUTS_STORAGE_KEY]: serializeBindings(b) });
}

/** Whether shortcuts are enabled (default true). */
export async function loadShortcutsEnabled(): Promise<boolean> {
  try {
    const stored = await readSettingItems([SHORTCUTS_ENABLED_KEY]);
    return stored[SHORTCUTS_ENABLED_KEY] !== false;
  } catch {
    return true;
  }
}

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = uaData?.platform || navigator.platform || navigator.userAgent || '';
  return /mac|iphone|ipad/i.test(platform);
}

export function isModifierKey(key: string): boolean {
  return MODIFIER_KEYS.has(key.toLowerCase());
}

/**
 * Whether a keydown event targets an editable control. On GitHub the comment
 * editors are rich text areas / web components, so we inspect the composed path
 * (to pierce shadow DOM) and fall back to document.activeElement. This is the
 * guard that stops shortcuts from firing while the user is typing.
 */
export function isEditableTarget(e: KeyboardEvent): boolean {
  const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
  const el =
    (path[0] as HTMLElement | undefined) ??
    (e.target as HTMLElement | null) ??
    (typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null);
  if (!el || typeof el.tagName !== 'string') return false;

  const tag = el.tagName.toUpperCase();
  if (tag === 'INPUT') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    // Checkboxes/radios/buttons don't take text input.
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'].includes(type);
  }
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  if (
    typeof el.closest === 'function' &&
    el.closest(
      'textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], [role="textbox"], [role="combobox"], .CodeMirror, .cm-editor, .monaco-editor, .comment-form-textarea'
    )
  ) {
    return true;
  }
  return false;
}

/** Exact modifier match against a binding, on the physical key. */
export function matchesBinding(e: KeyboardEvent, b: ShortcutBinding | null | undefined): boolean {
  if (!b) return false;
  if (e.ctrlKey !== b.ctrl || e.shiftKey !== b.shift || e.altKey !== b.alt || e.metaKey !== b.meta) return false;
  if (e.code) return e.code === b.code;
  // Synthetic events / very old browsers without `code`: fall back to key.
  return !!e.key && e.key.toLowerCase() === b.key.toLowerCase();
}

/** Find which action (if any) a keydown event triggers. */
export function actionForEvent(e: KeyboardEvent, bindings: ShortcutBindings): ShortcutAction | null {
  if (e.repeat || e.isComposing) return null;
  for (const action of SHORTCUT_ACTIONS) {
    if (matchesBinding(e, bindings[action])) return action;
  }
  return null;
}

/** Build a binding from a recorded keydown; null for pure-modifier presses. */
export function bindingFromEvent(e: KeyboardEvent): ShortcutBinding | null {
  if (!e.key || isModifierKey(e.key)) return null;
  const code = e.code || codeFromKey(e.key) || '';
  if (!code || MODIFIER_CODES.test(code)) return null;
  return {
    code,
    key: e.key.toLowerCase(),
    ctrl: e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
    meta: e.metaKey,
  };
}

const CODE_LABELS: Record<string, string> = {
  Slash: '/',
  Backslash: '\\',
  Period: '.',
  Comma: ',',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Space: 'Space',
  Enter: 'Enter',
  Escape: 'Esc',
  Tab: 'Tab',
  Backspace: 'Backspace',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/** Display label for a physical key code: 'KeyC' → 'C', 'Digit1' → '1', 'Slash' → '/'. */
export function keyFromCode(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `Num${code.slice(6)}`;
  if (/^F[0-9]{1,2}$/.test(code)) return code;
  return CODE_LABELS[code] ?? code;
}

/** Individual key caps for a binding, e.g. ['⌥', '⇧', 'F'] or ['Alt', 'Shift', 'F']. */
export function bindingKeys(b: ShortcutBinding, mac = isMacPlatform()): string[] {
  const parts: string[] = [];
  if (mac) {
    if (b.ctrl) parts.push('⌃');
    if (b.alt) parts.push('⌥');
    if (b.shift) parts.push('⇧');
    if (b.meta) parts.push('⌘');
  } else {
    if (b.ctrl) parts.push('Ctrl');
    if (b.alt) parts.push('Alt');
    if (b.shift) parts.push('Shift');
    if (b.meta) parts.push('Win');
  }
  parts.push(keyFromCode(b.code));
  return parts;
}

/** Human-readable label for a binding, e.g. "Alt+Shift+F" or "⌥⇧F" on macOS. */
export function formatBinding(b: ShortcutBinding | null, mac = isMacPlatform()): string {
  if (!b) return '—';
  const parts = bindingKeys(b, mac);
  return mac ? parts.join('') : parts.join('+');
}

export function bindingsEqual(a: ShortcutBinding | null, b: ShortcutBinding | null): boolean {
  if (!a || !b) return a === b;
  return a.code === b.code && a.ctrl === b.ctrl && a.shift === b.shift && a.alt === b.alt && a.meta === b.meta;
}

/** Other actions already using the same combination. */
export function findDuplicates(bindings: ShortcutBindings, action: ShortcutAction): ShortcutAction[] {
  const target = bindings[action];
  if (!target) return [];
  return SHORTCUT_ACTIONS.filter((a) => a !== action && bindingsEqual(bindings[a], target));
}

export type ConflictKind = 'browser' | 'typing' | null;

/**
 * Light heuristic for combinations that commonly collide with the browser or
 * GitHub: a bare Alt+F/E/D (opens the browser menu / address bar on
 * Windows/Linux), Ctrl/Cmd+W/T/N/Q/L/R (tab/window management) or a binding with
 * no Ctrl/Alt/Meta modifier (steps on GitHub's single-key shortcuts and on
 * ordinary typing). Used only to surface a soft warning in Options.
 */
export function conflictKind(b: ShortcutBinding | null): ConflictKind {
  if (!b) return null;
  const k = keyFromCode(b.code).toLowerCase();
  if (!b.alt && !b.ctrl && !b.meta) return 'typing';
  if (b.alt && !b.shift && !b.ctrl && !b.meta && ['f', 'e', 'd'].includes(k)) return 'browser';
  if ((b.ctrl || b.meta) && !b.alt && ['w', 't', 'n', 'q', 'l', 'r', 'tab'].includes(k)) return 'browser';
  return null;
}

/** Back-compat boolean wrapper around conflictKind. */
export function hasLikelyConflict(b: ShortcutBinding | null): boolean {
  return conflictKind(b) !== null;
}
