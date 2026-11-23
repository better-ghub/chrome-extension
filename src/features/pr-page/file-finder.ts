// Better GHub - PR page: file finder (fuzzy "go to file" for the diff).
//
// A modal <dialog> (top layer) with a combobox input and a listbox of the
// changed files. Focus stays in the input; the highlighted option is exposed
// through aria-activedescendant.

import { matchesGenerated } from '../../core/generated-patterns';
import { h } from '../../core/dom';
import { icon } from '../../core/icons';
import { liveSettings } from '../../content/state';
import { t } from '../../i18n';
import { createHighlighter, scrollToElement } from './actions/scroll';
import { collectDiffFiles } from './files-model';
import { rankFiles, type FinderFile, type FinderMatch } from './file-finder-model';

export interface FileFinder {
  /** Opens the finder; false when the diff has no files to list. */
  open(): boolean;
  close(): void;
  isOpen(): boolean;
}

let uid = 0;

/** Changed files currently in the DOM, with their "generated" flag. */
export function finderFiles(patterns: readonly string[] = liveSettings().generatedPatterns): FinderFile[] {
  return collectDiffFiles(document)
    .filter((f) => f.path)
    .map((f) => ({ path: f.path, generated: matchesGenerated(f.path, patterns) }));
}

/** Path text with matched characters wrapped in <mark>. */
function highlighted(path: string, positions: readonly number[]): Node[] {
  const hit = new Set(positions);
  const nodes: Node[] = [];
  let run = '';
  let runHit = false;
  const flush = (): void => {
    if (run) nodes.push(runHit ? h('mark', { class: 'bghub-ff-mark', text: run }) : document.createTextNode(run));
    run = '';
  };
  [...path].forEach((ch, i) => {
    const isHit = hit.has(i);
    if (isHit !== runHit) flush();
    runHit = isHit;
    run += ch;
  });
  flush();
  return nodes;
}

export function createFileFinder({ signal }: { signal: AbortSignal }): FileFinder {
  const id = `bghub-ff-${++uid}`;
  const listId = `${id}-list`;
  const highlighter = createHighlighter('bghub-file-focus', 1600, signal);

  let files: FinderFile[] = [];
  let matches: FinderMatch[] = [];
  let active = 0;

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
      'aria-label': t('prPageFinderLabel', 'Find a changed file'),
      placeholder: t('prPageFinderPlaceholder', 'Find a changed file…'),
    },
  });
  const list = h('ul', { class: 'bghub-ff-list', attrs: { id: listId, role: 'listbox', 'aria-label': t('prPageFinderResults', 'Changed files') } });
  const empty = h('p', { class: 'bghub-ff-empty', attrs: { hidden: true }, text: t('prPageFinderEmpty', 'No matching files') });
  const dialog = h(
    'dialog',
    { class: 'bghub-cheatsheet bghub-finder', attrs: { 'aria-label': t('prPageFinderLabel', 'Find a changed file'), 'data-bghub': '' } },
    h('div', { class: 'bghub-ff-search' }, icon('search', 16), input),
    h('div', { class: 'bghub-ff-body' }, list, empty)
  );
  const isOpen = (): boolean => dialog.hasAttribute('open');

  const close = (): void => {
    if (!isOpen()) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  };

  const optionId = (i: number): string => `${id}-opt-${i}`;

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

  const choose = (m: FinderMatch | undefined): void => {
    if (!m) return;
    close();
    // After the dialog closed and focus was restored.
    requestAnimationFrame(() => revealFile(m.file.path));
  };

  const revealFile = (path: string): void => {
    const file = collectDiffFiles(document).find((f) => f.path === path);
    if (!file) return;
    if (file.toggle && !file.toggle.expanded) file.toggle.set(true);
    scrollToElement(file.el);
    highlighter.light(file.el);
  };

  const render = (): void => {
    matches = rankFiles(input.value, files);
    list.replaceChildren(
      ...matches.map((m, i) =>
        h(
          'li',
          {
            class: 'bghub-ff-option',
            attrs: { id: optionId(i), role: 'option', 'aria-selected': 'false', title: m.file.path },
            on: { click: () => choose(m), mousemove: () => active !== i && setActive(i, false) },
          },
          h('span', { class: 'bghub-ff-icon' }, icon('file', 16)),
          h('span', { class: 'bghub-ff-path' }, h('bdi', { attrs: { dir: 'ltr' } }, highlighted(m.file.path, m.positions))),
          m.file.generated ? h('span', { class: 'bghub-chip bghub-chip--attention bghub-ff-generated', text: t('prPageFinderGenerated', 'Generated') }) : null
        )
      )
    );
    empty.hidden = matches.length > 0;
    setActive(0, false);
  };

  input.addEventListener('input', render, { signal });
  input.addEventListener(
    'keydown',
    (e) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          return setActive(active + 1);
        case 'ArrowUp':
          e.preventDefault();
          return setActive(active - 1);
        case 'Home':
          if (!input.value) {
            e.preventDefault();
            setActive(0);
          }
          return;
        case 'End':
          if (!input.value) {
            e.preventDefault();
            setActive(matches.length - 1);
          }
          return;
        case 'Enter':
          if (e.isComposing) return;
          e.preventDefault();
          return choose(matches[active]);
      }
    },
    { signal }
  );

  // Backdrop click closes (clicks on ::backdrop are dispatched to the dialog itself).
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
  signal.addEventListener(
    'abort',
    () => {
      close();
      setTimeout(() => dialog.remove(), 250);
    },
    { once: true }
  );

  const open = (): boolean => {
    if (signal.aborted) return false;
    if (isOpen()) return true;
    files = finderFiles();
    if (!files.length) return false;
    input.value = '';
    render();
    if (!dialog.isConnected) document.documentElement.append(dialog);
    try {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } catch {
      dialog.setAttribute('open', '');
    }
    input.focus({ preventScroll: true });
    return true;
  };

  return { open, close, isOpen };
}
