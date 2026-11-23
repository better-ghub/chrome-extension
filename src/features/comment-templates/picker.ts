// Better GHub - Comment templates: the picker popover.
//
// A modal <dialog> (top layer, so GitHub's own overlays cannot cover it)
// positioned next to the textarea, with a combobox filter and a listbox.
// Focus stays in the filter input; the highlighted option is exposed through
// aria-activedescendant. Closing returns focus to the textarea.

import { h } from '../../core/dom';
import { icon } from '../../core/icons';
import { t } from '../../i18n';
import { insertText } from './insert';
import { buildEntries, placePopover, rankEntries, type TemplateEntry, type TemplateMatch } from './model';
import type { CommentSnippet } from '../../core/settings';

export interface PickerSource {
  snippets: readonly CommentSnippet[];
  conventional: boolean;
}

export interface TemplatePicker {
  open(textarea: HTMLTextAreaElement, source: PickerSource): void;
  close(): void;
  isOpen(): boolean;
}

let uid = 0;

function highlighted(text: string, positions: readonly number[]): Node[] {
  const hit = new Set(positions);
  const nodes: Node[] = [];
  let run = '';
  let runHit = false;
  const flush = (): void => {
    if (run) nodes.push(runHit ? h('mark', { class: 'bghub-ff-mark', text: run }) : document.createTextNode(run));
    run = '';
  };
  [...text].forEach((ch, i) => {
    const isHit = hit.has(i);
    if (isHit !== runHit) flush();
    runHit = isHit;
    run += ch;
  });
  flush();
  return nodes;
}

/** One-line preview of a snippet body. */
function preview(body: string): string {
  return body.replace(/\s+/g, ' ').trim().slice(0, 120);
}

export function createTemplatePicker({ signal }: { signal: AbortSignal }): TemplatePicker {
  const id = `bghub-ct-${++uid}`;
  const listId = `${id}-list`;
  const label = t('commentPickerLabel', 'Insert a comment template');

  let entries: TemplateEntry[] = [];
  let matches: TemplateMatch[] = [];
  let active = 0;
  let target: HTMLTextAreaElement | null = null;
  let caret = { start: 0, end: 0 };

  const input = h('input', {
    class: 'bghub-ff-input',
    attrs: {
      type: 'text',
      role: 'combobox',
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-expanded': 'true',
      'aria-controls': listId,
      'aria-autocomplete': 'list',
      'aria-label': label,
      placeholder: t('commentPickerPlaceholder', 'Filter templates…'),
    },
  });
  const list = h('ul', { class: 'bghub-ff-list', attrs: { id: listId, role: 'listbox', 'aria-label': t('commentPickerResults', 'Templates') } });
  const empty = h('p', { class: 'bghub-ff-empty', attrs: { hidden: true } });
  const dialog = h(
    'dialog',
    { class: 'bghub-cheatsheet bghub-finder bghub-ct', attrs: { 'aria-label': label, 'data-bghub': '' } },
    h('div', { class: 'bghub-ff-search' }, icon('comment', 16), input),
    h('div', { class: 'bghub-ff-body' }, list, empty)
  );
  const isOpen = (): boolean => dialog.hasAttribute('open');
  const optionId = (i: number): string => `${id}-opt-${i}`;

  const close = (): void => {
    if (!isOpen()) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  };

  const setActive = (i: number, scroll = true): void => {
    if (!matches.length) {
      active = 0;
      input.removeAttribute('aria-activedescendant');
      return;
    }
    active = (i + matches.length) % matches.length;
    list.querySelectorAll('[role="option"]').forEach((el, idx) => el.setAttribute('aria-selected', String(idx === active)));
    input.setAttribute('aria-activedescendant', optionId(active));
    const el = list.children[active];
    if (scroll && el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  };

  const choose = (m: TemplateMatch | undefined): void => {
    if (!m || !target) return;
    const ta = target;
    close();
    insertText(ta, m.entry.text, caret);
  };

  const render = (): void => {
    matches = rankEntries(input.value.trim(), entries);
    list.replaceChildren(
      ...matches.map((m, i) => {
        const e = m.entry;
        const hint = e.kind === 'label' ? t(e.hintKey ?? '', e.hint ?? '') : preview(e.text);
        return h(
          'li',
          {
            class: 'bghub-ff-option bghub-ct-option',
            attrs: { id: optionId(i), role: 'option', 'aria-selected': 'false' },
            // mousedown keeps the filter input focused until the click lands.
            on: { click: () => choose(m), mousemove: () => active !== i && setActive(i, false) },
          },
          h('span', { class: 'bghub-ct-title' }, highlighted(e.title, m.positions)),
          h('span', { class: 'bghub-ct-hint', text: hint }),
          e.kind === 'snippet' ? h('span', { class: 'bghub-chip bghub-ct-chip', text: t('commentPickerSnippet', 'Snippet') }) : null
        );
      })
    );
    empty.textContent = entries.length
      ? t('commentPickerNoMatch', 'No matching templates')
      : t('commentPickerNone', 'No templates yet. Add snippets in the extension options.');
    empty.hidden = matches.length > 0;
    setActive(0, false);
  };

  input.addEventListener('input', render, { signal });
  dialog.addEventListener(
    'keydown',
    (e) => {
      // Nothing typed here may reach GitHub's own hotkeys.
      e.stopPropagation();
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          return setActive(active + 1);
        case 'ArrowUp':
          e.preventDefault();
          return setActive(active - 1);
        case 'Enter':
          if (e.isComposing) return;
          e.preventDefault();
          return choose(matches[active]);
        case 'Tab':
          e.preventDefault();
          return;
      }
    },
    { signal }
  );
  // Closing (Esc, backdrop, programmatic) always hands focus back to the textarea.
  dialog.addEventListener(
    'close',
    () => {
      const ta = target;
      if (ta?.isConnected) ta.focus({ preventScroll: true });
    },
    { signal }
  );
  dialog.addEventListener(
    'click',
    (e) => {
      if (e.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
    },
    { signal }
  );
  window.addEventListener('popstate', close, { signal });
  window.addEventListener('resize', close, { signal });
  signal.addEventListener(
    'abort',
    () => {
      close();
      setTimeout(() => dialog.remove(), 250);
    },
    { once: true }
  );

  const place = (anchor: HTMLTextAreaElement): void => {
    const r = anchor.getBoundingClientRect();
    const d = dialog.getBoundingClientRect();
    const pos = placePopover(
      { left: r.left, top: r.top, width: r.width, height: r.height },
      { width: d.width, height: d.height },
      { width: window.innerWidth, height: window.innerHeight }
    );
    dialog.style.left = `${Math.round(pos.left)}px`;
    dialog.style.top = `${Math.round(pos.top)}px`;
  };

  const open = (textarea: HTMLTextAreaElement, source: PickerSource): void => {
    if (signal.aborted || isOpen()) return;
    target = textarea;
    caret = { start: textarea.selectionStart, end: textarea.selectionEnd };
    entries = buildEntries(source.snippets, source.conventional);
    input.value = '';
    render();
    if (!dialog.isConnected) document.documentElement.append(dialog);
    try {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } catch {
      dialog.setAttribute('open', '');
    }
    place(textarea);
    input.focus({ preventScroll: true });
  };

  return { open, close, isOpen };
}
