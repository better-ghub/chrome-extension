import { applyBinding, ShortcutRecorder, type KeyInput } from '../src/pages/recorder';
import { defaultBindings, type ShortcutBinding } from '../src/shortcuts';

function key(code: string, key: string, mods: Partial<Pick<KeyInput, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>> = {}, extra: Partial<KeyInput> = {}): KeyInput {
  return { code, key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods, ...extra };
}

const altX = key('KeyX', 'x', { altKey: true });

describe('ShortcutRecorder', () => {
  test('ignores everything while idle', () => {
    const r = new ShortcutRecorder();
    expect(r.recording).toBe(false);
    expect(r.keydown(altX, defaultBindings())).toEqual({ type: 'ignore' });
  });

  test('records a valid new combination and stops', () => {
    const r = new ShortcutRecorder();
    r.start('copyBranch');
    const out = r.keydown(altX, defaultBindings());
    expect(out).toEqual({
      type: 'commit',
      action: 'copyBranch',
      binding: { code: 'KeyX', key: 'x', ctrl: false, shift: false, alt: true, meta: false },
      warning: null,
    });
    expect(r.recording).toBe(false);
  });

  test('records the physical key, not the produced character (macOS Option)', () => {
    const r = new ShortcutRecorder();
    r.start('copyBranch');
    const out = r.keydown(key('KeyC', 'ç', { altKey: true, shiftKey: true }), defaultBindings());
    expect(out.type).toBe('commit');
    if (out.type === 'commit') expect(out.binding.code).toBe('KeyC');
  });

  test('modifier-only presses are ignored until the main key arrives', () => {
    const r = new ShortcutRecorder();
    r.start('copyBranch');
    expect(r.keydown(key('AltLeft', 'Alt', { altKey: true }), defaultBindings())).toEqual({ type: 'ignore' });
    expect(r.keydown(key('ShiftLeft', 'Shift', { altKey: true, shiftKey: true }), defaultBindings())).toEqual({ type: 'ignore' });
    expect(r.recording).toBe(true);
    expect(r.keydown(key('KeyX', 'X', { altKey: true, shiftKey: true }), defaultBindings()).type).toBe('commit');
  });

  test('bare keys and Shift-only combinations require Ctrl/Alt/⌘ and keep recording', () => {
    const r = new ShortcutRecorder();
    r.start('copyBranch');
    expect(r.keydown(key('KeyX', 'x'), defaultBindings())).toEqual({ type: 'invalid', action: 'copyBranch', reason: 'modifier-required' });
    expect(r.keydown(key('KeyX', 'X', { shiftKey: true }), defaultBindings()).type).toBe('invalid');
    expect(r.keydown(key('Enter', 'Enter'), defaultBindings()).type).toBe('invalid');
    expect(r.recording).toBe(true);
  });

  test('Escape cancels, bare Backspace/Delete clear', () => {
    const r = new ShortcutRecorder();
    r.start('copyBranch');
    expect(r.keydown(key('Escape', 'Escape'), defaultBindings())).toEqual({ type: 'cancel', reason: 'escape' });
    expect(r.recording).toBe(false);

    r.start('copyBranch');
    expect(r.keydown(key('Backspace', 'Backspace'), defaultBindings())).toEqual({ type: 'clear', action: 'copyBranch' });
    r.start('copyBranch');
    expect(r.keydown(key('Delete', 'Delete'), defaultBindings())).toEqual({ type: 'clear', action: 'copyBranch' });
  });

  test('Alt+Backspace is a normal combination, not "clear"', () => {
    const r = new ShortcutRecorder();
    r.start('copyBranch');
    expect(r.keydown(key('Backspace', 'Backspace', { altKey: true }), defaultBindings()).type).toBe('commit');
  });

  test('Tab and Shift+Tab cancel (so focus can move on) and are never recorded', () => {
    const r = new ShortcutRecorder();
    r.start('copyBranch');
    expect(r.keydown(key('Tab', 'Tab'), defaultBindings())).toEqual({ type: 'cancel', reason: 'tab' });
    r.start('copyBranch');
    expect(r.keydown(key('Tab', 'Tab', { shiftKey: true }), defaultBindings())).toEqual({ type: 'cancel', reason: 'tab' });
  });

  test('the key that started recording is ignored until released', () => {
    const r = new ShortcutRecorder();
    r.start('copyBranch', ['Enter']);
    // Auto-repeat or a late keydown of the activating Enter must not be recorded.
    expect(r.keydown(key('Enter', 'Enter'), defaultBindings())).toEqual({ type: 'ignore' });
    expect(r.keydown(key('Enter', 'Enter', { altKey: true }), defaultBindings())).toEqual({ type: 'ignore' });
    r.keyup('Enter');
    expect(r.keydown(key('Enter', 'Enter', { altKey: true }), defaultBindings()).type).toBe('commit');
  });

  test('auto-repeat and IME composition are ignored', () => {
    const r = new ShortcutRecorder();
    r.start('copyBranch');
    expect(r.keydown(key('KeyX', 'x', { altKey: true }, { repeat: true }), defaultBindings())).toEqual({ type: 'ignore' });
    expect(r.keydown(key('KeyX', 'x', { altKey: true }, { isComposing: true }), defaultBindings())).toEqual({ type: 'ignore' });
    expect(r.recording).toBe(true);
  });

  test('duplicates are reported with the conflicting actions', () => {
    const r = new ShortcutRecorder();
    r.start('copyBranch');
    // Alt+C is the default for toggleComments.
    const out = r.keydown(key('KeyC', 'c', { altKey: true }), defaultBindings());
    expect(out.type).toBe('duplicate');
    if (out.type === 'duplicate') {
      expect(out.conflicts).toEqual(['toggleComments']);
      expect(out.binding.code).toBe('KeyC');
    }
    expect(r.recording).toBe(false);
  });

  test('re-recording the same combination for the same action is not a duplicate', () => {
    const r = new ShortcutRecorder();
    r.start('toggleComments');
    expect(r.keydown(key('KeyC', 'c', { altKey: true }), defaultBindings()).type).toBe('commit');
  });

  test('browser-reserved combinations commit with a warning', () => {
    const r = new ShortcutRecorder();
    r.start('copyBranch');
    const out = r.keydown(key('KeyW', 'w', { ctrlKey: true }), defaultBindings());
    expect(out).toMatchObject({ type: 'commit', warning: 'browser' });
  });

  test('stop() ends recording', () => {
    const r = new ShortcutRecorder();
    r.start('copyBranch');
    r.stop();
    expect(r.action).toBeNull();
    expect(r.keydown(altX, defaultBindings())).toEqual({ type: 'ignore' });
  });
});

describe('applyBinding', () => {
  const altX: ShortcutBinding = { code: 'KeyX', key: 'x', ctrl: false, shift: false, alt: true, meta: false };

  test('sets the action and unbinds the replaced ones without mutating the input', () => {
    const before = defaultBindings();
    const next = applyBinding(before, 'copyBranch', altX, ['toggleComments']);
    expect(next.copyBranch).toEqual(altX);
    expect(next.toggleComments).toBeNull();
    expect(before.toggleComments).not.toBeNull();
  });

  test('never unbinds the action being set', () => {
    const next = applyBinding(defaultBindings(), 'copyBranch', altX, ['copyBranch']);
    expect(next.copyBranch).toEqual(altX);
  });
});
