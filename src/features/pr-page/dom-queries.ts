// Better GHub - PR page: GitHub DOM selectors and small query helpers.
//
// GitHub serves two generations of PR UI side by side:
//  * classic server-rendered markup (Catalyst custom elements + `js-*` hooks),
//  * React views (e.g. the opt-in "new Files changed experience" on /changes)
//    whose class names are CSS-module hashed (`Foo-module__bar--x1y2z`). For
//    those we only ever match the stable `Foo-module__bar` prefix and prefer
//    aria-* attributes, which are part of their accessibility contract.

export const SEL = {
  /**
   * Conversation tab review thread (verified Nov 2026): a Catalyst custom
   * element, NOT <details>. Expanded ⇔ class `open`, mirrored by
   * aria-expanded on its toggle button.
   */
  threadCollapsible: 'review-thread-collapsible',
  threadCollapsibleButton: 'button[data-target="review-thread-collapsible.button"]',
  /** Older conversation markup: plain <details> toggled via `.open`. */
  legacyThreadDetails:
    'details.js-resolvable-timeline-thread-container, details.outdated-diff-comment-container, details.review-thread-component',
  /** React review threads. Hashed class names → prefix match only. */
  reactThread: '[data-testid="review-thread"], [class*="ReviewThread-module__"]',
  /** React threads render a collapse button at the top (and sometimes one at the bottom). */
  reactThreadToggle: 'button[data-is-first-collapse-button="true"]',

  /** Disclosure button that is not a menu trigger (menus carry aria-haspopup). */
  plainDisclosureButton: 'button[aria-expanded]:not([aria-haspopup])',

  /** Classic Files tab: one `.js-file` per file; expanded ⇔ `open` / `Details--on`. */
  classicFile: '.js-file',
  classicFileToggle: [
    '.file-header button.js-details-target[aria-label="Toggle diff contents"]',
    '.file-header button.js-details-target[aria-expanded]',
    '.file-header .js-details-target',
  ],
  /** Per-file "Show comments" checkbox (in the file's "…" menu); shown ⇔ file has `show-inline-notes`. */
  classicFileNotesToggle: 'input.js-toggle-file-notes',
  classicInlineComments: '.js-inline-comments-container, .inline-comments',
  /** Classic file header; `data-path` holds the full (new) path, the file itself `data-tagsearch-path`. */
  classicFileHeader: '.file-header',
  /**
   * Classic "Viewed" checkbox (logged-in users only): a form in the file header
   * with `<input type="checkbox" name="viewed" class="js-reviewed-checkbox">`.
   * Checking it also collapses the file. Logged-out users have none.
   */
  classicViewedCheckbox: 'input.js-reviewed-checkbox, input[type="checkbox"][name="viewed"]',
  /** React Files changed header (one per file). */
  reactFileHeader: '[class*="DiffFileHeader-module__diff-file-header"]',

  /** Any element that can be the root of a review thread, across UI generations. */
  threadRoots: [
    'review-thread-collapsible',
    '.js-resolvable-timeline-thread-container',
    '.js-resolvable-thread-container',
    '.review-thread-component',
    '[data-testid="review-thread"]',
    '[class*="ReviewThread-module__"]',
  ].join(', '),

  /** User/bot-authored markdown. Bot summaries often contain <details>; never touch them. */
  userContent: '.markdown-body',
} as const;

export function isUserContent(el: Element): boolean {
  return !!el.closest(SEL.userContent);
}

/** querySelectorAll as an array, minus anything inside user-authored markdown. */
export function queryAll<T extends Element = HTMLElement>(root: ParentNode, selector: string): T[] {
  return Array.from(root.querySelectorAll<T>(selector)).filter((el) => !isUserContent(el));
}

/** First match from a priority-ordered list of selectors. */
export function queryFirst<T extends Element = HTMLElement>(root: ParentNode, selectors: readonly string[]): T | null {
  for (const sel of selectors) {
    const el = root.querySelector<T>(sel);
    if (el) return el;
  }
  return null;
}

/** Drop elements that are nested inside another element of the same list. */
export function outermost<T extends Element>(els: readonly T[]): T[] {
  const set = new Set<Element>(els);
  return els.filter((el) => {
    for (let p = el.parentElement; p; p = p.parentElement) if (set.has(p)) return false;
    return true;
  });
}

export function sortByDocumentOrder<T extends Node>(nodes: T[]): T[] {
  return nodes.sort((a, b) => {
    if (a === b) return 0;
    return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
}

/** aria-expanded as a boolean, or null when absent. */
export function ariaExpanded(el: Element | null | undefined): boolean | null {
  const v = el?.getAttribute('aria-expanded');
  return v === 'true' ? true : v === 'false' ? false : null;
}

/**
 * Label text of a control: aria-label + the text of its aria-labelledby
 * targets (Primer React tooltips label icon buttons that way) + title,
 * falling back to its text content.
 */
export function labelText(el: Element): string {
  const ids = el.getAttribute('aria-labelledby');
  const viaIds = ids ? ids.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '') : [];
  const text = [el.getAttribute('aria-label') ?? '', ...viaIds, el.getAttribute('title') ?? ''].join(' ').replace(/\s+/g, ' ').trim();
  return text || (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Expanded state implied by a toggle's label: "Collapse …"/"Hide …" ⇒ currently expanded. */
export function expandedFromLabel(el: Element): boolean | null {
  const label = labelText(el).toLowerCase();
  if (/\b(collapse|hide)\b/.test(label)) return true;
  if (/\b(expand|show)\b/.test(label)) return false;
  return null;
}

/** First descendant matching `selector` that belongs to `owner` (not to a nested `ownerSelector`). */
export function ownDescendant<T extends Element = HTMLElement>(owner: Element, selector: string, ownerSelector: string): T | null {
  for (const el of Array.from(owner.querySelectorAll<T>(selector))) {
    if (el.closest(ownerSelector) === owner) return el;
  }
  return null;
}

/** Top of the element in viewport coordinates; hidden elements use their nearest rendered ancestor. */
export function viewportTop(el: Element): number {
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    if (cur.getClientRects().length) return cur.getBoundingClientRect().top;
  }
  return 0;
}
