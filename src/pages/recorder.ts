// Better GHub - Shortcut recorder state machine (Options page).
//
// Pure logic: the view feeds it key events from the ONE key-cap button that is
// recording and acts on the returned outcome. Nothing here listens globally,
// so recording can never swallow keys elsewhere on the page.
//
//   idle ──start()──▶ recording ──keydown──▶ outcome
//     ignore     modifier-only press, auto-repeat, IME, or the key that started recording
//     cancel     Escape, or Tab/Shift+Tab (focus moves on) — also on blur, via stop()
//     clear      bare Backspace/Delete → unbind (null)
//     invalid    no Ctrl/Alt/⌘ modifier — stays recording so the user can retry
//     duplicate  combination already used by another action — needs "Replace"
//     commit     valid new binding (warning: 'browser' when it may clash)

import {
  bindingFromEvent,
  conflictKind,
  findDuplicates,
  isModifierKey,
  type ShortcutAction,
  type ShortcutBinding,
  type ShortcutBindings,
} from '../shortcuts';

/** The subset of KeyboardEvent the recorder reads. */
export type KeyInput = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'> &
  Partial<Pick<KeyboardEvent, 'repeat' | 'isComposing'>>;

export type RecorderOutcome =
  | { type: 'ignore' }
  | { type: 'cancel'; reason: 'escape' | 'tab' }
  | { type: 'clear'; action: ShortcutAction }
  | { type: 'invalid'; action: ShortcutAction; reason: 'modifier-required' }
  | { type: 'duplicate'; action: ShortcutAction; binding: ShortcutBinding; conflicts: ShortcutAction[] }
  | { type: 'commit'; action: ShortcutAction; binding: ShortcutBinding; warning: 'browser' | null };

const IGNORE: RecorderOutcome = { type: 'ignore' };

function hasCommandModifier(e: Pick<KeyInput, 'ctrlKey' | 'altKey' | 'metaKey'>): boolean {
  return e.ctrlKey || e.altKey || e.metaKey;
}

function noModifiers(e: KeyInput): boolean {
  return !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;
}

export class ShortcutRecorder {
  private current: ShortcutAction | null = null;
  /** Physical keys still held down from the gesture that started recording. */
  private held = new Set<string>();

  get action(): ShortcutAction | null {
    return this.current;
  }

  get recording(): boolean {
    return this.current !== null;
  }

  /**
   * Begin recording for `action`. `heldCodes` are keys physically down at that
   * moment (e.g. the Enter that activated the button); their keydown repeats
   * and keyup are ignored so they can't be recorded by accident.
   */
  start(action: ShortcutAction, heldCodes: Iterable<string> = []): void {
    this.current = action;
    this.held = new Set(heldCodes);
  }

  stop(): void {
    this.current = null;
    this.held.clear();
  }

  keyup(code: string): void {
    this.held.delete(code);
  }

  keydown(e: KeyInput, bindings: ShortcutBindings): RecorderOutcome {
    const action = this.current;
    if (!action) return IGNORE;
    if (e.isComposing || e.repeat) return IGNORE;
    if (e.code && this.held.has(e.code)) return IGNORE;

    if (e.key === 'Escape' && noModifiers(e)) {
      this.stop();
      return { type: 'cancel', reason: 'escape' };
    }
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      this.stop();
      return { type: 'cancel', reason: 'tab' };
    }
    if ((e.key === 'Backspace' || e.key === 'Delete') && noModifiers(e)) {
      this.stop();
      return { type: 'clear', action };
    }
    if (!e.key || isModifierKey(e.key)) return IGNORE;

    const binding = bindingFromEvent(e as KeyboardEvent);
    if (!binding) return IGNORE;
    if (!hasCommandModifier(e)) return { type: 'invalid', action, reason: 'modifier-required' };

    this.stop();
    const conflicts = findDuplicates({ ...bindings, [action]: binding }, action);
    if (conflicts.length) return { type: 'duplicate', action, binding, conflicts };
    return { type: 'commit', action, binding, warning: conflictKind(binding) === 'browser' ? 'browser' : null };
  }
}

/** Bindings with `action` set and every action in `unbind` cleared. */
export function applyBinding(
  bindings: ShortcutBindings,
  action: ShortcutAction,
  binding: ShortcutBinding | null,
  unbind: readonly ShortcutAction[] = []
): ShortcutBindings {
  const next = { ...bindings, [action]: binding };
  for (const other of unbind) if (other !== action) next[other] = null;
  return next;
}

export function hasCommandModifierBinding(b: ShortcutBinding): boolean {
  return hasCommandModifier({ ctrlKey: b.ctrl, altKey: b.alt, metaKey: b.meta });
}
