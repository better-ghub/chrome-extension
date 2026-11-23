// Better GHub - PR page: state-aware bulk toggling (pure logic).
//
// The old implementation clicked every toggle on the page, so with a mix of
// open and closed threads "collapse all" actually inverted each one. Now every
// bulk action computes ONE target state and only touches items that differ.

export interface Toggle {
  /** Element that represents the item on the page (ordering, scroll anchoring). */
  el: Element;
  expanded: boolean;
  /** Nested inside another item of the same batch — does not vote on the target state. */
  nested?: boolean;
  /** Bring the item to `expanded`. Only called when the state differs. */
  set(expanded: boolean): void;
}

/**
 * The rule: if ANY item is expanded → collapse all, otherwise expand all.
 * Returns the target `expanded` value. Nested items (e.g. a thread inside a
 * collapsed outdated-diff wrapper) are invisible and must not flip the vote.
 */
export function targetExpanded(items: readonly Pick<Toggle, 'expanded' | 'nested'>[]): boolean {
  const voters = items.some((i) => !i.nested) ? items.filter((i) => !i.nested) : items;
  return !voters.some((i) => i.expanded);
}

/** Apply `expanded` to every item whose state differs; returns how many changed. */
export function applyTarget(items: readonly Toggle[], expanded: boolean): number {
  let changed = 0;
  for (const item of items) {
    if (item.expanded === expanded) continue;
    try {
      item.set(expanded);
      changed++;
    } catch {
      /* one broken item must not stop the batch */
    }
  }
  return changed;
}

/** De-duplicate by element and flag items that sit inside another item. */
export function normalizeToggles(items: readonly Toggle[]): Toggle[] {
  const byEl = new Map<Element, Toggle>();
  for (const item of items) if (!byEl.has(item.el)) byEl.set(item.el, item);
  const els = new Set(byEl.keys());
  return [...byEl.values()].map((item) => {
    let nested = false;
    for (let p = item.el.parentElement; p && !nested; p = p.parentElement) nested = els.has(p);
    return { ...item, nested };
  });
}

export function nonNull<T>(v: T | null | undefined): v is T {
  return v !== null && v !== undefined;
}
