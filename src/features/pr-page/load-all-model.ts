// Better GHub - PR page: "load all hidden timeline items" helpers (pure).

export const MAX_ROUNDS = 40;

/** "229 remaining items" / "12 hidden items" -> 229 / 12 (null when no number is shown). */
export function remainingFrom(text: string | null | undefined): number | null {
  const m = /(\d[\d,.\s]*)\s*(?:remaining|hidden|more)/i.exec(text ?? '') ?? /^\s*(\d[\d,]*)\s*$/.exec(text ?? '');
  if (!m) return null;
  const n = Number(m[1].replace(/\D/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Items loaded so far, given the count seen at the start and the current one. */
export function loadedSoFar(initial: number | null, remaining: number | null): number | null {
  return initial !== null && remaining !== null ? Math.max(0, initial - remaining) : null;
}
