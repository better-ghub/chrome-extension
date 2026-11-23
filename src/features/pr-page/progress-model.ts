// Better GHub - PR page: review progress logic (pure, unit-testable).

export interface FileState {
  /** null = no "Viewed" control for this file. */
  viewed: boolean | null;
  /** Filtered out / not rendered: skipped by navigation, still counted. */
  hidden?: boolean;
}

export interface FileGeometry {
  /** Viewport-relative top of the file (its header). */
  top: number;
  /** Viewport-relative bottom of the file (end of its diff body). */
  bottom: number;
  hidden?: boolean;
}

export function progressCounts(files: readonly FileState[]): { viewed: number; total: number } {
  let viewed = 0;
  let total = 0;
  for (const f of files) {
    if (f.viewed === null) continue;
    total++;
    if (f.viewed) viewed++;
  }
  return { viewed, total };
}

/**
 * The file the reader is on: the first file whose header has reached the top
 * third of the viewport and whose body still reaches below `line` (the bottom
 * of GitHub's sticky chrome). Near the top of the page nothing has reached
 * the top third yet → the first file on screen. -1 when no file is on screen.
 */
export function pickCurrentIndex(files: readonly FileGeometry[], viewportHeight: number, line: number): number {
  const third = viewportHeight / 3;
  const visible = (f: FileGeometry): boolean => !f.hidden && f.bottom > line;
  const reading = files.findIndex((f) => visible(f) && f.top <= third);
  if (reading !== -1) return reading;
  return files.findIndex((f) => visible(f) && f.top < viewportHeight);
}

/**
 * Next unviewed, visible file after index `from` (-1 = from the start),
 * wrapping around; `from` itself comes last. -1 when every file is viewed.
 */
export function pickNextUnviewed(files: readonly FileState[], from: number): number {
  const n = files.length;
  for (let k = 1; k <= n; k++) {
    const i = (((from + k) % n) + n) % n;
    if (files[i].viewed === false && !files[i].hidden) return i;
  }
  return -1;
}
