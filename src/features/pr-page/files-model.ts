// Better GHub - PR page: one adapter for "a file in the diff", across UI generations.
//
// Generated-file collapsing, review progress and next-unviewed navigation all
// need the same facts about each file: its path, its container, its
// collapse toggle and its "Viewed" control. They are gathered here once.

import { labelText, outermost, queryAll, SEL, sortByDocumentOrder } from './dom-queries';
import type { Toggle } from './toggle-state';
import { classicFileToggle, reactFileToggle } from './toggles';

export interface ViewedControl {
  checked: boolean;
  /** Bring the control to `checked` (clicks it only when the state differs). */
  set(checked: boolean): void;
}

export interface DiffFile {
  /** The whole file (scroll target, document order). */
  el: HTMLElement;
  header: HTMLElement | null;
  /** Full path ('' when it can't be read yet). */
  path: string;
  toggle: Toggle | null;
  /** null when GitHub renders no "Viewed" control (logged-out users). */
  viewed: ViewedControl | null;
}

/** Bidi marks: the React header wraps paths in U+200E etc. so mixed-direction names render correctly. */
const BIDI_MARKS = /[‎‏‪-‮⁦-⁩]/g;

/** "old/name.ts → new/name.ts" (renames) → the new path; strips bidi marks and whitespace. */
export function cleanPath(raw: string): string {
  const text = raw.replace(BIDI_MARKS, '').replace(/\s+/g, ' ').trim();
  const arrow = text.lastIndexOf('→');
  return (arrow === -1 ? text : text.slice(arrow + 1)).trim();
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1) || path;
}

function inputControl(input: HTMLInputElement): ViewedControl {
  return {
    checked: input.checked,
    set: (checked) => {
      // click() fires click + input + change: GitHub's form handler submits on change.
      if (input.checked !== checked) input.click();
    },
  };
}

/**
 * React header "Viewed" control (best-effort): a checkbox or a toggle button
 * labelled "Viewed", state in `checked` / aria-pressed / aria-checked.
 */
function reactViewed(header: Element): ViewedControl | null {
  const input = Array.from(header.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find(
    (i) => i.matches(SEL.classicViewedCheckbox) || /\bviewed\b/i.test(labelText(i.closest('label') ?? i))
  );
  if (input) return inputControl(input);
  const btn = Array.from(header.querySelectorAll<HTMLElement>('button[aria-pressed], [role="checkbox"][aria-checked]')).find((b) =>
    /\bviewed\b/i.test(labelText(b))
  );
  if (!btn) return null;
  const state = (): boolean => (btn.getAttribute('aria-pressed') ?? btn.getAttribute('aria-checked')) === 'true';
  return {
    checked: state(),
    set: (checked) => {
      if (state() !== checked) btn.click();
    },
  };
}

/** Path shown in a React header: data-path, else the file-name link/heading text, else a path-like title. */
export function reactHeaderPath(header: Element): string {
  const data = header.querySelector('[data-path]')?.getAttribute('data-path');
  if (data) return cleanPath(data);
  const named = header.querySelector('h3 a, h3 code, h3, [class*="file-name"], [class*="FileName"], a[href*="#diff-"]');
  const text = named ? cleanPath(named.getAttribute('title') || named.textContent || '') : '';
  if (text) return text;
  const titled = Array.from(header.querySelectorAll('[title]')).map((el) => cleanPath(el.getAttribute('title') ?? ''));
  return titled.find((p) => /^[^\s]+$/.test(p) && /[./]/.test(p)) ?? '';
}

function classicFile(el: HTMLElement): DiffFile {
  const header = el.querySelector<HTMLElement>(SEL.classicFileHeader);
  const path = cleanPath(el.getAttribute('data-tagsearch-path') || header?.getAttribute('data-path') || '');
  const input = (header ?? el).querySelector<HTMLInputElement>(SEL.classicViewedCheckbox);
  return { el, header, path, toggle: classicFileToggle(el), viewed: input ? inputControl(input) : null };
}

function reactFile(header: HTMLElement): DiffFile {
  const el = header.closest<HTMLElement>('[id^="diff-"]') ?? header.parentElement ?? header;
  return { el, header, path: reactHeaderPath(header), toggle: reactFileToggle(header), viewed: reactViewed(header) };
}

/** Every file of the diff currently in the DOM, in document order. */
export function collectDiffFiles(root: ParentNode = document): DiffFile[] {
  const classic = outermost(queryAll(root, SEL.classicFile)).map(classicFile);
  const react = outermost(queryAll(root, SEL.reactFileHeader)).map(reactFile);
  // One generation per page in practice; each list is already in document order.
  if (!classic.length || !react.length) return classic.length ? classic : react;
  const byEl = new Map<Element, DiffFile>();
  for (const f of [...classic, ...react]) if (!byEl.has(f.el)) byEl.set(f.el, f);
  return sortByDocumentOrder([...byEl.keys()]).map((el) => byEl.get(el) as DiffFile);
}

/** Rendered (not filtered out / display:none)? */
export function isRendered(el: Element): boolean {
  return el.getClientRects().length > 0;
}
