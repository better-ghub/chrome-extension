// Better GHub - Options: "Comment templates" snippet list editor
// (add / edit / reorder / remove). Changes autosave; incomplete rows (no title
// or no text) stay in the editor but are not stored until they are filled in.

import { debounce, h } from '../src/core/dom';
import { icon } from '../src/core/icons';
import { MAX_SNIPPET_BODY, MAX_SNIPPET_TITLE, MAX_SNIPPETS, sanitizeSnippets, type CommentSnippet, type Settings } from '../src/core/settings';
import { t } from '../src/i18n';
import { plural } from '../src/pages/format';
import { uid } from '../src/pages/dom-ui';

const SAVE_DELAY_MS = 700;

export function sameSnippets(a: readonly CommentSnippet[], b: readonly CommentSnippet[]): boolean {
  return a.length === b.length && a.every((s, i) => s.title === b[i].title && s.body === b[i].body);
}

export class TemplatesView {
  private draft: CommentSnippet[];
  private saved: CommentSnippet[];
  private readonly commitSoon: (() => void) & { cancel(): void };

  constructor(
    private readonly root: HTMLElement,
    settings: Settings,
    private readonly save: (snippets: CommentSnippet[]) => Promise<void>
  ) {
    this.saved = sanitizeSnippets(settings.commentSnippets);
    this.draft = this.saved.map((s) => ({ ...s }));
    this.commitSoon = debounce(() => void this.commit(), SAVE_DELAY_MS);
    // Leaving a field flushes at once.
    this.root.addEventListener('focusout', () => {
      this.commitSoon.cancel();
      void this.commit();
    });
    this.render();
  }

  private async commit(): Promise<void> {
    const next = sanitizeSnippets(this.draft);
    if (sameSnippets(next, this.saved)) return;
    this.saved = next;
    await this.save(next);
  }

  /** Settings changed (here or in another tab). Never overwrites a row being edited. */
  sync(settings: Settings): void {
    const incoming = sanitizeSnippets(settings.commentSnippets);
    if (sameSnippets(incoming, this.saved)) return;
    this.saved = incoming;
    if (this.root.contains(document.activeElement)) return;
    this.draft = incoming.map((s) => ({ ...s }));
    this.render();
  }

  private edit(): void {
    this.commitSoon();
  }

  private move(from: number, to: number, focus: string): void {
    if (to < 0 || to >= this.draft.length) return;
    const [item] = this.draft.splice(from, 1);
    this.draft.splice(to, 0, item);
    this.commitSoon.cancel();
    void this.commit();
    this.render(`${focus}:${to}`);
  }

  private remove(index: number): void {
    this.draft.splice(index, 1);
    this.commitSoon.cancel();
    void this.commit();
    this.render(this.draft.length ? `title:${Math.min(index, this.draft.length - 1)}` : 'add');
  }

  private add(): void {
    if (this.draft.length >= MAX_SNIPPETS) return;
    this.draft.push({ title: '', body: '' });
    this.render(`title:${this.draft.length - 1}`);
  }

  /** (Re)build the list. `focus` = "<control>:<index>" to restore keyboard focus afterwards. */
  render(focus?: string): void {
    const full = this.draft.length >= MAX_SNIPPETS;
    const rows = this.draft.map((snippet, i) => this.row(snippet, i));
    const add = h(
      'button',
      { class: 'btn btn-sm', attrs: { type: 'button', 'data-focus': 'add', disabled: full }, on: { click: () => this.add() } },
      h('span', { class: 'btn-label', text: t('optSnippetAdd', 'Add snippet') })
    );
    const count = h('span', {
      class: 'patterns-count text-muted',
      text: full
        ? t('optSnippetLimit', 'You can keep up to $1 snippets.', String(MAX_SNIPPETS))
        : plural('optSnippetsCount', this.draft.length, { one: '$1 snippet', other: '$1 snippets' }),
    });
    this.root.replaceChildren(
      this.draft.length
        ? h('ol', { class: 'snippet-list list-reset', attrs: { role: 'list' } }, rows)
        : h('p', { class: 'snippet-empty text-muted', text: t('optSnippetEmpty', 'No snippets yet.') }),
      h('div', { class: 'patterns-actions' }, count, add)
    );
    if (focus) {
      const [control, index] = focus.split(':');
      const sel = control === 'add' ? '[data-focus="add"]' : `[data-focus="${control}"][data-index="${index}"]`;
      this.root.querySelector<HTMLElement>(sel)?.focus();
    }
  }

  private row(snippet: CommentSnippet, i: number): HTMLElement {
    const titleId = uid('snippet-title');
    const bodyId = uid('snippet-body');
    const button = (name: 'up' | 'down' | 'remove', label: string, glyph: 'arrow-up' | 'arrow-down' | 'trash', disabled: boolean, run: () => void): HTMLElement =>
      h(
        'button',
        {
          class: `btn btn-icon btn-sm${name === 'remove' ? ' btn-danger' : ''}`,
          attrs: { type: 'button', 'aria-label': label, title: label, 'data-focus': name, 'data-index': i, disabled },
          on: { click: run },
        },
        icon(glyph, 14)
      );
    const title = h('input', {
      class: 'input',
      attrs: { id: titleId, type: 'text', maxlength: MAX_SNIPPET_TITLE, autocomplete: 'off', 'data-focus': 'title', 'data-index': i },
      on: {
        input: (e) => {
          this.draft[i].title = (e.target as HTMLInputElement).value;
          this.edit();
        },
      },
    });
    title.value = snippet.title;
    const body = h('textarea', {
      class: 'input textarea input-mono',
      attrs: { id: bodyId, rows: 4, maxlength: MAX_SNIPPET_BODY, spellcheck: 'false', 'data-focus': 'body', 'data-index': i },
      on: {
        input: (e) => {
          this.draft[i].body = (e.target as HTMLTextAreaElement).value;
          this.edit();
        },
      },
    });
    body.value = snippet.body;
    return h(
      'li',
      { class: 'snippet-row', attrs: { 'aria-label': t('optSnippetItem', 'Snippet $1', String(i + 1)) } },
      h(
        'div',
        { class: 'snippet-fields' },
        h(
          'div',
          { class: 'field' },
          h('label', { class: 'field-label', attrs: { for: titleId }, text: t('optSnippetTitle', 'Title') }),
          title
        ),
        h(
          'div',
          { class: 'field' },
          h('label', { class: 'field-label', attrs: { for: bodyId }, text: t('optSnippetBody', 'Text to insert') }),
          body
        )
      ),
      h(
        'div',
        { class: 'snippet-actions' },
        button('up', t('optSnippetMoveUp', 'Move up'), 'arrow-up', i === 0, () => this.move(i, i - 1, 'up')),
        button('down', t('optSnippetMoveDown', 'Move down'), 'arrow-down', i === this.draft.length - 1, () => this.move(i, i + 1, 'down')),
        button('remove', t('optSnippetRemove', 'Remove'), 'trash', false, () => this.remove(i))
      )
    );
  }
}
