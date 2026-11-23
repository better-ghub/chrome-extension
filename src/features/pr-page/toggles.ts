// Better GHub - PR page: Toggle adapters for every collapsible thing on a PR.
//
// One small factory per GitHub widget, each reporting its current state and
// knowing how to flip it. Bulk actions and thread navigation share them.

import type { PRTab } from '../../core/page';
import { ariaExpanded, expandedFromLabel, labelText, outermost, ownDescendant, queryAll, queryFirst, SEL } from './dom-queries';
import { nonNull, normalizeToggles, type Toggle } from './toggle-state';

/** Conversation tab <review-thread-collapsible>, flipped through its own button. */
export function collapsibleToggle(el: Element): Toggle | null {
  if (!el.matches(SEL.threadCollapsible)) return null;
  const btn =
    ownDescendant(el, SEL.threadCollapsibleButton, SEL.threadCollapsible) ??
    ownDescendant(el, SEL.plainDisclosureButton, SEL.threadCollapsible);
  if (!btn) return null;
  return { el, expanded: ariaExpanded(btn) ?? el.classList.contains('open'), set: () => btn.click() };
}

/** Legacy <details> threads / outdated-diff wrappers. Setting `.open` also fires GitHub's `toggle` handlers. */
export function detailsToggle(el: Element): Toggle | null {
  if (!(el instanceof HTMLDetailsElement)) return null;
  return {
    el,
    expanded: el.open,
    set: (open) => {
      el.open = open;
    },
  };
}

/** React thread: aria-expanded on its collapse button, else the button's "Collapse…/Expand…" label. */
export function reactThreadToggle(el: Element): Toggle | null {
  if (!el.matches(SEL.reactThread)) return null;
  const btn = el.querySelector<HTMLElement>(SEL.reactThreadToggle) ?? el.querySelector<HTMLElement>(SEL.plainDisclosureButton);
  if (!btn) return null;
  const expanded = ariaExpanded(btn) ?? expandedFromLabel(btn);
  return expanded === null ? null : { el, expanded, set: () => btn.click() };
}

/** Classic Files tab "Show comments" checkbox; comments shown ⇔ `.js-file.show-inline-notes`. */
export function fileNotesToggle(file: Element): Toggle | null {
  const input = file.querySelector<HTMLInputElement>(SEL.classicFileNotesToggle);
  if (!input) return null;
  return {
    el: file,
    expanded: file.classList.contains('show-inline-notes'),
    set: (show) => {
      // click() fires click + input + change, whichever GitHub listens to. If
      // the checkbox already matches, re-dispatch change so the class syncs.
      if (input.checked !== show) input.click();
      else input.dispatchEvent(new Event('change', { bubbles: true }));
    },
  };
}

/** Classic Files tab file: header chevron flips `open`/`Details--on` and keeps aria-expanded in sync. */
export function classicFileToggle(file: Element): Toggle | null {
  const btn = queryFirst(file, SEL.classicFileToggle);
  if (!btn) return null;
  const expanded = ariaExpanded(btn) ?? (file.classList.contains('open') || file.classList.contains('Details--on'));
  return { el: file, expanded, set: () => btn.click() };
}

const FILE_TOGGLE_LABEL = /\b(collapse|expand) file\b|toggle diff/i;

/** React Files changed header: icon button labelled "Collapse file"/"Expand file" (often via a tooltip). */
export function reactFileToggle(header: Element): Toggle | null {
  const buttons = Array.from(header.querySelectorAll<HTMLElement>('button'));
  const btn = buttons.find((b) => FILE_TOGGLE_LABEL.test(labelText(b))) ?? buttons.find((b) => b.matches(SEL.plainDisclosureButton));
  if (!btn) return null;
  const expanded = ariaExpanded(btn) ?? expandedFromLabel(btn);
  if (expanded === null) return null;
  // The header is sticky, so anchor scrolling on the file container instead.
  return { el: header.closest('[id^="diff-"]') ?? header.parentElement ?? header, expanded, set: () => btn.click() };
}

function collect(els: Element[], factory: (el: Element) => Toggle | null): Toggle[] {
  return els.map(factory).filter(nonNull);
}

/**
 * Comment toggles for the current tab. Files tab: per-file "Show comments"
 * (only files that actually have inline comments) + React threads.
 * Conversation: Catalyst threads, legacy <details>, React threads.
 */
export function collectCommentToggles(root: ParentNode, tab: PRTab | undefined): Toggle[] {
  const react = collect(outermost(queryAll(root, SEL.reactThread)), reactThreadToggle);
  if (tab === 'files') {
    const files = queryAll(root, SEL.classicFile).filter((f) => f.querySelector(SEL.classicFileNotesToggle));
    const commented = files.filter((f) => f.querySelector(SEL.classicInlineComments));
    return normalizeToggles([...collect(commented.length ? commented : files, fileNotesToggle), ...react]);
  }
  return normalizeToggles([
    ...collect(queryAll(root, SEL.threadCollapsible), collapsibleToggle),
    ...collect(queryAll(root, SEL.legacyThreadDetails), detailsToggle),
    ...react,
  ]);
}

export function collectFileToggles(root: ParentNode): Toggle[] {
  return normalizeToggles([
    ...collect(queryAll(root, SEL.classicFile), classicFileToggle),
    ...collect(outermost(queryAll(root, SEL.reactFileHeader)), reactFileToggle),
  ]);
}

/** Make a (possibly hidden or collapsed) thread visible: its file, comment layer, wrappers and itself. */
export function revealThread(thread: Element): void {
  const expand = (tg: Toggle | null): void => {
    if (tg && !tg.expanded) tg.set(true);
  };
  const file = thread.closest(SEL.classicFile);
  if (file) {
    expand(classicFileToggle(file));
    expand(fileNotesToggle(file));
  }
  for (let d = thread.closest('details'); d; d = d.parentElement?.closest('details') ?? null) {
    if (d.matches(SEL.legacyThreadDetails)) expand(detailsToggle(d));
  }
  expand(collapsibleToggle(thread) ?? reactThreadToggle(thread));
}
