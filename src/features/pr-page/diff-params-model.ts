// Better GHub - PR page: diff view URL parameters (pure, unit-testable).
//
// Classic diffs honour `?w=1` (hide whitespace) and `?diff=split|unified`.
// Whether the newer React `/changes` view reads the same parameters is
// unverified; the toggles are still the best URL-level control available.

export type DiffMode = 'split' | 'unified';

/** Whitespace hidden ⇔ `w=1`. */
export function whitespaceHidden(href: string): boolean {
  return new URL(href).searchParams.get('w') === '1';
}

/** Same URL with `w=1` toggled; path and hash are kept. */
export function toggleWhitespaceHref(href: string): string {
  const url = new URL(href);
  if (url.searchParams.get('w') === '1') url.searchParams.delete('w');
  else url.searchParams.set('w', '1');
  return url.href;
}

/** Mode forced by the URL, if any. */
export function modeFromUrl(href: string): DiffMode | null {
  const v = new URL(href).searchParams.get('diff');
  return v === 'split' || v === 'unified' ? v : null;
}

/** Best-effort mode of the diff currently rendered (null when unknown). */
export function modeFromDom(root: ParentNode = document): DiffMode | null {
  const radio = root.querySelector<HTMLInputElement>('input[type="radio"][name="diff"]:checked');
  if (radio && (radio.value === 'split' || radio.value === 'unified')) return radio.value;
  if (root.querySelector('.file-diff-split')) return 'split';
  if (root.querySelector('table.diff-table, .diff-table')) return 'unified';
  return null;
}

/** Mode that is on screen now: URL wins, then the DOM. */
export function currentMode(href: string, root: ParentNode = document): DiffMode | null {
  return modeFromUrl(href) ?? modeFromDom(root);
}

/** The other mode; unknown current mode → split. */
export function otherMode(current: DiffMode | null): DiffMode {
  return current === 'split' ? 'unified' : 'split';
}

export function withMode(href: string, mode: DiffMode): string {
  const url = new URL(href);
  url.searchParams.set('diff', mode);
  return url.href;
}
