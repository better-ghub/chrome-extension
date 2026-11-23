// Better GHub - PR page: per-repo review checklist.
//
// GitHub's sidebar is re-rendered by React/sockets (no stable anchor for our
// own nodes), so the checklist is a small floating panel at the bottom-left:
// a pill "Review checklist 2/5" that expands into real checkboxes. Ticks are
// stored per PR in chrome.storage.local (see checklist-model.ts).

import { debounce, h } from '../../core/dom';
import { icon } from '../../core/icons';
import type { PageContext } from '../../core/page';
import { doneFor, parseTicks, pickTemplate, recordTicks, tickKey, TICKS_STORAGE_KEY, type TickMap } from '../../core/checklist-model';
import { liveSettings } from '../../content/state';
import { t } from '../../i18n';

export interface Checklist {
  /** Expand/collapse; false when no checklist applies to this PR. */
  toggle(): boolean;
}

let expanded = false;

async function readTicks(): Promise<TickMap> {
  try {
    return parseTicks((await chrome.storage.local.get([TICKS_STORAGE_KEY]))[TICKS_STORAGE_KEY]);
  } catch {
    return {};
  }
}

export function mountChecklist(page: PageContext, signal: AbortSignal): Checklist {
  const none: Checklist = { toggle: () => false };
  const { owner, repo, number } = page;
  const s = liveSettings();
  if (!s.reviewChecklistEnabled || !owner || !repo || typeof number !== 'number') return none;
  const template = pickTemplate(s.reviewChecklists, owner, repo);
  if (!template) return none;

  const key = tickKey(owner, repo, number);
  const items = template.items;
  const done = new Set<string>();
  let root: HTMLElement | null = null;

  let dirty = false;
  const persist = (): void => {
    dirty = false;
    void (async () => {
      try {
        const all = await readTicks();
        await chrome.storage.local.set({ [TICKS_STORAGE_KEY]: recordTicks(all, key, items.filter((i) => done.has(i)), Date.now()) });
      } catch {
        /* storage unavailable: ticks last for this page only */
      }
    })();
  };
  const save = debounce(persist, 400);

  const render = (): void => {
    if (!root) return;
    const panelId = 'bghub-checklist-panel';
    const label = t('prChecklistTitle', 'Review checklist');
    const progress = `${done.size}/${items.length}`;
    const complete = done.size === items.length;
    root.dataset.complete = String(complete);
    const toggle = h(
      'button',
      {
        class: 'bghub-checklist-toggle',
        attrs: { type: 'button', 'aria-expanded': String(expanded), 'aria-controls': panelId },
        on: { click: () => api.toggle() },
      },
      icon(complete ? 'check-circle' : 'checklist', 16),
      h('span', { text: `${label} ${progress}` })
    );
    const body = h(
      'fieldset',
      { class: 'bghub-checklist-body', attrs: { id: panelId, hidden: !expanded } },
      h('legend', { class: 'bghub-sr-only', text: label }),
      ...items.map((item, i) => {
        const id = `bghub-checklist-${i}`;
        return h(
          'div',
          { class: 'bghub-checklist-item' },
          h('input', {
            attrs: { type: 'checkbox', id, checked: done.has(item) },
            on: {
              change: (ev) => {
                if ((ev.target as HTMLInputElement).checked) done.add(item);
                else done.delete(item);
                dirty = true;
                save();
                update();
              },
            },
          }),
          h('label', { attrs: { for: id }, text: item })
        );
      })
    );
    root.replaceChildren(toggle, body);
  };

  // Updates the pill without rebuilding the checkboxes (keeps keyboard focus).
  const update = (): void => {
    const span = root?.querySelector('.bghub-checklist-toggle span');
    if (span) span.textContent = `${t('prChecklistTitle', 'Review checklist')} ${done.size}/${items.length}`;
    if (root) root.dataset.complete = String(done.size === items.length);
  };

  const api: Checklist = {
    toggle() {
      expanded = !expanded;
      render();
      if (expanded) root?.querySelector<HTMLInputElement>('input')?.focus();
      else root?.querySelector<HTMLElement>('.bghub-checklist-toggle')?.focus();
      return true;
    },
  };

  root = h('div', { class: 'bghub-checklist', attrs: { role: 'region', 'aria-label': t('prChecklistTitle', 'Review checklist'), 'data-bghub': '' } });
  void readTicks().then((all) => {
    if (signal.aborted || !root) return;
    for (const d of doneFor(all[key], items)) done.add(d);
    render();
    document.body.append(root);
  });
  signal.addEventListener('abort', () => {
    save.cancel();
    if (dirty) persist(); // flush the last tick before the page goes away
    root?.remove();
  });
  return api;
}
