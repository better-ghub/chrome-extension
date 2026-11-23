// Better GHub - Options: keyboard shortcut editor.
//
// Each action has one key-cap button. Clicking it records on THAT button only
// (no document-level listeners), driven by the pure ShortcutRecorder.

import { h } from '../src/core/dom';
import { icon } from '../src/core/icons';
import { t } from '../src/i18n';
import {
  bindingsEqual,
  conflictKind,
  defaultBindings,
  findDuplicates,
  formatBinding,
  getDefinition,
  isMacPlatform,
  normalizeBindings,
  saveBindings,
  SHORTCUT_ACTIONS,
  SHORTCUT_DEFINITIONS,
  type ShortcutAction,
  type ShortcutBinding,
  type ShortcutBindings,
  type ShortcutDefinition,
  type ShortcutScope,
} from '../src/shortcuts';
import { announce, attachInlineConfirm, keyCaps, SavedIndicator, uid } from '../src/pages/dom-ui';
import { applyBinding, ShortcutRecorder, type RecorderOutcome } from '../src/pages/recorder';

type Group = ShortcutDefinition['group'];

interface RowMessage {
  tone: 'error' | 'warning' | 'help';
  text: string;
  /** Pending duplicate: offer to take the combination from the other action(s). */
  replace?: { binding: ShortcutBinding; conflicts: ShortcutAction[] };
}

interface Row {
  def: ShortcutDefinition;
  li: HTMLLIElement;
  labelId: string;
  key: HTMLButtonElement;
  reset: HTMLButtonElement;
  message: HTMLElement;
  saved: SavedIndicator;
  /** Physical keys currently held while the key-cap has focus. */
  held: Set<string>;
  transient: RowMessage | null;
}

function label(def: ShortcutDefinition): string {
  return t(def.labelKey, def.label);
}

function groupTitle(group: Group): string {
  switch (group) {
    case 'view':
      return t('scGroupView', 'View');
    case 'navigate':
      return t('scGroupNavigate', 'Navigate');
    case 'copy':
      return t('scGroupCopy', 'Copy');
    case 'compose':
      return t('scGroupCompose', 'Write');
    case 'help':
      return t('scGroupHelp', 'Help');
  }
}

function scopeLabel(scope: ShortcutScope): string {
  switch (scope) {
    case 'conversation':
      return t('scScopeConversation', 'Conversation');
    case 'files':
      return t('scScopeFiles', 'Files changed');
    case 'pr':
      return t('scScopePr', 'Any PR tab');
  }
}

function quoted(text: string): string {
  return t('commonQuoted', '“$1”', text);
}

export class ShortcutsView {
  readonly el: HTMLElement;
  private bindings: ShortcutBindings;
  private readonly recorder = new ShortcutRecorder();
  private rows = new Map<ShortcutAction, Row>();
  private resetAll: HTMLButtonElement | null = null;
  private footStatus = new SavedIndicator();
  private readonly mac = isMacPlatform();
  private enabled = true;

  constructor(rawBindings: unknown) {
    this.bindings = normalizeBindings(rawBindings);
    this.el = h('div', { class: 'shortcut-editor' });
    this.render();
  }

  /** Re-render everything (e.g. after a language change). */
  render(): void {
    this.recorder.stop();
    this.rows.clear();
    const groups: Group[] = ['view', 'navigate', 'copy', 'compose', 'help'];
    const hintId = uid('sc-hint');
    const nodes = groups.map((group) => {
      const defs = SHORTCUT_DEFINITIONS.filter((d) => d.group === group);
      const titleId = uid('sc-group');
      return h(
        'div',
        { class: 'sc-group' },
        h('h3', { class: 'sc-group-title', attrs: { id: titleId }, text: groupTitle(group) }),
        h(
          'ul',
          { class: 'card sc-list list-reset', attrs: { role: 'list', 'aria-labelledby': titleId } },
          defs.map((def) => this.buildRow(def, hintId))
        )
      );
    });

    this.resetAll = h(
      'button',
      { class: 'btn btn-sm', attrs: { type: 'button' } },
      icon('history', 16),
      h('span', { class: 'btn-label', text: t('scResetAll', 'Reset all to defaults') })
    );
    attachInlineConfirm(this.resetAll, {
      question: t('scResetAllQuestion', 'Reset every shortcut?'),
      confirmLabel: t('scResetAllConfirm', 'Reset all'),
      onConfirm: async () => {
        const ok = await this.save(defaultBindings());
        if (!ok) return false;
        for (const row of this.rows.values()) row.transient = null;
        this.refreshAll();
        this.footStatus.flash(t('scResetAllDone', 'All shortcuts reset'));
        return true;
      },
    });

    this.el.replaceChildren(
      h(
        'div',
        { class: 'sc-intro' },
        h('p', {
          class: 'field-hint',
          attrs: { id: hintId },
          text: t('scHint', 'Click a shortcut to change it. Combinations need Ctrl, Alt or ⌘ so they never fire while you type.'),
        }),
        h('p', { class: 'sc-off-note notice', attrs: { hidden: true } }, icon('info', 16), h('span', {
          text: t('scOffNote', 'Shortcuts are turned off. Your changes apply when you turn them back on.'),
        }))
      ),
      ...nodes,
      h('div', { class: 'sc-foot' }, this.footStatus.el, this.resetAll)
    );
    this.refreshAll();
    this.setEnabled(this.enabled);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.el.classList.toggle('is-off', !enabled);
    const note = this.el.querySelector<HTMLElement>('.sc-off-note');
    if (note) note.hidden = enabled;
  }

  /** Storage changed (possibly from another page): adopt unless identical. */
  sync(rawBindings: unknown): void {
    const next = normalizeBindings(rawBindings);
    if (SHORTCUT_ACTIONS.every((a) => bindingsEqual(next[a], this.bindings[a]))) return;
    this.bindings = next;
    if (!this.recorder.recording) this.refreshAll();
  }

  // --------------------------------------------------------------- rows

  private buildRow(def: ShortcutDefinition, hintId: string): HTMLLIElement {
    const labelId = uid('sc-label');
    const messageId = uid('sc-msg');
    const key = h('button', {
      class: 'keycap-btn',
      attrs: { type: 'button', 'aria-pressed': 'false', 'aria-describedby': `${messageId} ${hintId}` },
    });
    const reset = h(
      'button',
      { class: 'btn btn-ghost btn-icon btn-sm sc-reset', attrs: { type: 'button', 'data-tooltip-align': 'end' } },
      icon('history', 16)
    );
    const message = h('div', { class: 'sc-message', attrs: { id: messageId } });
    const saved = new SavedIndicator();
    const li = h(
      'li',
      { class: 'sc-row', dataset: { action: def.action } },
      h(
        'div',
        { class: 'sc-main' },
        h('span', { class: 'sc-label', attrs: { id: labelId }, text: label(def) }),
        h(
          'span',
          { class: 'sc-scopes' },
          def.scope.map((s) => h('span', { class: 'scope-tag', text: scopeLabel(s) }))
        )
      ),
      h('div', { class: 'sc-controls' }, saved.el, reset, key),
      message
    );
    const row: Row = { def, li, labelId, key, reset, message, saved, held: new Set(), transient: null };
    this.rows.set(def.action, row);

    key.addEventListener('click', (e) => this.onKeyClick(row, e));
    key.addEventListener('keydown', (e) => this.onKeyDown(row, e));
    key.addEventListener('keyup', (e) => {
      row.held.delete(e.code);
      this.recorder.keyup(e.code);
    });
    key.addEventListener('blur', () => {
      row.held.clear();
      if (this.recorder.action === def.action) {
        this.recorder.stop();
        this.refreshRow(row);
      }
    });
    reset.addEventListener('click', () => void this.resetRow(row));
    return li;
  }

  private onKeyClick(row: Row, e: MouseEvent): void {
    const action = row.def.action;
    if (this.recorder.action === action) {
      // Second click toggles recording off.
      this.recorder.stop();
      this.refreshRow(row);
      announce(t('scCancelled', 'Recording cancelled'));
      return;
    }
    const previous = this.recorder.action;
    // Keyboard activation (detail 0): ignore the Enter/Space that is still held.
    this.recorder.start(action, e.detail === 0 ? row.held : []);
    if (previous) {
      const prevRow = this.rows.get(previous);
      if (prevRow) this.refreshRow(prevRow);
    }
    row.transient = {
      tone: 'help',
      text: t('scRecordingHelp', 'Press a combination · Esc cancels · Backspace clears'),
    };
    this.refreshRow(row);
    announce(t('scRecordingAnnouncement', 'Recording shortcut for $1. Press a key combination, Escape to cancel, Backspace to clear.', label(row.def)));
  }

  private onKeyDown(row: Row, e: KeyboardEvent): void {
    if (this.recorder.action !== row.def.action) {
      if (e.code) row.held.add(e.code);
      return;
    }
    const outcome = this.recorder.keydown(e, this.bindings);
    if (!(outcome.type === 'cancel' && outcome.reason === 'tab')) {
      // While recording, keys belong to the recorder (no page scroll, no button re-activation).
      e.preventDefault();
      e.stopPropagation();
    }
    void this.handleOutcome(row, outcome);
  }

  private async handleOutcome(row: Row, outcome: RecorderOutcome): Promise<void> {
    switch (outcome.type) {
      case 'ignore':
        return;
      case 'cancel':
        row.transient = null;
        this.refreshRow(row);
        if (outcome.reason === 'escape') announce(t('scCancelled', 'Recording cancelled'));
        return;
      case 'invalid':
        row.transient = {
          tone: 'error',
          text: t('scNeedsModifier', 'Add Ctrl, Alt or ⌘. Single keys would fire while you type and clash with GitHub’s own shortcuts.'),
        };
        this.refreshRow(row);
        announce(row.transient.text);
        return;
      case 'clear':
        await this.commit(row, null, [], t('scRemoved', 'Removed'));
        return;
      case 'duplicate': {
        const names = outcome.conflicts.map((a) => quoted(label(getDefinition(a)))).join(', ');
        row.transient = {
          tone: 'error',
          text: t('scDuplicate', '$1 is already used by $2.', [formatBinding(outcome.binding, this.mac), names]),
          replace: { binding: outcome.binding, conflicts: outcome.conflicts },
        };
        this.refreshRow(row);
        announce(row.transient.text);
        return;
      }
      case 'commit':
        await this.commit(row, outcome.binding, []);
        return;
    }
  }

  private async commit(row: Row, binding: ShortcutBinding | null, unbind: ShortcutAction[], savedText?: string): Promise<void> {
    const next = applyBinding(this.bindings, row.def.action, binding, unbind);
    const ok = await this.save(next);
    row.transient = ok ? null : { tone: 'error', text: t('commonSaveFailed', 'Couldn’t save') };
    this.refreshAll();
    if (!ok) return;
    row.saved.flash(savedText ?? t('commonSaved', 'Saved'));
    for (const other of unbind) {
      const r = this.rows.get(other);
      if (r) r.saved.flash(t('scRemoved', 'Removed'));
    }
    announce(
      binding
        ? t('scSavedAnnouncement', '$1 is now $2', [label(row.def), formatBinding(binding, this.mac)])
        : t('scClearedAnnouncement', '$1 has no shortcut', label(row.def))
    );
  }

  private async resetRow(row: Row): Promise<void> {
    const def = row.def.defaultBinding;
    const conflicts = findDuplicates({ ...this.bindings, [row.def.action]: def }, row.def.action);
    if (conflicts.length) {
      await this.handleOutcome(row, { type: 'duplicate', action: row.def.action, binding: def, conflicts });
      row.key.focus();
      return;
    }
    await this.commit(row, { ...def }, [], t('scResetDone', 'Reset'));
    row.key.focus();
  }

  private async save(next: ShortcutBindings): Promise<boolean> {
    try {
      await saveBindings(next);
      this.bindings = next;
      return true;
    } catch {
      return false;
    }
  }

  private refreshAll(): void {
    for (const row of this.rows.values()) this.refreshRow(row);
    if (this.resetAll) {
      const allDefault = SHORTCUT_DEFINITIONS.every((d) => bindingsEqual(this.bindings[d.action], d.defaultBinding));
      this.resetAll.disabled = allDefault;
    }
  }

  /** Persistent per-row problems derived from the saved bindings. */
  private derivedMessage(action: ShortcutAction): RowMessage | null {
    const binding = this.bindings[action];
    if (!binding) return null;
    const dups = findDuplicates(this.bindings, action);
    if (dups.length) {
      return {
        tone: 'error',
        text: t('scAlsoUsedBy', 'Also used by $1. Only one of them will work.', dups.map((a) => quoted(label(getDefinition(a)))).join(', ')),
      };
    }
    const kind = conflictKind(binding);
    if (kind === 'browser') return { tone: 'warning', text: t('scBrowserConflict', 'Your browser may already use this combination.') };
    if (kind === 'typing') return { tone: 'warning', text: t('scTypingConflict', 'Without Ctrl, Alt or ⌘ this can clash with GitHub’s own shortcuts.') };
    return null;
  }

  private refreshRow(row: Row): void {
    const action = row.def.action;
    const binding = this.bindings[action];
    const recording = this.recorder.action === action;
    const name = label(row.def);

    // Key cap
    row.key.classList.toggle('is-recording', recording);
    row.key.setAttribute('aria-pressed', String(recording));
    if (recording) {
      row.key.replaceChildren(h('span', { class: 'keycap-prompt', text: t('scPressKeys', 'Press keys…') }));
      row.key.setAttribute('aria-label', t('scRecordingLabel', 'Recording shortcut for $1', name));
    } else if (binding) {
      row.key.replaceChildren(keyCaps(binding, this.mac));
      row.key.setAttribute('aria-label', t('scKeyLabel', '$1: $2', [name, formatBinding(binding, this.mac)]));
    } else {
      row.key.replaceChildren(h('span', { class: 'keycap-empty', text: t('scNotSet', 'Not set') }));
      row.key.setAttribute('aria-label', t('scKeyLabelUnset', '$1: not set', name));
    }

    // Reset (only when different from the default)
    const isDefault = bindingsEqual(binding, row.def.defaultBinding);
    row.reset.hidden = isDefault || recording;
    const resetLabel = t('scResetRow', 'Reset to $1', formatBinding(row.def.defaultBinding, this.mac));
    row.reset.setAttribute('aria-label', `${resetLabel} (${name})`);
    row.reset.setAttribute('data-tooltip', resetLabel);

    // Message
    // Help text only makes sense while recording; errors persist until resolved.
    const pending = row.transient?.tone === 'help' ? null : row.transient;
    const msg = recording ? row.transient : pending ?? this.derivedMessage(action);
    const invalid = msg?.tone === 'error';
    row.li.classList.toggle('has-error', invalid);
    row.li.classList.toggle('is-recording', recording);
    if (invalid) row.key.setAttribute('aria-invalid', 'true');
    else row.key.removeAttribute('aria-invalid');

    if (!msg) {
      row.message.replaceChildren();
      row.message.hidden = true;
      return;
    }
    row.message.hidden = false;
    row.message.dataset.tone = msg.tone;
    const glyph = msg.tone === 'help' ? icon('info', 14) : icon('alert', 14);
    const children: (Node | string)[] = [];
    if (glyph) children.push(glyph);
    children.push(h('span', { class: 'sc-message-text', text: msg.text }));
    if (msg.replace) {
      const { binding: wanted, conflicts } = msg.replace;
      const replace = h(
        'button',
        { class: 'btn btn-sm sc-replace', attrs: { type: 'button' } },
        t('scReplace', 'Use it here instead')
      );
      replace.addEventListener('click', async () => {
        await this.commit(row, wanted, conflicts);
        row.key.focus();
      });
      const dismiss = h('button', { class: 'btn btn-sm btn-ghost', attrs: { type: 'button' } }, t('commonCancel', 'Cancel'));
      dismiss.addEventListener('click', () => {
        row.transient = null;
        this.refreshRow(row);
        row.key.focus();
      });
      children.push(h('span', { class: 'sc-message-actions' }, replace, dismiss));
    }
    row.message.replaceChildren(...children);
  }
}
