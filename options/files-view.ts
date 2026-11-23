// Better GHub - Options: "Files changed" section — the generated-file pattern
// editor with a path tester, and the checkout command preview.

import { debounce, h } from '../src/core/dom';
import { icon } from '../src/core/icons';
import { GENERATED_PATTERNS_DEFAULT, type Settings } from '../src/core/settings';
import { t } from '../src/i18n';
import { plural } from '../src/pages/format';
import { checkoutCommandFor, matchGenerated, parsePatterns, samePatterns } from '../src/pages/generated';

/** Pull request number shown in the checkout preview. */
const PREVIEW_PR = 123;
const SAVE_DELAY_MS = 700;

export class FilesView {
  private readonly textarea: HTMLTextAreaElement | null;
  private readonly reset: HTMLButtonElement | null;
  private readonly count: HTMLElement | null;
  private readonly testInput: HTMLInputElement | null;
  private readonly testResult: HTMLElement | null;
  private readonly preview: HTMLElement | null;
  private patterns: string[];
  private checkout: Settings['checkoutCommand'];
  private readonly commitSoon: (() => void) & { cancel(): void };

  constructor(
    root: HTMLElement,
    settings: Settings,
    private readonly savePatterns: (patterns: string[]) => Promise<void>
  ) {
    this.textarea = root.querySelector<HTMLTextAreaElement>('#set-patterns');
    this.reset = root.querySelector<HTMLButtonElement>('#patterns-reset');
    this.count = root.querySelector<HTMLElement>('#patterns-count');
    this.testInput = root.querySelector<HTMLInputElement>('#pattern-test');
    this.testResult = root.querySelector<HTMLElement>('#pattern-test-result');
    this.preview = root.querySelector<HTMLElement>('#checkout-preview');
    this.patterns = [...settings.generatedPatterns];
    this.checkout = settings.checkoutCommand;
    this.commitSoon = debounce(() => void this.commit(), SAVE_DELAY_MS);

    if (this.textarea) {
      this.textarea.value = this.patterns.join('\n');
      this.textarea.addEventListener('input', () => {
        this.renderState();
        this.commitSoon();
      });
      this.textarea.addEventListener('blur', () => {
        this.commitSoon.cancel();
        void this.commit();
      });
    }
    this.reset?.addEventListener('click', () => {
      if (!this.textarea) return;
      this.textarea.value = GENERATED_PATTERNS_DEFAULT.join('\n');
      this.commitSoon.cancel();
      void this.commit();
    });
    this.testInput?.addEventListener('input', () => this.renderTest());
    root.querySelectorAll<HTMLInputElement>('input[name="checkoutCommand"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (radio.checked && (radio.value === 'gh' || radio.value === 'git')) {
          this.checkout = radio.value;
          this.renderPreview();
        }
      });
    });
    this.render();
  }

  /** Patterns as currently typed (saved or not). */
  private draft(): string[] {
    return this.textarea ? parsePatterns(this.textarea.value) : this.patterns;
  }

  private async commit(): Promise<void> {
    const next = this.draft();
    if (samePatterns(next, this.patterns)) {
      this.renderState();
      return;
    }
    this.patterns = next;
    this.renderState();
    await this.savePatterns(next);
  }

  /** Settings changed (here or in another tab). Never overwrites text being edited. */
  sync(settings: Settings): void {
    this.checkout = settings.checkoutCommand;
    if (!samePatterns(settings.generatedPatterns, this.patterns)) {
      this.patterns = [...settings.generatedPatterns];
      if (this.textarea && document.activeElement !== this.textarea) this.textarea.value = this.patterns.join('\n');
    }
    this.render();
  }

  /** Re-render the localized bits (after a language change too). */
  render(): void {
    this.renderState();
    this.renderPreview();
  }

  private renderState(): void {
    const draft = this.draft();
    if (this.count) {
      this.count.textContent = plural('optPatternsCount', draft.length, { one: '$1 pattern', other: '$1 patterns' });
    }
    if (this.reset) this.reset.disabled = samePatterns(draft, GENERATED_PATTERNS_DEFAULT);
    this.renderTest();
  }

  private renderTest(): void {
    if (!this.testInput || !this.testResult) return;
    const path = this.testInput.value.trim();
    if (!path) {
      this.testResult.dataset.tone = 'muted';
      this.testResult.replaceChildren(t('optPatternTestHint', 'Type a file path to see whether it counts as generated.'));
      return;
    }
    const match = matchGenerated(path, this.draft());
    this.testResult.dataset.tone = match ? 'success' : 'muted';
    this.testResult.replaceChildren(
      icon(match ? 'check-circle' : 'file', 14),
      h('span', {
        text: match
          ? t('optPatternTestMatch', 'Generated: matches $1', match)
          : t('optPatternTestNoMatch', 'Not generated: no pattern matches'),
      })
    );
  }

  private renderPreview(): void {
    if (this.preview) this.preview.textContent = checkoutCommandFor(this.checkout, PREVIEW_PR);
  }
}
