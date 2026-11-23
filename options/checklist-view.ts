// Better GHub - Options: review checklist template editor (plain text, auto-saved).
//
// Format: a `[owner/repo]`, `[owner/*]` or `[*]` line starts a template; the
// lines below it (optionally prefixed with "- ") are its checklist items.

import { debounce } from '../src/core/dom';
import { formatChecklistText, parseChecklistText, sameTemplates, type ChecklistTemplate } from '../src/core/checklist-model';
import type { Settings } from '../src/core/settings';

const SAVE_DELAY_MS = 700;

export class ChecklistView {
  private readonly textarea: HTMLTextAreaElement | null;
  private templates: ChecklistTemplate[];
  private readonly commitSoon: (() => void) & { cancel(): void };

  constructor(
    root: HTMLElement,
    settings: Settings,
    private readonly save: (templates: ChecklistTemplate[]) => Promise<void>
  ) {
    this.textarea = root.querySelector<HTMLTextAreaElement>('#set-checklists');
    this.templates = [...settings.reviewChecklists];
    this.commitSoon = debounce(() => void this.commit(), SAVE_DELAY_MS);
    if (!this.textarea) return;
    this.textarea.value = formatChecklistText(this.templates);
    this.textarea.addEventListener('input', this.commitSoon);
    this.textarea.addEventListener('blur', () => {
      this.commitSoon.cancel();
      void this.commit();
    });
  }

  private async commit(): Promise<void> {
    if (!this.textarea) return;
    const next = parseChecklistText(this.textarea.value);
    if (sameTemplates(next, this.templates)) return;
    this.templates = next;
    await this.save(next);
  }

  /** Settings changed elsewhere; never overwrites text being edited. */
  sync(settings: Settings): void {
    if (sameTemplates(settings.reviewChecklists, this.templates)) return;
    this.templates = [...settings.reviewChecklists];
    if (this.textarea && document.activeElement !== this.textarea) this.textarea.value = formatChecklistText(this.templates);
  }
}
