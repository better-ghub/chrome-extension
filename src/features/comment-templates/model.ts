// Better GHub - Comment templates: entries, matching, textarea detection and
// popover placement (pure; no extension APIs).

import type { CommentSnippet } from '../../core/settings';
import { matchPath } from '../pr-page/file-finder-model';

export interface TemplateEntry {
  id: string;
  kind: 'label' | 'snippet';
  /** What the list shows and the filter matches. */
  title: string;
  /** Conventional Comments labels: the i18n key of the one-line description. */
  hintKey?: string;
  /** English fallback of the description. */
  hint?: string;
  /** Text inserted at the caret. */
  text: string;
}

export interface TemplateMatch {
  entry: TemplateEntry;
  /** Indices into `entry.title` of the matched characters. */
  positions: number[];
}

interface LabelSpec {
  label: string;
  decoration?: string;
  hint: string;
}

/** https://conventionalcomments.org — the decoration is part of the inserted text where shown. */
export const CONVENTIONAL_LABELS: readonly LabelSpec[] = [
  { label: 'praise', hint: 'Highlight something positive' },
  { label: 'nitpick', decoration: 'non-blocking', hint: 'A trivial preference-based request' },
  { label: 'suggestion', hint: 'Propose an improvement' },
  { label: 'issue', decoration: 'blocking', hint: 'A specific problem that needs fixing' },
  { label: 'question', hint: 'A potential concern you are unsure about' },
  { label: 'thought', hint: 'An idea that came up while reviewing' },
  { label: 'chore', hint: 'A simple task that must be done before merging' },
  { label: 'todo', hint: 'A small, trivial but necessary change' },
];

/** `**nitpick (non-blocking):** ` */
export function labelText(spec: Pick<LabelSpec, 'label' | 'decoration'>): string {
  return `**${spec.label}${spec.decoration ? ` (${spec.decoration})` : ''}:** `;
}

/** The user's snippets first (most specific), then the built-in labels. */
export function buildEntries(snippets: readonly CommentSnippet[], conventional: boolean): TemplateEntry[] {
  const out: TemplateEntry[] = snippets.map((s, i) => ({ id: `snippet-${i}`, kind: 'snippet', title: s.title, text: s.body }));
  if (conventional) {
    for (const spec of CONVENTIONAL_LABELS) {
      out.push({
        id: `label-${spec.label}`,
        kind: 'label',
        title: spec.decoration ? `${spec.label} (${spec.decoration})` : spec.label,
        hintKey: `commentLabelHint_${spec.label}`,
        hint: spec.hint,
        text: labelText(spec),
      });
    }
  }
  return out;
}

/** Entries matching `query`, best first; an empty query keeps the original order. */
export function rankEntries(query: string, entries: readonly TemplateEntry[]): TemplateMatch[] {
  const scored: { entry: TemplateEntry; score: number; positions: number[]; i: number }[] = [];
  entries.forEach((entry, i) => {
    // Titles have no '/', so the path matcher degrades to plain name matching.
    const m = matchPath(query, entry.title);
    if (m) scored.push({ entry, score: m.score, positions: m.positions, i });
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map(({ entry, positions }) => ({ entry, positions }));
}

// ------------------------------------------------------------ textarea

/**
 * Textareas that belong to a GitHub markdown comment box. Matched (unverified
 * against every GitHub rollout, hence the generous list):
 *  - classic forms: `textarea.js-comment-field`, `name="comment[body]"`,
 *    `pull_request_review[body]`, `pull_request_review_comment[body]`, `#new_comment_field`
 *  - inline/reply forms: any textarea inside `.js-inline-comment-form`, `.inline-comment-form`,
 *    `.js-previewable-comment-form`, `.js-new-comment-form`, `.review-thread-reply`
 *  - React markdown editor: `[data-testid^="markdown-editor"] textarea`,
 *    `textarea[aria-label="Markdown value"]`, a textarea next to `<markdown-toolbar>`
 */
const COMMENT_TEXTAREA = [
  'textarea.js-comment-field',
  'textarea[name$="[body]"]',
  'textarea#new_comment_field',
  'textarea[aria-label="Markdown value"]',
  '[data-testid^="markdown-editor"] textarea',
  '.js-inline-comment-form textarea',
  '.inline-comment-form textarea',
  '.js-previewable-comment-form textarea',
  '.js-new-comment-form textarea',
  '.review-thread-reply textarea',
].join(', ');

export function isCommentTextarea(el: unknown): el is HTMLTextAreaElement {
  if (!(el instanceof HTMLTextAreaElement)) return false;
  if (el.disabled || el.readOnly || el.closest('[data-bghub]')) return false;
  return el.matches(COMMENT_TEXTAREA) || !!el.closest('markdown-toolbar, .js-previewable-comment-form');
}

// ------------------------------------------------------------ placement

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Top-left of a popover of `size` near `anchor`, kept inside the viewport with a margin. */
export function placePopover(anchor: Box, size: { width: number; height: number }, viewport: { width: number; height: number }, margin = 8): { left: number; top: number } {
  const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(v, Math.max(min, max)));
  // Prefer below the anchor's first lines; flip above when it would not fit.
  let top = anchor.top + Math.min(anchor.height, 40) + 4;
  if (top + size.height > viewport.height - margin) top = anchor.top - size.height - 4;
  return {
    left: clamp(anchor.left + 8, margin, viewport.width - size.width - margin),
    top: clamp(top, margin, viewport.height - size.height - margin),
  };
}
