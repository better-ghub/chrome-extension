import { readSettingItems, writeSettingItems } from '../src/core/settings-storage';
import {
  actionForEvent,
  bindingFromEvent,
  bindingKeys,
  codeFromKey,
  conflictKind,
  defaultBindings,
  findDuplicates,
  formatBinding,
  hasLikelyConflict,
  isEditableTarget,
  isModifierKey,
  keyFromCode,
  loadBindings,
  loadShortcutsEnabled,
  matchesBinding,
  normalizeBindings,
  saveBindings,
  serializeBindings,
  SHORTCUT_ACTIONS,
  SHORTCUT_DEFINITIONS,
  SHORTCUTS_ENABLED_KEY,
  SHORTCUTS_STORAGE_KEY,
  type ShortcutBinding,
} from '../src/shortcuts';

function resetStorage(): void {
  (globalThis as unknown as { __resetChromeStorage: () => void }).__resetChromeStorage();
}

const kd = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent('keydown', init);
const altC: ShortcutBinding = { code: 'KeyC', key: 'c', ctrl: false, shift: false, alt: true, meta: false };

describe('registry', () => {
  test('every action has a unique default binding', () => {
    const seen = new Set<string>();
    for (const def of SHORTCUT_DEFINITIONS) {
      const id = formatBinding(def.defaultBinding, false);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });

  test('defaults avoid known browser conflicts', () => {
    for (const def of SHORTCUT_DEFINITIONS) expect(conflictKind(def.defaultBinding)).toBeNull();
  });

  test('toggleComments = Alt+C, toggleFiles = Alt+Shift+F', () => {
    const b = defaultBindings();
    expect(b.toggleComments).toMatchObject({ code: 'KeyC', alt: true, shift: false });
    expect(b.toggleFiles).toMatchObject({ code: 'KeyF', alt: true, shift: true });
  });

  test('defaultBindings returns a fresh copy', () => {
    const a = defaultBindings();
    (a.toggleComments as ShortcutBinding).code = 'KeyX';
    expect(defaultBindings().toggleComments?.code).toBe('KeyC');
  });
});

describe('matchesBinding (physical key)', () => {
  test('matches on code even when macOS Option changes the character', () => {
    // Option+C on macOS → key 'ç', code 'KeyC'
    expect(matchesBinding(kd({ key: 'ç', code: 'KeyC', altKey: true }), altC)).toBe(true);
    // Option+Shift+F on macOS → key 'Ï'
    const altShiftF = defaultBindings().toggleFiles;
    expect(matchesBinding(kd({ key: 'Ï', code: 'KeyF', altKey: true, shiftKey: true }), altShiftF)).toBe(true);
  });

  test('requires the exact modifier set', () => {
    expect(matchesBinding(kd({ key: 'c', code: 'KeyC', altKey: true, shiftKey: true }), altC)).toBe(false);
    expect(matchesBinding(kd({ key: 'c', code: 'KeyC' }), altC)).toBe(false);
    expect(matchesBinding(kd({ key: 'f', code: 'KeyF', altKey: true }), altC)).toBe(false);
  });

  test('falls back to key when the event has no code', () => {
    expect(matchesBinding(kd({ key: 'C', altKey: true }), altC)).toBe(true);
  });

  test('null binding never matches', () => {
    expect(matchesBinding(kd({ key: 'c', code: 'KeyC', altKey: true }), null)).toBe(false);
  });
});

describe('actionForEvent', () => {
  test('resolves the action and ignores auto-repeat / IME composition', () => {
    const b = defaultBindings();
    expect(actionForEvent(kd({ key: '÷', code: 'Slash', altKey: true }), b)).toBe('showHelp');
    expect(actionForEvent(kd({ key: '¡', code: 'Digit1', altKey: true }), b)).toBe('gotoConversation');
    expect(actionForEvent(kd({ key: 'ç', code: 'KeyC', altKey: true, repeat: true }), b)).toBeNull();
    expect(actionForEvent(kd({ key: 'ç', code: 'KeyC', altKey: true, isComposing: true }), b)).toBeNull();
    expect(actionForEvent(kd({ key: 'x', code: 'KeyX' }), b)).toBeNull();
  });

  test('unbound actions are skipped', () => {
    const b = defaultBindings();
    b.toggleComments = null;
    expect(actionForEvent(kd({ key: 'c', code: 'KeyC', altKey: true }), b)).toBeNull();
  });
});

describe('bindingFromEvent', () => {
  test('null for pure modifier presses', () => {
    expect(bindingFromEvent(kd({ key: 'Alt', code: 'AltLeft', altKey: true }))).toBeNull();
    expect(bindingFromEvent(kd({ key: 'Shift', code: 'ShiftRight', shiftKey: true }))).toBeNull();
    expect(bindingFromEvent(kd({ key: 'Meta', code: 'MetaLeft', metaKey: true }))).toBeNull();
  });

  test('records the physical code and modifiers', () => {
    expect(bindingFromEvent(kd({ key: 'ç', code: 'KeyC', altKey: true }))).toEqual({
      code: 'KeyC',
      key: 'ç',
      ctrl: false,
      shift: false,
      alt: true,
      meta: false,
    });
  });

  test('derives code from key when missing', () => {
    expect(bindingFromEvent(kd({ key: 'K', ctrlKey: true, shiftKey: true }))).toMatchObject({ code: 'KeyK', ctrl: true, shift: true });
  });
});

describe('normalizeBindings', () => {
  test('defaults for garbage input', () => {
    expect(normalizeBindings(undefined)).toEqual(defaultBindings());
    expect(normalizeBindings('nope')).toEqual(defaultBindings());
    expect(normalizeBindings({ toggleComments: { code: 'KeyX' } })).toEqual(defaultBindings());
  });

  test('upgrades legacy key-only bindings and the old toggleAll name', () => {
    const legacy = {
      toggleAll: { key: 'x', ctrl: true, shift: false, alt: false, meta: false },
      toggleFiles: { key: 'ç', ctrl: false, shift: false, alt: true, meta: false }, // unmappable → default
    };
    const b = normalizeBindings(legacy);
    expect(b.toggleComments).toEqual({ code: 'KeyX', key: 'x', ctrl: true, shift: false, alt: false, meta: false });
    expect(b.toggleFiles).toEqual(defaultBindings().toggleFiles);
  });

  test('keeps explicit nulls (unbound) and rejects modifier-only codes', () => {
    const b = normalizeBindings({
      copyBranch: null,
      showHelp: { code: 'ShiftLeft', key: 'shift', ctrl: false, shift: true, alt: false, meta: false },
    });
    expect(b.copyBranch).toBeNull();
    expect(b.showHelp).toEqual(defaultBindings().showHelp);
  });

  test('round-trips through serializeBindings', () => {
    const b = defaultBindings();
    b.nextUnresolved = { code: 'KeyN', key: 'n', ctrl: true, shift: true, alt: false, meta: false };
    b.copyBranch = null;
    expect(normalizeBindings(JSON.parse(JSON.stringify(serializeBindings(b))))).toEqual(b);
  });
});

describe('storage', () => {
  beforeEach(resetStorage);

  test('loadBindings: defaults when nothing stored, then saved values', async () => {
    expect(await loadBindings()).toEqual(defaultBindings());
    const b = defaultBindings();
    b.toggleFiles = { code: 'KeyD', key: 'd', ctrl: false, shift: true, alt: true, meta: false };
    await saveBindings(b);
    expect(await loadBindings()).toEqual(b);
    const raw = await readSettingItems([SHORTCUTS_STORAGE_KEY]);
    expect(Object.keys(raw[SHORTCUTS_STORAGE_KEY] as object).sort()).toEqual([...SHORTCUT_ACTIONS].sort());
  });

  test('loadShortcutsEnabled defaults to true and honours false', async () => {
    expect(await loadShortcutsEnabled()).toBe(true);
    await writeSettingItems({ [SHORTCUTS_ENABLED_KEY]: false });
    expect(await loadShortcutsEnabled()).toBe(false);
  });
});

describe('formatting', () => {
  test('keyFromCode', () => {
    expect(keyFromCode('KeyC')).toBe('C');
    expect(keyFromCode('Digit4')).toBe('4');
    expect(keyFromCode('Slash')).toBe('/');
    expect(keyFromCode('ArrowDown')).toBe('↓');
    expect(keyFromCode('F5')).toBe('F5');
  });

  test('codeFromKey', () => {
    expect(codeFromKey('a')).toBe('KeyA');
    expect(codeFromKey('7')).toBe('Digit7');
    expect(codeFromKey('/')).toBe('Slash');
    expect(codeFromKey('ç')).toBeNull();
  });

  test('formatBinding uses the physical key, not the produced character', () => {
    const b: ShortcutBinding = { code: 'KeyF', key: 'ï', ctrl: false, shift: true, alt: true, meta: false };
    expect(formatBinding(b, true)).toBe('⌥⇧F');
    expect(formatBinding(b, false)).toBe('Alt+Shift+F');
    expect(formatBinding(null, false)).toBe('—');
    expect(bindingKeys({ ...b, ctrl: true, meta: true }, true)).toEqual(['⌃', '⌥', '⇧', '⌘', 'F']);
  });

  test('isModifierKey', () => {
    expect(isModifierKey('Alt')).toBe(true);
    expect(isModifierKey('AltGraph')).toBe(true);
    expect(isModifierKey('c')).toBe(false);
  });
});

describe('conflicts', () => {
  test('conflictKind', () => {
    expect(conflictKind({ ...altC, code: 'KeyF', key: 'f' })).toBe('browser');
    expect(conflictKind({ ...altC, alt: false })).toBe('typing');
    expect(conflictKind({ code: 'KeyW', key: 'w', ctrl: true, shift: false, alt: false, meta: false })).toBe('browser');
    expect(conflictKind(altC)).toBeNull();
    expect(hasLikelyConflict(altC)).toBe(false);
  });

  test('findDuplicates', () => {
    const b = defaultBindings();
    b.copyBranch = { ...(b.toggleComments as ShortcutBinding) };
    expect(findDuplicates(b, 'copyBranch')).toEqual(['toggleComments']);
    expect(findDuplicates(b, 'gotoFiles')).toEqual([]);
  });
});

describe('isEditableTarget', () => {
  function fire(el: HTMLElement): boolean {
    document.body.appendChild(el);
    let result = false;
    el.addEventListener('keydown', (e) => (result = isEditableTarget(e)));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
    el.remove();
    return result;
  }

  test('true for text inputs, textareas and textbox roles', () => {
    expect(fire(document.createElement('textarea'))).toBe(true);
    expect(fire(document.createElement('input'))).toBe(true);
    const div = document.createElement('div');
    div.setAttribute('role', 'textbox');
    expect(fire(div)).toBe(true);
  });

  test('false for checkboxes, buttons and plain elements', () => {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    expect(fire(cb)).toBe(false);
    expect(fire(document.createElement('button'))).toBe(false);
    expect(fire(document.createElement('div'))).toBe(false);
  });
});
